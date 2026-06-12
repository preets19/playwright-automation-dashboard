import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dashboardDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const publicDir = join(dashboardDir, 'public');
const port = Number(process.env.DASHBOARD_PORT ?? 4310);
const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';
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
  ['.json', 'application/json; charset=utf-8']
]);

const maintenanceCommands = {
  build: {
    command: 'npm.cmd',
    args: ['run', 'framework:build']
  },
  outdated: {
    command: 'npm.cmd',
    args: ['outdated'],
    allowNonZero: true
  },
  audit: {
    command: 'npm.cmd',
    args: ['audit', '--audit-level=moderate'],
    allowNonZero: true
  },
  installBrowsers: {
    command: 'npx.cmd',
    args: ['playwright', 'install'],
    confirm: true,
    successMessage: 'Playwright browser install completed. If browsers were already installed, no download was needed.'
  }
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if (url.pathname === '/api/repos') {
      await sendJson(response, await discoverRepos(url.searchParams.get('repoPath')));
      return;
    }

    if (url.pathname === '/api/status') {
      await sendJson(response, await getStatus(url.searchParams.get('repoDir')));
      return;
    }

    if (url.pathname === '/api/process') {
      await sendJson(response, { ok: true, pid: process.pid });
      return;
    }

    if (url.pathname === '/api/setup' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await sendJson(response, await runDashboardCmd(body.repoDir, 'setup-once.cmd'));
      return;
    }

    if (url.pathname === '/api/update-framework' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await sendJson(response, await runDashboardCmd(body.repoDir, 'update-framework.cmd'));
      return;
    }

    if (url.pathname === '/api/git-status' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await sendJson(response, await runGitStatus(body.repoDir));
      return;
    }

    if (url.pathname === '/api/maintenance' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await sendJson(response, await runMaintenanceCommand(body.repoDir, body.id, body));
      return;
    }

    if (url.pathname === '/api/open-test-dashboard' && request.method === 'POST') {
      const body = await readRequestJson(request);
      await sendJson(response, await openTestDashboard(body.repoDir));
      return;
    }

    if (url.pathname === '/api/stop-automation' && request.method === 'POST') {
      await sendJson(response, { ok: true, message: 'Dashboard is stopping.' });
      setTimeout(() => process.exit(0), 250);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    await sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    process.exit(0);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host);

async function discoverRepos(repoPath) {
  const root = resolveRepoPath(repoPath, 'Repo path');
  if (!existsSync(root) || !(await stat(root)).isDirectory()) {
    throw new Error(`Repo path was not found: ${root}`);
  }

  const entries = await readdir(root, { withFileTypes: true });
  const repos = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const repoDir = join(root, entry.name);
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
  return { root, repos };
}

async function getStatus(repoDir) {
  const rootDir = resolveRepoPath(repoDir, 'Repo');
  if (!existsSync(rootDir) || !(await stat(rootDir)).isDirectory()) {
    throw new Error(`Repo was not found: ${rootDir}`);
  }

  const repoInfo = await getRepoInfo(rootDir);
  if (repoInfo.type === 'unsupported') {
    throw new Error('Repo incompatible with framework.');
  }

  const [nodeVersion, npmVersion, playwrightVersion] = await Promise.all([
    runProcess(rootDir, 'node', ['--version']),
    runProcess(rootDir, 'npm.cmd', ['--version']),
    runProcess(rootDir, 'npx.cmd', ['playwright', '--version'])
  ]);

  return {
    rootDir,
    repoName: basename(rootDir),
    repoType: repoInfo.type,
    node: nodeVersion.stdout.trim(),
    npm: npmVersion.stdout.trim(),
    playwright: playwrightVersion.stdout.trim()
  };
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
      return { type: 'framework' };
    }

    if (configPath && hasPlaywright) {
      return { type: 'generic-playwright' };
    }

    return { type: 'unsupported' };
  } catch {
    return { type: 'unsupported' };
  }
}

function resolveRepoPath(value, label) {
  if (!value || !String(value).trim()) {
    throw new Error(`${label} is required.`);
  }

  return resolve(String(value));
}

function runProcess(cwd, command, args, options = {}) {
  return new Promise((resolveProcess) => {
    const processCommand = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : command;
    const processArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArgument).join(' ')]
      : args;
    const child = spawn(processCommand, processArgs, {
      cwd,
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
      resolveProcess({ ok: false, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (exitCode) => {
      resolveProcess({ ok: exitCode === 0 || options.allowNonZero === true, exitCode, stdout, stderr });
    });
  });
}

async function runDashboardCmd(repoDir, scriptName) {
  const rootDir = resolveRepoPath(repoDir, 'Repo');
  if (!existsSync(rootDir) || !(await stat(rootDir)).isDirectory()) {
    throw new Error(`Repo was not found: ${rootDir}`);
  }

  const scriptPath = join(dashboardDir, 'scripts', 'windows', scriptName);
  if (!existsSync(scriptPath)) {
    throw new Error(`Dashboard command was not found: ${scriptPath}`);
  }

  return new Promise((resolveProcess) => {
    const child = spawn(process.env.ComSpec ?? 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      [scriptPath, rootDir].map(quoteWindowsArgument).join(' ')
    ], {
      cwd: dashboardDir,
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
        command: `${scriptName} ${rootDir}`,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });
    child.on('close', (exitCode) => {
      resolveProcess({
        ok: exitCode === 0,
        exitCode,
        command: `${scriptName} ${rootDir}`,
        stdout,
        stderr
      });
    });
  });
}

async function runGitStatus(repoDir) {
  const rootDir = resolveRepoPath(repoDir, 'Repo');
  if (!existsSync(rootDir) || !(await stat(rootDir)).isDirectory()) {
    throw new Error(`Repo was not found: ${rootDir}`);
  }

  const result = await runProcess(rootDir, 'git', ['status', '--short', '--branch']);
  return {
    ...result,
    command: `git status --short --branch (${rootDir})`,
    stdout: result.stdout.trim() || 'Working tree clean.'
  };
}

async function runMaintenanceCommand(repoDir, id, options = {}) {
  const rootDir = resolveRepoPath(repoDir, 'Repo');
  if (!existsSync(rootDir) || !(await stat(rootDir)).isDirectory()) {
    throw new Error(`Repo was not found: ${rootDir}`);
  }

  if (id === 'mcpSmoke') {
    return runMcpSmokeTest(rootDir);
  }

  const definition = maintenanceCommands[id];
  if (!definition) {
    throw new Error(`Unknown maintenance command: ${id}`);
  }

  if (definition.confirm && options.confirm !== true) {
    throw new Error('Install Browsers requires confirmation.');
  }

  const result = await runProcess(rootDir, definition.command, definition.args, {
    allowNonZero: definition.allowNonZero
  });
  const stdout = result.stdout.trim() || (result.ok ? definition.successMessage ?? '' : '');

  return {
    ...result,
    command: `${definition.command} ${definition.args.join(' ')}`,
    stdout
  };
}

async function runMcpSmokeTest(rootDir) {
  const scriptPath = join(dashboardDir, 'tools', 'automation-context-mcp', 'smoke-test.mjs');
  if (!existsSync(scriptPath)) {
    throw new Error(`MCP smoke test was not found: ${scriptPath}`);
  }

  const frameworkRepo = join(dirname(rootDir), 'playwright-base-framework');
  const result = await runProcess(dashboardDir, 'node', [
    scriptPath,
    '--appRepo',
    rootDir,
    '--frameworkRepo',
    frameworkRepo
  ]);

  return {
    ...result,
    command: `node ${scriptPath} --appRepo ${rootDir}`,
    stdout: result.stdout.trim() || (result.ok ? 'MCP context validation completed successfully.' : '')
  };
}

async function openTestDashboard(repoDir) {
  const rootDir = resolveRepoPath(repoDir, 'Repo');
  if (!existsSync(rootDir) || !(await stat(rootDir)).isDirectory()) {
    throw new Error(`Repo was not found: ${rootDir}`);
  }

  const repoInfo = await getRepoInfo(rootDir);
  if (repoInfo.type === 'unsupported') {
    throw new Error('Repo incompatible with framework.');
  }

  setTimeout(() => handoffToTestDashboard(rootDir), 500);
  return {
    ok: true,
    url: `http://${host}:${port}/`,
    message: 'Loading Test Dashboard. Home Dashboard will close in the background.'
  };
}

function handoffToTestDashboard(repoDir) {
  closeDashboardServer(() => {
    const child = spawn(process.execPath, ['tools/test-dashboard/server.mjs'], {
      cwd: dashboardDir,
      env: {
        ...process.env,
        AUTOMATION_WORKSPACE_ROOT: dirname(repoDir),
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

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString('utf-8');
  return body ? JSON.parse(body) : {};
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[()\s&|<>^"]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '\\"')}"`;
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

  response.writeHead(200, {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}

async function sendJson(response, data, statusCode = 200) {
  const body = JSON.stringify(data, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}
