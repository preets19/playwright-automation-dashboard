import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFeedbackStore } from './feedback-store.mjs';

const hostRootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dashboardDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicDir = join(dashboardDir, 'public');
const workspaceRoot = resolve(process.env.AUTOMATION_WORKSPACE_ROOT ?? resolve(homedir(), 'Source', 'Repo'));
const port = Number(process.env.DASHBOARD_PORT ?? 4310);
const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';
const sessionToken = randomBytes(32).toString('hex');
const sessionCookie = `automation_dashboard_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`;
const heartbeatTimeoutMs = Number(process.env.DASHBOARD_HEARTBEAT_TIMEOUT_MS ?? 120_000);
let lastDashboardHeartbeat = 0;
const automationContextCache = new Map();
const feedbackStore = createFeedbackStore();

const playwrightConfigNames = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs'
];

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webm', 'video/webm'],
  ['.zip', 'application/zip']
]);

const commands = {
  validate: {
    label: 'Full Validation',
    command: 'npm.cmd',
    args: ['run', 'validate'],
    useLocalTemp: true
  },
  typecheck: {
    label: 'App TypeScript Check',
    command: 'npm.cmd',
    args: ['run', 'typecheck']
  },
  build: {
    label: 'Build Framework Dependency',
    command: 'npm.cmd',
    args: ['run', 'framework:build']
  },
  testAll: {
    label: 'Run Tests',
    command: 'npm.cmd',
    args: ['test'],
    useLocalTemp: true
  },
  testSelected: {
    label: 'Run Selected Tests',
    command: 'npx.cmd',
    args: ['playwright', 'test', '-c', 'playwright.config.ts'],
    useLocalTemp: true
  },
  testUi: {
    label: 'Open Playwright Test Runner UI',
    command: 'npm.cmd',
    args: ['run', 'test:ui'],
    useLocalTemp: true,
    detached: true
  },
  recorder: {
    label: 'Open Playwright Recorder UI',
    command: 'npx.cmd',
    args: ['playwright', 'codegen', '--target', 'playwright-test'],
    useLocalTemp: true,
    detached: true
  },
  outdated: {
    label: 'Check Dependency Updates',
    command: 'npm.cmd',
    args: ['outdated'],
    allowNonZero: true
  },
  audit: {
    label: 'Security Audit',
    command: 'npm.cmd',
    args: ['audit', '--audit-level=moderate'],
    allowNonZero: true
  },
  listTests: {
    label: 'Discover Tests',
    command: 'npx.cmd',
    args: ['playwright', 'test', '-c', 'playwright.config.ts', '--list'],
    useLocalTemp: true
  },
  installBrowsers: {
    label: 'Install Playwright Browsers',
    command: 'npx.cmd',
    args: ['playwright', 'install'],
    confirm: true
  }
};

const cleanupTargets = ['dist', 'playwright-report', 'test-results'];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if ((url.pathname.startsWith('/api/') || url.pathname.startsWith('/reports/')) && !hasValidSession(request)) {
      await sendJson(response, { ok: false, error: 'Dashboard session is not authorized.' }, 403);
      return;
    }

    if (url.pathname === '/api/repos') {
      await sendJson(response, await listAppRepos());
      return;
    }

    if (url.pathname === '/api/process') {
      await sendJson(response, { ok: true, pid: process.pid });
      return;
    }

    if (url.pathname === '/api/heartbeat' && request.method === 'POST') {
      lastDashboardHeartbeat = Date.now();
      await sendJson(response, { ok: true });
      return;
    }

    if (url.pathname === '/api/status') {
      const repoDir = await getSelectedRepoDir(url);
      await sendJson(response, await getStatus(repoDir));
      return;
    }

    if (url.pathname === '/api/automation-context') {
      const repoDir = await getSelectedRepoDir(url);
      await sendJson(response, await getAutomationContext(repoDir));
      return;
    }

    if (url.pathname === '/api/feedback/snapshot' && request.method === 'POST') {
      const body = await readRequestJson(request);
      const repoDir = await getSelectedRepoDir(url, body);
      await sendJson(response, await captureFeedbackSnapshot(repoDir, body));
      return;
    }

    if (url.pathname === '/api/ai/generate-test' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await getSelectedRepoDir(url, body);
      await sendJson(response, await generateTestWithAi(body));
      return;
    }

    if (url.pathname === '/api/settings' && request.method === 'GET') {
      const repoDir = await getSelectedRepoDir(url);
      await sendJson(response, await readSettings(repoDir));
      return;
    }

    if (url.pathname === '/api/settings' && request.method === 'POST') {
      const body = await readRequestJson(request);
      const repoDir = await getSelectedRepoDir(url, body);
      const repoInfo = await getRepoInfo(repoDir);
      if (repoInfo.type !== 'framework') {
        throw new Error('This repo is not using the automation framework. Test Run Settings cannot be saved.');
      }
      delete body.repoDir;
      await writeSettings(repoDir, body);
      await sendJson(response, { ok: true });
      return;
    }

    if (url.pathname === '/api/tests') {
      const repoDir = await getSelectedRepoDir(url);
      await sendJson(response, await discoverTests(repoDir));
      return;
    }

    if (url.pathname === '/api/run' && request.method === 'POST') {
      const body = await readRequestJson(request);
      const repoDir = await getSelectedRepoDir(url, body);
      await sendJson(response, await runAllowedCommand(repoDir, body.id, body));
      return;
    }

    if (url.pathname === '/api/cleanup' && request.method === 'POST') {
      const body = await readRequestJson(request);
      const repoDir = await getSelectedRepoDir(url, body);
      await cleanupGeneratedFiles(repoDir);
      await sendJson(response, { ok: true, message: 'Generated files cleaned.' });
      return;
    }

    if (url.pathname === '/api/stop-automation' && request.method === 'POST') {
      await sendJson(response, { ok: true, message: 'Automation is stopping. This dashboard will disconnect.' });
      setTimeout(stopAutomationProcesses, 250);
      return;
    }

    if (url.pathname === '/api/artifacts') {
      const repoDir = await getSelectedRepoDir(url);
      await sendJson(response, await listArtifacts(repoDir));
      return;
    }

    if (url.pathname === '/api/open-home-dashboard' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await getSelectedRepoDir(url, body);
      await sendJson(response, {
        ok: true,
        url: `http://${host}:${port}/`,
        message: 'Loading Home Dashboard. Test Dashboard will close in the background.'
      });
      setTimeout(handoffToHomeDashboard, 500);
      return;
    }

    if (url.pathname.startsWith('/reports/')) {
      await serveReport(url.pathname, response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    await sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.log(`Test dashboard is already running or another process is using http://${host}:${port}`);
    console.log(`Open http://${host}:${port} in your browser, or run Stop Automation.cmd and try again.`);
    process.exit(0);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  recordAutomationPid(hostRootDir, process.pid, 'dashboard-server');
  console.log(`Test dashboard running at http://${host}:${port}`);
});

setInterval(() => {
  if (!lastDashboardHeartbeat) {
    return;
  }

  if (Date.now() - lastDashboardHeartbeat > heartbeatTimeoutMs) {
    console.log('Dashboard browser heartbeat stopped. Stopping automation processes.');
    stopAutomationProcesses();
  }
}, 30_000).unref();

function localTempEnv(repoDir) {
  const temp = join(repoDir, '.tmp');
  return { TEMP: temp, TMP: temp };
}

async function listAppRepos() {
  if (!existsSync(workspaceRoot)) {
    return {
      workspaceRoot,
      defaultRepoDir: '',
      repos: []
    };
  }

  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const repos = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const repoDir = join(workspaceRoot, entry.name);
    const repoInfo = await getRepoInfo(repoDir);
    if (repoInfo.type !== 'unsupported') {
      repos.push({
        name: entry.name,
        path: repoDir,
        type: repoInfo.type
      });
    }
  }

  repos.sort((a, b) => a.name.localeCompare(b.name));

  return {
    workspaceRoot,
    defaultRepoDir: repos.find((repo) => repo.path === hostRootDir)?.path ?? repos[0]?.path ?? '',
    repos
  };
}

async function getSelectedRepoDir(url, body = {}) {
  const requested = body.repoDir ?? url.searchParams.get('repoDir') ?? hostRootDir;
  const repoDir = resolve(String(requested));
  const relativePath = relative(workspaceRoot, repoDir);

  if (relativePath.startsWith('..') || relativePath === '' || resolve(workspaceRoot, relativePath) !== repoDir) {
    throw new Error('Selected repo must be under the local Source\\Repo workspace.');
  }

  const repoInfo = await getRepoInfo(repoDir);
  if (repoInfo.type === 'unsupported') {
    throw new Error('Selected folder is not a supported Playwright automation repo.');
  }

  await writeActiveRepoState(repoDir);
  return repoDir;
}

async function isAppAutomationRepo(repoDir) {
  return (await getRepoInfo(repoDir)).type !== 'unsupported';
}

async function getRepoInfo(repoDir) {
  const packagePath = join(repoDir, 'package.json');
  if (!existsSync(packagePath)) {
    return { type: 'unsupported' };
  }

  try {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf-8'));
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {})
    };
    const configPath = playwrightConfigNames.map((name) => join(repoDir, name)).find((file) => existsSync(file));
    const hasFramework = Object.hasOwn(dependencies, '@your-org/playwright-base-framework');
    const hasPlaywright = Object.hasOwn(dependencies, '@playwright/test') || Object.hasOwn(dependencies, 'playwright');
    const hasAppSettings = existsSync(join(repoDir, 'appsettings.json'));
    const hasAutomationTests = existsSync(join(repoDir, '_automation', 'tests'));

    if (configPath && hasFramework && hasAppSettings && hasAutomationTests) {
      return { type: 'framework', configPath };
    }

    if (configPath && hasPlaywright) {
      return { type: 'generic-playwright', configPath };
    }

    return { type: 'unsupported' };
  } catch {
    return { type: 'unsupported' };
  }
}

async function getStatus(repoDir) {
  const repoInfo = await getRepoInfo(repoDir);
  const [nodeVersion, npmVersion, playwrightVersion] = await Promise.all([
    runProcess(repoDir, 'node', ['--version']),
    runProcess(repoDir, 'npm.cmd', ['--version']),
    runProcess(repoDir, 'npx.cmd', ['playwright', '--version'])
  ]);

  const settings = await readSettings(repoDir);
  return {
    rootDir: repoDir,
    repoName: basename(repoDir),
    repoType: repoInfo.type,
    compatibilityMessage: getCompatibilityMessage(repoInfo.type),
    workspaceRoot,
    node: nodeVersion.stdout.trim(),
    npm: npmVersion.stdout.trim(),
    playwright: playwrightVersion.stdout.trim(),
    appBaseUrl: settings.application?.baseUrl ?? '',
    apiBaseUrl: settings.api?.baseUrl ?? '',
    browsers: getConfiguredBrowsers(settings),
    headless: settings.browser?.headless ?? true,
    slowMo: settings.browser?.slowMo ?? 0,
    hasNodeModules: existsSync(join(repoDir, 'node_modules')),
    hasReport: existsSync(join(repoDir, 'playwright-report', 'index.html')),
    reportUrl: getReportUrl(repoDir),
    updatedAt: new Date().toISOString()
  };
}

function getConfiguredBrowsers(settings) {
  const configured = settings.browser?.browsers;
  if (Array.isArray(configured) && configured.length) {
    return configured;
  }

  return [settings.browser?.name ?? 'chromium'];
}

function getReportUrl(repoDir) {
  return `/reports/${encodeURIComponent(basename(repoDir))}/playwright/index.html`;
}

async function getAutomationContext(repoDir) {
  const cacheKey = resolve(repoDir);
  const cached = automationContextCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 60_000) {
    return { ...cached.context, cache: { status: 'hit', createdAt: cached.context.generatedAt } };
  }

  const context = await buildAutomationContext(cacheKey);
  automationContextCache.set(cacheKey, { createdAt: Date.now(), context });
  return { ...context, cache: { status: 'refreshed', createdAt: context.generatedAt } };
}

async function buildAutomationContext(repoDir) {
  const repoInfo = await getRepoInfo(repoDir);
  const frameworkRepo = resolve(process.env.AUTOMATION_FRAMEWORK_REPO ?? join(workspaceRoot, 'playwright-base-framework'));
  const settings = await readSettings(repoDir).catch(() => getGenericSettings(repoDir));
  const packageJson = await readJsonIfExists(join(repoDir, 'package.json'));
  const frameworkPackage = '@your-org/playwright-base-framework';
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };
  const artifacts = await listAutomationContextArtifacts(repoDir);
  const samples = await readContextSamples(repoDir, artifacts);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: 'dashboard-prepared-context',
    repo: {
      name: basename(repoDir),
      path: repoDir,
      type: repoInfo.type,
      automationRoot: join(repoDir, '_automation')
    },
    framework: {
      packageName: frameworkPackage,
      dependencyVersion: dependencies[frameworkPackage] ?? null,
      repoPath: existsSync(frameworkRepo) ? frameworkRepo : null,
      sourceRoot: existsSync(frameworkRepo) ? join(frameworkRepo, 'src') : null,
      aiRoot: existsSync(frameworkRepo) ? join(frameworkRepo, '.ai') : null
    },
    config: {
      appBaseUrl: settings.application?.baseUrl ?? '',
      apiBaseUrl: settings.api?.baseUrl ?? '',
      browsers: getConfiguredBrowsers(settings),
      headless: settings.browser?.headless ?? true
    },
    artifacts,
    conventions: inferDashboardContextConventions(samples),
    samples,
    frameworkAi: await readFrameworkAiContext(frameworkRepo),
    guidance: [
      'Use only the active app repo for app-specific artifacts.',
      'Prefer existing app pages, workflows, models, test data, and tests before creating new ones.',
      'Use base framework source only to understand shared APIs and conventions.',
      'Treat this context as a prepared dashboard bundle that can be used by any AI connector.'
    ]
  };
}

async function listAutomationContextArtifacts(repoDir) {
  const automationRoot = join(repoDir, '_automation');
  const files = existsSync(automationRoot) ? await walk(automationRoot) : [];
  const relativeFiles = files
    .filter(isAutomationTextFile)
    .map((file) => toPosix(relative(repoDir, file)))
    .sort();

  return {
    pages: relativeFiles.filter((file) => file.startsWith('_automation/pages/')),
    workflows: relativeFiles.filter((file) => file.startsWith('_automation/workflows/')),
    models: relativeFiles.filter((file) => file.startsWith('_automation/models/')),
    testData: relativeFiles.filter((file) => file.startsWith('_automation/test-data/')),
    tests: relativeFiles.filter((file) => file.startsWith('_automation/tests/')),
    other: relativeFiles.filter((file) => ![
      '_automation/pages/',
      '_automation/workflows/',
      '_automation/models/',
      '_automation/test-data/',
      '_automation/tests/'
    ].some((prefix) => file.startsWith(prefix)))
  };
}

async function readContextSamples(repoDir, artifacts) {
  const sampleFiles = [
    ...artifacts.tests.slice(0, 3),
    ...artifacts.workflows.slice(0, 3),
    ...artifacts.pages.slice(0, 4),
    ...artifacts.models.slice(0, 2),
    ...artifacts.testData.slice(0, 2)
  ];

  const samples = [];
  for (const relativePath of sampleFiles) {
    samples.push({
      file: relativePath,
      content: await readTextIfExists(join(repoDir, relativePath), { maxBytes: 12_000 })
    });
  }

  return samples;
}

async function readFrameworkAiContext(frameworkRepo) {
  if (!existsSync(frameworkRepo)) {
    return { available: false, message: `Framework repo was not found: ${frameworkRepo}` };
  }

  const aiRoot = join(frameworkRepo, '.ai');
  return {
    available: existsSync(aiRoot),
    testGenerationRules: await readTextIfExists(join(aiRoot, 'test-generation-rules.md'), { optional: true, maxBytes: 20_000 }),
    outputTemplate: await readTextIfExists(join(aiRoot, 'test-generation-output-template.md'), { optional: true, maxBytes: 20_000 }),
    lessonsLearned: await readTextIfExists(join(aiRoot, 'lessons-learned.md'), { optional: true, maxBytes: 20_000 })
  };
}

function inferDashboardContextConventions(samples) {
  const allContent = samples.map((sample) => sample.content).join('\n');
  return {
    frameworkImports: allContent.includes("@your-org/playwright-base-framework")
      ? "Uses imports from '@your-org/playwright-base-framework'."
      : 'No framework package import observed in sampled files.',
    jsExtensionImports: /\.js['"]/.test(allContent)
      ? 'Uses .js extensions in TypeScript relative imports.'
      : 'No .js relative import convention observed in sampled files.',
    pageObjects: /extends BasePage/.test(allContent)
      ? 'Page objects extend BasePage.'
      : 'No BasePage extension observed in sampled files.',
    workflows: /constructor\(private readonly page: Page\)/.test(allContent)
      ? 'Workflows commonly accept Playwright Page in the constructor.'
      : 'No common workflow constructor pattern detected in sampled files.',
    specs: /import \{ expect, test \} from '@your-org\/playwright-base-framework'/.test(allContent)
      ? 'Specs import expect and test from the framework package.'
      : 'Spec import pattern not detected in sampled files.'
  };
}

async function readTextIfExists(filePath, options = {}) {
  if (!existsSync(filePath)) {
    return options.optional ? '' : `File was not found: ${filePath}`;
  }

  const fileStat = await stat(filePath);
  const maxBytes = options.maxBytes ?? 20_000;
  const content = await readFile(filePath, 'utf-8');
  return fileStat.size > maxBytes ? `${content.slice(0, maxBytes)}\n\n[Truncated at ${maxBytes} bytes]` : content;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, 'utf-8'));
}

async function writeActiveRepoState(repoDir) {
  try {
    await mkdir(join(hostRootDir, '.tmp'), { recursive: true });
    await writeFile(join(hostRootDir, '.tmp', 'active-repo.json'), `${JSON.stringify({ activeRepoPath: repoDir, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf-8');
  } catch {
    // Best-effort context handoff for MCP clients only.
  }
}

function isAutomationTextFile(filePath) {
  return new Set(['.ts', '.js', '.mjs', '.json', '.md', '.txt']).has(extname(filePath).toLowerCase());
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}
async function readSettings(repoDir) {
  const repoInfo = await getRepoInfo(repoDir);
  if (repoInfo.type !== 'framework') {
    return getGenericSettings(repoDir);
  }

  const path = join(repoDir, 'appsettings.json');
  return JSON.parse(await readFile(path, 'utf-8'));
}

function getGenericSettings(repoDir) {
  return {
    repoType: 'generic-playwright',
    application: { baseUrl: '' },
    api: { baseUrl: '' },
    browser: {
      name: 'chromium',
      browsers: ['project settings'],
      headless: true,
      slowMo: 0
    },
    testSelection: { tests: [] },
    message: 'This repo is not using the automation framework. Test execution is available, but framework settings are disabled.'
  };
}

function getCompatibilityMessage(repoType) {
  if (repoType === 'generic-playwright') {
    return 'Repo incompatible with framework. Test execution is available, but framework settings and repo-modifying actions are disabled.';
  }

  return '';
}

async function writeSettings(repoDir, settings) {
  const path = join(repoDir, 'appsettings.json');
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

async function discoverTests(repoDir) {
  const result = await runProcess(repoDir, 'npx.cmd', ['playwright', 'test', ...await getPlaywrightConfigArgs(repoDir), '--list'], {
    env: localTempEnv(repoDir)
  });

  if (!result.ok) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n') || 'Unable to discover tests.');
  }

  return {
    ok: true,
    tests: parseListedTests(result.stdout)
  };
}

function parseListedTests(stdout) {
  const tests = new Map();

  for (const line of stdout.split(/\r?\n/)) {
    const test = parseListedTestLine(line);
    if (!test) {
      continue;
    }

    const existing = tests.get(test.id);
    if (existing) {
      existing.projects = [...new Set([...existing.projects, ...test.projects])].sort();
    } else {
      tests.set(test.id, test);
    }
  }

  return [...tests.values()].sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    return fileCompare || a.title.localeCompare(b.title);
  });
}

function parseListedTestLine(line) {
  const match = line.trim().match(/^\[([^\]]+)]\s+›\s+(.+)$/);
  if (!match) {
    return null;
  }

  const [, project, rest] = match;
  const parts = rest.split(/\s+›\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const location = parts[0];
  const titleParts = parts.slice(1);
  const title = titleParts.at(-1) ?? '';
  const suite = titleParts.slice(0, -1).join(' > ');
  const file = location.replace(/:\d+:\d+$/, '');
  const id = `${file}::${suite}::${title}`;

  return {
    id,
    title,
    suite,
    file,
    location,
    projects: [project]
  };
}

async function runAllowedCommand(repoDir, id, options = {}) {
  if (id === 'testSelected') {
    return runSelectedTests(repoDir, options.tests);
  }

  if (id === 'testUi') {
    return runTestUi(repoDir, options.tests);
  }

  if (id === 'testAll') {
    return runAllTests(repoDir);
  }

  if (id === 'listTests') {
    return runListTests(repoDir);
  }

  const definition = commands[id];
  if (!definition) {
    throw new Error(`Unknown command: ${id}`);
  }

  if (definition.confirm && options.confirm !== true) {
    throw new Error(`${definition.label} requires confirmation.`);
  }

  return runProcess(repoDir, definition.command, definition.args, {
    env: definition.useLocalTemp ? localTempEnv(repoDir) : undefined,
    allowNonZero: definition.allowNonZero,
    detached: definition.detached
  });
}

async function runAllTests(repoDir) {
  return runProcess(repoDir, 'npx.cmd', ['playwright', 'test', ...await getPlaywrightConfigArgs(repoDir)], {
    env: localTempEnv(repoDir)
  });
}

async function runListTests(repoDir) {
  return runProcess(repoDir, 'npx.cmd', ['playwright', 'test', ...await getPlaywrightConfigArgs(repoDir), '--list'], {
    env: localTempEnv(repoDir)
  });
}

async function runSelectedTests(repoDir, tests) {
  const selectedLocations = await getSelectedTestLocations(repoDir, tests);
  if (!selectedLocations.length) {
    throw new Error('Select one or more tests before running selected tests.');
  }

  return runProcess(repoDir, 'npx.cmd', ['playwright', 'test', ...await getPlaywrightConfigArgs(repoDir), ...selectedLocations], {
    env: localTempEnv(repoDir)
  });
}

async function runTestUi(repoDir, tests) {
  const selectedLocations = await getSelectedTestLocations(repoDir, tests);
  const args = ['playwright', 'test', ...await getPlaywrightConfigArgs(repoDir), '--ui', ...selectedLocations];

  return runProcess(repoDir, 'npx.cmd', args, {
    env: localTempEnv(repoDir),
    detached: true
  });
}

async function getSelectedTestLocations(repoDir, tests) {
  const repoInfo = await getRepoInfo(repoDir);
  const settings = repoInfo.type === 'framework' ? await readSettings(repoDir) : {};
  const selectedTests = Array.isArray(tests)
    ? tests
    : Array.isArray(settings.testSelection?.tests) ? settings.testSelection.tests : [];
  if (!selectedTests.length) {
    return [];
  }

  const selectedLocations = [...new Set(selectedTests
    .map((test) => validateSelectedTestLocation(repoDir, test?.location))
    .filter(Boolean))];

  if (!selectedLocations.length) {
    throw new Error('Selected tests were not found. Search again and save the selection before running.');
  }

  return selectedLocations;
}

async function getPlaywrightConfigArgs(repoDir) {
  const repoInfo = await getRepoInfo(repoDir);
  if (!repoInfo.configPath) {
    throw new Error('Playwright config file was not found.');
  }

  return ['-c', normalize(relative(repoDir, repoInfo.configPath)).replaceAll('\\', '/')];
}

function validateSelectedTestLocation(repoDir, location) {
  if (typeof location !== 'string') {
    return '';
  }

  const match = location.match(/^(.+):(\d+):(\d+)$/);
  if (!match) {
    throw new Error(`Invalid selected test location: ${location}`);
  }

  const [, file, line, column] = match;
  const absoluteFile = resolveSelectedTestFile(repoDir, file);
  const relativePath = relative(repoDir, absoluteFile);

  if (relativePath.startsWith('..') || relativePath === '' || resolve(repoDir, relativePath) !== absoluteFile) {
    throw new Error(`Selected test must be inside the app repo: ${location}`);
  }

  return `${normalize(relativePath).replaceAll('\\', '/')}:${line}:${column}`;
}

function resolveSelectedTestFile(repoDir, file) {
  const candidates = [
    resolve(repoDir, file),
    resolve(repoDir, '_automation', 'tests', file)
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    return found;
  }

  throw new Error(`Selected test file was not found: ${file}`);
}

async function cleanupGeneratedFiles(repoDir) {
  for (const target of cleanupTargets) {
    await rm(join(repoDir, target), { recursive: true, force: true });
  }
}

function hasValidSession(request) {
  const cookieHeader = request.headers.cookie ?? '';
  const cookieValue = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('automation_dashboard_session='))
    ?.split('=')
    .slice(1)
    .join('=');

  if (!cookieValue) {
    return false;
  }

  const expected = Buffer.from(sessionToken);
  const actual = Buffer.from(cookieValue);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function stopAutomationProcesses() {
  stopTrackedProcesses();
  setTimeout(() => process.exit(0), 500);
}

function stopTrackedProcesses() {
  const automationPidFile = join(hostRootDir, '.tmp', 'automation-pids.json');
  if (!existsSync(automationPidFile)) {
    return;
  }

  readFile(automationPidFile, 'utf-8')
    .then((content) => {
      const entries = JSON.parse(content);
      if (!Array.isArray(entries)) {
        return;
      }

      for (const entry of entries) {
        const pid = Number(entry.pid);
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
          spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          });
        }
      }
    })
    .catch(() => {
      // Best-effort shutdown only.
    });
}

function handoffToHomeDashboard() {
  closeDashboardServer(() => {
    const child = spawn(process.execPath, ['tools/dashboard-home/server.mjs'], {
      cwd: hostRootDir,
      env: {
        ...process.env,
        DASHBOARD_HOST: host,
        DASHBOARD_PORT: String(port)
      },
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    });

    child.unref();
    process.exit(0);
  });
}

function closeDashboardServer(onClosed) {
  let closed = false;
  server.close(() => {
    closed = true;
    onClosed();
  });

  setTimeout(() => {
    if (closed) {
      return;
    }

    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }, 500).unref();
}

async function listArtifacts(repoDir) {
  const roots = ['playwright-report', 'test-results'];
  const artifacts = [];

  for (const artifactRoot of roots) {
    const absoluteRoot = join(repoDir, artifactRoot);
    if (!existsSync(absoluteRoot)) {
      continue;
    }

    const files = await walk(absoluteRoot);
    artifacts.push(
      ...files.map((file) => ({
        file: normalize(relative(repoDir, file)).replaceAll('\\', '/'),
        name: normalize(relative(absoluteRoot, file)).replaceAll('\\', '/')
      }))
    );
  }

  return artifacts;
}

function runProcess(repoDir, command, args, options = {}) {
  if (options.detached === true && process.platform === 'win32') {
    return runWindowsBackgroundProcess(repoDir, command, args, options);
  }

  return new Promise((resolveProcess) => {
    const isDetached = options.detached === true;
    const processCommand = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : command;
    const processArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', toWindowsCommandLine(command, args)]
      : args;

    const child = spawn(processCommand, processArgs, {
      cwd: repoDir,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      windowsHide: true,
      detached: isDetached,
      stdio: isDetached ? 'ignore' : 'pipe'
    });

    let stdout = '';
    let stderr = '';

    if (!isDetached) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('error', (error) => {
      resolveProcess({
        ok: false,
        exitCode: -1,
        command: `${command} ${args.join(' ')}`,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });

    child.on('close', (exitCode) => {
      const ok = exitCode === 0 || options.allowNonZero === true || isDetached;
      resolveProcess({
        ok,
        exitCode,
        command: `${command} ${args.join(' ')}`,
        stdout,
        stderr
      });
    });

    if (isDetached) {
      recordAutomationPid(repoDir, child.pid, `${command} ${args.join(' ')}`);
      child.unref();
      resolveProcess({
        ok: true,
        exitCode: 0,
        command: `${command} ${args.join(' ')}`,
        stdout: 'Started in the background. You can close the Playwright UI or Recorder window when finished, or use Stop Automation.cmd.',
        stderr: ''
      });
    }
  });
}

function runWindowsBackgroundProcess(repoDir, command, args, options = {}) {
  return new Promise((resolveProcess) => {
    const envAssignments = Object.entries(options.env ?? {})
      .map(([name, value]) => `$env:${name}=${toPowerShellString(value)}`)
      .join('; ');
    const argumentList = args.map(toPowerShellString).join(', ');
    const script = [
      envAssignments,
      `$process = Start-Process -FilePath ${toPowerShellString(command)} -ArgumentList @(${argumentList}) -WorkingDirectory ${toPowerShellString(repoDir)} -WindowStyle Hidden -PassThru`,
      '$process.Id'
    ].filter(Boolean).join('; ');

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], {
      cwd: repoDir,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      windowsHide: true,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolveProcess({
        ok: false,
        exitCode: -1,
        command: `${command} ${args.join(' ')}`,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });

    child.on('close', (exitCode) => {
      const pid = Number(stdout.trim().split(/\s+/).at(-1));
      if (exitCode === 0 && Number.isInteger(pid) && pid > 0) {
        recordAutomationPid(repoDir, pid, `${command} ${args.join(' ')}`);
        resolveProcess({
          ok: true,
          exitCode,
          command: `${command} ${args.join(' ')}`,
          stdout: 'Started in the background. You can close the Playwright UI or Recorder window when finished, or use Stop Automation.cmd.',
          stderr: ''
        });
        return;
      }

      resolveProcess({
        ok: false,
        exitCode,
        command: `${command} ${args.join(' ')}`,
        stdout,
        stderr
      });
    });
  });
}

async function recordAutomationPid(repoDir, pid, command) {
  if (!pid) {
    return;
  }

  const automationPidFile = join(hostRootDir, '.tmp', 'automation-pids.json');

  try {
    await mkdir(join(hostRootDir, '.tmp'), { recursive: true });
    let entries = [];
    if (existsSync(automationPidFile)) {
      entries = JSON.parse(await readFile(automationPidFile, 'utf-8'));
      if (!Array.isArray(entries)) {
        entries = [];
      }
    }

    entries.push({
      pid,
      repoDir,
      command,
      startedAt: new Date().toISOString()
    });

    await writeFile(automationPidFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  } catch (error) {
    console.warn(`Unable to record automation PID: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toWindowsCommandLine(command, args) {
  return [command, ...args].map(quoteWindowsArgument).join(' ');
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[()\s&|<>^"]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '\\"')}"`;
}

function toPowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(publicDir, `.${requestedPath}`);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !(await stat(filePath)).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const headers = {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
  };
  if (requestedPath === '/index.html') {
    headers['Set-Cookie'] = sessionCookie;
  }

  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
}

async function serveReport(pathname, response) {
  const match = pathname.match(/^\/reports\/([^/]+)\/playwright(?:\/(.*))?$/);
  if (!match) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const repoName = decodeURIComponent(match[1]);
  if (repoName.includes('/') || repoName.includes('\\') || repoName === '..') {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  const repoDir = resolve(workspaceRoot, repoName);
  if (!(await isAppAutomationRepo(repoDir))) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const requestedPath = match[2] || 'index.html';
  const reportRoot = resolve(repoDir, 'playwright-report');
  const filePath = resolve(reportRoot, requestedPath);

  if (!filePath.startsWith(reportRoot)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !(await stat(filePath)).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}

async function generateTestWithAi(body) {
  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('AI prompt is required.');
  }

  const config = getAiConnectorConfig();
  if (!config.enabled) {
    throw new Error(config.message);
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.extraHeaders
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages: [
        {
          role: 'system',
          content: 'You generate reviewable framework-compatible Playwright automation test proposals. Follow the requested output format exactly.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message ?? response.statusText ?? 'AI request failed.';
    throw new Error(`AI connector request failed: ${message}`);
  }

  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('AI connector returned no generated content.');
  }

  return {
    ok: true,
    provider: config.provider,
    model: config.model,
    generatedAt: new Date().toISOString(),
    text
  };
}

async function captureFeedbackSnapshot(repoDir, body) {
  const eventName = String(body.eventName ?? 'wizard_snapshot').trim() || 'wizard_snapshot';
  const request = body.request && typeof body.request === 'object' ? body.request : {};
  const repoInfo = await getRepoInfo(repoDir);
  const now = new Date().toISOString();
  const sessionId = String(body.sessionId ?? '').trim() || feedbackStore.createSession({
    createdAt: now,
    repoName: basename(repoDir),
    repoPath: repoDir,
    automationRoot: join(repoDir, '_automation'),
    testType: request.testType,
    testSuite: request.testSuite,
    scenario: request.scenario,
    testObjective: request.testObjective,
    passCondition: request.passCondition,
    status: 'draft',
    promptFlow: body.promptFlow === 'guided' ? 'guided' : 'quick',
    promptVersion: 'capture-only-v1',
    notes: 'Capture-only feedback session. Records are not applied to prompts or rules automatically.'
  });

  feedbackStore.updateSessionStatus(sessionId, 'draft', {
    notes: `Latest passive capture event: ${eventName}`
  });

  feedbackStore.addCaptureEvent(sessionId, {
    eventName,
    payload: {
      ...body,
      sessionId,
      repo: {
        name: basename(repoDir),
        path: repoDir,
        type: repoInfo.type,
        automationRoot: join(repoDir, '_automation')
      },
      capturedAt: now
    }
  });

  return {
    ok: true,
    mode: 'capture-only',
    sessionId,
    capturedAt: now
  };
}

function getAiConnectorConfig() {
  const provider = process.env.AI_CONNECTOR_PROVIDER ?? process.env.AI_PROVIDER ?? 'openai-compatible';
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  const model = process.env.AI_MODEL ?? '';
  const baseUrl = String(process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const temperature = Number(process.env.AI_TEMPERATURE ?? 0.2);
  const extraHeaders = parseAiExtraHeaders(process.env.AI_EXTRA_HEADERS_JSON);

  if (!apiKey || !model) {
    return {
      enabled: false,
      message: 'AI connector is not configured. Set AI_API_KEY or OPENAI_API_KEY and AI_MODEL before using Generate Test with AI.'
    };
  }

  return {
    enabled: true,
    provider,
    apiKey,
    model,
    baseUrl,
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
    extraHeaders
  };
}

function parseAiExtraHeaders(value) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString('utf-8');
  return body ? JSON.parse(body) : {};
}

async function sendJson(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data, null, 2));
}
