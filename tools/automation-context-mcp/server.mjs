import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFrameworkAsset, resolveFrameworkRoots } from '../shared/framework-resolver.mjs';

const dashboardRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(process.env.AUTOMATION_WORKSPACE_ROOT ?? resolve(homedir(), 'Source', 'Repo'));
const activeRepoStatePath = join(dashboardRoot, '.tmp', 'active-repo.json');
const maxFileBytes = 80_000;

const tools = [
  {
    name: 'get_repo_context',
    description: 'Return scoped repository paths and package metadata for the active app automation repo.',
    inputSchema: {
      type: 'object',
      properties: {
        appRepoPath: { type: 'string', description: 'Selected app automation repo path. Preferred over dashboard state.' },
        frameworkRepoPath: { type: 'string', description: 'Optional base framework repo path.' }
      }
    }
  },
  {
    name: 'list_automation_artifacts',
    description: 'List pages, workflows, models, test data, and tests under the selected app repo _automation folder.',
    inputSchema: {
      type: 'object',
      properties: {
        appRepoPath: { type: 'string', description: 'Selected app automation repo path.' }
      },
      required: ['appRepoPath']
    }
  },
  {
    name: 'get_test_generation_rules',
    description: 'Read the shared test generation rules from the base framework .ai folder.',
    inputSchema: {
      type: 'object',
      properties: {
        frameworkRepoPath: { type: 'string', description: 'Optional base framework repo path.' }
      }
    }
  },
  {
    name: 'get_output_template',
    description: 'Read the shared test generation output template from the base framework .ai folder.',
    inputSchema: {
      type: 'object',
      properties: {
        frameworkRepoPath: { type: 'string', description: 'Optional base framework repo path.' }
      }
    }
  },
  {
    name: 'get_lessons_learned',
    description: 'Read active test generation lessons from the base framework .ai folder when available.',
    inputSchema: {
      type: 'object',
      properties: {
        frameworkRepoPath: { type: 'string', description: 'Optional base framework repo path.' }
      }
    }
  },
  {
    name: 'read_artifact',
    description: 'Read a permitted artifact from the selected app _automation folder or base framework src/.ai folders.',
    inputSchema: {
      type: 'object',
      properties: {
        appRepoPath: { type: 'string', description: 'Selected app automation repo path.' },
        frameworkRepoPath: { type: 'string', description: 'Optional base framework repo path.' },
        filePath: { type: 'string', description: 'Absolute or repo-relative artifact path to read.' }
      },
      required: ['filePath']
    }
  },
  {
    name: 'get_relevant_examples',
    description: 'Return representative examples from the selected app repo that match artifact types or a search query.',
    inputSchema: {
      type: 'object',
      properties: {
        appRepoPath: { type: 'string', description: 'Selected app automation repo path.' },
        query: { type: 'string', description: 'Optional case-insensitive text query.' },
        artifactTypes: {
          type: 'array',
          items: { type: 'string', enum: ['pages', 'workflows', 'models', 'testData', 'tests'] },
          description: 'Optional artifact type filter.'
        },
        limit: { type: 'number', description: 'Maximum files to return. Default 6.' }
      },
      required: ['appRepoPath']
    }
  },
  {
    name: 'summarize_repo_conventions',
    description: 'Summarize observed app automation conventions from representative files in the selected app repo.',
    inputSchema: {
      type: 'object',
      properties: {
        appRepoPath: { type: 'string', description: 'Selected app automation repo path.' },
        frameworkRepoPath: { type: 'string', description: 'Optional base framework repo path.' }
      },
      required: ['appRepoPath']
    }
  }
];

let contentLengthBuffer = Buffer.alloc(0);
let lineBuffer = '';

process.stdin.on('data', (chunk) => {
  contentLengthBuffer = Buffer.concat([contentLengthBuffer, chunk]);
  parseContentLengthMessages();

  lineBuffer += chunk.toString('utf8');
  parseLineMessages();
});

process.stdin.on('error', () => {
  process.exit(1);
});

function parseContentLengthMessages() {
  while (true) {
    const headerEnd = contentLengthBuffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      return;
    }

    const header = contentLengthBuffer.slice(0, headerEnd).toString('utf8');
    const lengthMatch = header.match(/content-length:\s*(\d+)/i);
    if (!lengthMatch) {
      contentLengthBuffer = contentLengthBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (contentLengthBuffer.length < messageEnd) {
      return;
    }

    const payload = contentLengthBuffer.slice(messageStart, messageEnd).toString('utf8');
    contentLengthBuffer = contentLengthBuffer.slice(messageEnd);
    handlePayload(payload);
  }
}

function parseLineMessages() {
  const lines = lineBuffer.split(/\r?\n/);
  lineBuffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
      handlePayload(trimmed);
    }
  }
}

function handlePayload(payload) {
  let message;
  try {
    message = JSON.parse(payload);
  } catch {
    return;
  }

  if (message.method && message.id === undefined) {
    return;
  }

  handleMessage(message).catch((error) => {
    sendError(message.id, -32603, error instanceof Error ? error.message : String(error));
  });
}

async function handleMessage(message) {
  switch (message.method) {
    case 'initialize':
      sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'automation-context',
          version: '0.1.0'
        }
      });
      return;
    case 'tools/list':
      sendResult(message.id, { tools });
      return;
    case 'tools/call':
      await callTool(message);
      return;
    case 'ping':
      sendResult(message.id, {});
      return;
    default:
      sendError(message.id, -32601, `Unsupported method: ${message.method}`);
  }
}

async function callTool(message) {
  const { name, arguments: args = {} } = message.params ?? {};
  const result = await runTool(name, args);
  sendResult(message.id, {
    content: [
      {
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      }
    ]
  });
}

async function runTool(name, args) {
  switch (name) {
    case 'get_repo_context':
      return getRepoContext(args);
    case 'list_automation_artifacts':
      return listAutomationArtifacts(args);
    case 'get_test_generation_rules':
      return readFrameworkAiFile(args, 'test-generation-rules.md');
    case 'get_output_template':
      return readFrameworkAiFile(args, 'test-generation-output-template.md');
    case 'get_lessons_learned':
      return readFrameworkAiFile(args, 'lessons-learned.md', { optional: true });
    case 'read_artifact':
      return readArtifact(args);
    case 'get_relevant_examples':
      return getRelevantExamples(args);
    case 'summarize_repo_conventions':
      return summarizeRepoConventions(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getRepoContext(args) {
  const appRepo = await resolveAppRepo(args.appRepoPath, { allowMissingExplicit: false });
  const roots = await resolveRootsForArgs({ ...args, appRepoPath: appRepo });
  const sourceAsset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, 'src'));
  const aiAsset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, '.ai'));
  const packageJson = await readJsonIfExists(join(appRepo, 'package.json'));
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };

  return {
    workspaceRoot,
    activeAppRepo: appRepo,
    appAutomationRoot: join(appRepo, '_automation'),
    frameworkPackage: '@your-org/playwright-base-framework',
    frameworkDependency: dependencies['@your-org/playwright-base-framework'] ?? null,
    baseFrameworkRepo: roots.dependencyRepo ?? roots.legacyRepo ?? null,
    baseFrameworkSourceRoot: sourceAsset.available ? sourceAsset.resolvedPath : null,
    baseFrameworkAiRoot: aiAsset.available ? aiAsset.resolvedPath : null,
    readScope: [
      join(appRepo, '_automation'),
      ...(sourceAsset.available ? [sourceAsset.resolvedPath] : []),
      ...(aiAsset.available ? [aiAsset.resolvedPath] : [])
    ],
    generationRule: 'Use only the active app repo for app-specific artifacts. Do not borrow app artifacts from other repos unless explicitly requested.'
  };
}

async function listAutomationArtifacts(args) {
  const appRepo = await resolveAppRepo(args.appRepoPath, { allowMissingExplicit: false });
  const automationRoot = join(appRepo, '_automation');
  const files = existsSync(automationRoot) ? await walk(automationRoot) : [];
  const relativeFiles = files.map((file) => toPosix(relative(appRepo, file))).sort();

  return {
    appRepo,
    automationRoot,
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

async function readFrameworkAiFile(args, fileName, options = {}) {
  const roots = await resolveRootsForArgs(args);
  const aiAsset = resolveFrameworkAsset(roots, '.ai');
  if (!aiAsset.available) {
    if (options.optional) {
      return `${fileName} was not found.`;
    }

    throw new Error(aiAsset.message ?? 'Framework .ai/ could not be resolved.');
  }

  assertInsideWorkspace(aiAsset.frameworkRepo);
  const filePath = join(aiAsset.resolvedPath, fileName);
  if (!existsSync(filePath)) {
    if (options.optional) {
      return `${fileName} was not found.`;
    }

    throw new Error(`Framework AI file was not found: ${filePath}`);
  }

  return readSmallTextFile(filePath);
}

async function readArtifact(args) {
  const appRepo = await resolveAppRepo(args.appRepoPath, { allowMissingExplicit: true });
  const roots = await resolveRootsForArgs({ ...args, appRepoPath: appRepo });
  const filePath = resolveArtifactPath(args.filePath, appRepo, roots);

  const sourceAsset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, 'src'));
  const aiAsset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, '.ai'));
  assertAllowedRead(filePath, [
    join(appRepo, '_automation'),
    ...(sourceAsset.available ? [sourceAsset.resolvedPath] : []),
    ...(aiAsset.available ? [aiAsset.resolvedPath] : [])
  ]);

  return {
    filePath,
    content: await readSmallTextFile(filePath)
  };
}

async function getRelevantExamples(args) {
  const appRepo = await resolveAppRepo(args.appRepoPath, { allowMissingExplicit: false });
  const inventory = await listAutomationArtifacts({ appRepoPath: appRepo });
  const allowedTypes = new Set(Array.isArray(args.artifactTypes) && args.artifactTypes.length
    ? args.artifactTypes
    : ['pages', 'workflows', 'models', 'testData', 'tests']);
  const query = String(args.query ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(args.limit) || 6, 20));

  const candidates = [...allowedTypes].flatMap((type) => inventory[type] ?? []);
  const scored = [];

  for (const relativePath of candidates) {
    const absolutePath = join(appRepo, relativePath);
    const content = await readSmallTextFile(absolutePath, { optional: true });
    const haystack = `${relativePath}\n${content}`.toLowerCase();
    const score = query ? countOccurrences(haystack, query) : defaultExampleScore(relativePath);
    if (!query || score > 0) {
      scored.push({ relativePath, absolutePath, score, content });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));

  return {
    appRepo,
    query: query || null,
    examples: scored.slice(0, limit).map((item) => ({
      file: item.relativePath,
      content: item.content
    }))
  };
}

async function summarizeRepoConventions(args) {
  const appRepo = await resolveAppRepo(args.appRepoPath, { allowMissingExplicit: false });
  const roots = await resolveRootsForArgs({ ...args, appRepoPath: appRepo });
  const inventory = await listAutomationArtifacts({ appRepoPath: appRepo });
  const sampleFiles = [
    ...inventory.tests.slice(0, 3),
    ...inventory.workflows.slice(0, 3),
    ...inventory.pages.slice(0, 4),
    ...inventory.models.slice(0, 2),
    ...inventory.testData.slice(0, 2)
  ];
  const samples = await Promise.all(sampleFiles.map(async (relativePath) => ({
    file: relativePath,
    content: await readSmallTextFile(join(appRepo, relativePath), { optional: true })
  })));
  const sourceAsset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, 'src'));
  const basePagePath = sourceAsset.available ? join(sourceAsset.resolvedPath, 'core', 'basePage.ts') : null;

  return {
    appRepo,
    observedConventions: inferConventions(samples),
    sampleFiles: samples,
    basePage: basePagePath && existsSync(basePagePath)
      ? { file: basePagePath, content: await readSmallTextFile(basePagePath) }
      : null
  };
}

function inferConventions(samples) {
  const allContent = samples.map((sample) => sample.content).join('\n');
  return {
    frameworkImport: allContent.includes("@your-org/playwright-base-framework")
      ? "Uses imports from '@your-org/playwright-base-framework'."
      : 'No framework package import observed in sampled files.',
    jsExtensionImports: /\.js['"]/.test(allContent)
      ? 'Uses .js extensions in TypeScript relative imports.'
      : 'No .js relative import convention observed in sampled files.',
    pageObjectPattern: /extends BasePage/.test(allContent)
      ? 'Page objects extend BasePage.'
      : 'No BasePage extension observed in sampled files.',
    workflowPattern: /constructor\(private readonly page: Page\)/.test(allContent)
      ? 'Workflows commonly accept Playwright Page in the constructor.'
      : 'No common workflow constructor pattern detected in sampled files.',
    testImportPattern: /import \{ expect, test \} from '@your-org\/playwright-base-framework'/.test(allContent)
      ? 'Specs import expect and test from the framework package.'
      : 'Spec import pattern not detected in sampled files.'
  };
}

async function resolveAppRepo(appRepoPath, options = {}) {
  const explicit = String(appRepoPath ?? '').trim();
  if (explicit) {
    const appRepo = resolve(explicit);
    assertInsideWorkspace(appRepo);
    await assertDirectory(appRepo, 'App repo');
    return appRepo;
  }

  const activeRepo = await readActiveRepo();
  if (activeRepo) {
    assertInsideWorkspace(activeRepo);
    await assertDirectory(activeRepo, 'Active app repo');
    return activeRepo;
  }

  if (options.allowMissingExplicit) {
    throw new Error('appRepoPath is required because no dashboard active repo state was found.');
  }

  throw new Error('appRepoPath is required.');
}

// Resolves PRIMARY/LEGACY roots for a single tool call. Most tools pass appRepoPath explicitly;
// for framework-only tools (no appRepoPath in their schema) fall back to the dashboard's active
// repo state so PRIMARY's dependency check still has an app repo to inspect when one is known.
async function resolveRootsForArgs(args) {
  let appRepoDir = null;
  if (args.appRepoPath) {
    appRepoDir = resolve(String(args.appRepoPath));
  } else {
    appRepoDir = (await readActiveRepo()) || null;
  }

  return resolveFrameworkRoots({
    repoKey: appRepoDir ?? undefined,
    appRepoDir: appRepoDir ?? undefined,
    explicitOverridePath: args.frameworkRepoPath ? String(args.frameworkRepoPath) : undefined
  });
}

// Preserves this server's existing security boundary: every resolved framework path must be
// inside workspaceRoot, same as app repo paths, before it is ever trusted for a read.
function assertAssetInsideWorkspace(asset) {
  if (asset.available) {
    assertInsideWorkspace(asset.frameworkRepo);
  }

  return asset;
}

async function readActiveRepo() {
  if (!existsSync(activeRepoStatePath)) {
    return '';
  }

  const state = await readJsonIfExists(activeRepoStatePath);
  return state?.activeRepoPath ? resolve(String(state.activeRepoPath)) : '';
}

function resolveArtifactPath(filePath, appRepo, roots) {
  const requested = String(filePath ?? '').trim();
  if (!requested) {
    throw new Error('filePath is required.');
  }

  if (/^[A-Za-z]:[\\/]/.test(requested) || requested.startsWith('\\\\')) {
    return resolve(requested);
  }

  const normalized = normalize(requested);
  if (normalized.startsWith('_automation')) {
    return resolve(appRepo, normalized);
  }

  if (normalized.startsWith('src')) {
    const asset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, 'src'));
    if (!asset.available) {
      throw new Error(asset.message ?? 'Framework src/ could not be resolved.');
    }

    return resolve(asset.frameworkRepo, normalized);
  }

  if (normalized.startsWith('.ai')) {
    const asset = assertAssetInsideWorkspace(resolveFrameworkAsset(roots, '.ai'));
    if (!asset.available) {
      throw new Error(asset.message ?? 'Framework .ai/ could not be resolved.');
    }

    return resolve(asset.frameworkRepo, normalized);
  }

  return resolve(appRepo, normalized);
}

function assertAllowedRead(filePath, roots) {
  if (!existsSync(filePath)) {
    throw new Error(`File was not found: ${filePath}`);
  }

  if (!roots.some((root) => isInside(filePath, root))) {
    throw new Error(`File is outside the MCP read scope: ${filePath}`);
  }
}

function assertInsideWorkspace(targetPath) {
  if (!isInside(targetPath, workspaceRoot)) {
    throw new Error(`Path must be under workspace root ${workspaceRoot}: ${targetPath}`);
  }
}

async function assertDirectory(directory, label) {
  if (!existsSync(directory) || !(await stat(directory)).isDirectory()) {
    throw new Error(`${label} was not found: ${directory}`);
  }
}

function isInside(targetPath, rootPath) {
  const relativePath = relative(resolve(rootPath), resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !resolve(relativePath).startsWith('..'));
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (isTextLike(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isTextLike(filePath) {
  return new Set(['.ts', '.js', '.mjs', '.json', '.md', '.txt']).has(extname(filePath).toLowerCase());
}

async function readSmallTextFile(filePath, options = {}) {
  if (!existsSync(filePath)) {
    if (options.optional) {
      return '';
    }

    throw new Error(`File was not found: ${filePath}`);
  }

  const fileStat = await stat(filePath);
  if (fileStat.size > maxFileBytes) {
    return `${await readFile(filePath, 'utf8').then((value) => value.slice(0, maxFileBytes))}\n\n[Truncated at ${maxFileBytes} bytes]`;
  }

  return readFile(filePath, 'utf8');
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, 'utf8'));
}

function defaultExampleScore(relativePath) {
  if (relativePath.endsWith('login.spec.ts')) return 100;
  if (relativePath.includes('/tests/')) return 80;
  if (relativePath.includes('/workflows/')) return 70;
  if (relativePath.includes('/pages/')) return 60;
  return 10;
}

function countOccurrences(value, query) {
  return value.split(query).length - 1;
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
