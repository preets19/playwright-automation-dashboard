import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const serverPath = resolve(dashboardRoot, 'tools/automation-context-mcp/server.mjs');
const args = parseArgs(process.argv.slice(2));
const appRepoPath = resolve(args.appRepo ?? resolve(dashboardRoot, '..', 'playwright-app-template'));
const frameworkRepoPath = resolve(args.frameworkRepo ?? resolve(dashboardRoot, '..', 'playwright-base-framework'));

const child = spawn(process.execPath, [serverPath], {
  cwd: dashboardRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    AUTOMATION_WORKSPACE_ROOT: resolve(dashboardRoot, '..')
  }
});

let nextId = 1;
const pending = new Map();
let stdout = '';
let stderr = '';

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
  const lines = stdout.split(/\r?\n/);
  stdout = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const message = JSON.parse(line);
    const deferred = pending.get(message.id);
    if (deferred) {
      pending.delete(message.id);
      deferred.resolve(message);
    }
  }
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});

function request(method, params = {}) {
  const id = nextId++;
  const message = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(`${JSON.stringify(message)}\n`);

  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${method}`));
      }
    }, 5_000);
  });
}

async function callTool(name, args = {}) {
  const response = await request('tools/call', {
    name,
    arguments: args
  });

  if (response.error) {
    throw new Error(`${name} failed: ${response.error.message}`);
  }

  const text = response.result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function includes(value, expected, message) {
  assert(String(value).includes(expected), message);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--appRepo') {
      parsed.appRepo = argv[index + 1];
      index += 1;
    } else if (arg === '--frameworkRepo') {
      parsed.frameworkRepo = argv[index + 1];
      index += 1;
    }
  }

  return parsed;
}

async function main() {
  const initialize = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'automation-context-smoke-test', version: '0.1.0' }
  });
  assert(initialize.result?.serverInfo?.name === 'automation-context', 'initialize returned unexpected serverInfo');

  const toolsList = await request('tools/list');
  const toolNames = toolsList.result?.tools?.map((tool) => tool.name) ?? [];
  [
    'get_repo_context',
    'list_automation_artifacts',
    'get_test_generation_rules',
    'get_output_template',
    'get_lessons_learned',
    'read_artifact',
    'get_relevant_examples',
    'summarize_repo_conventions'
  ].forEach((toolName) => {
    assert(toolNames.includes(toolName), `tools/list missing ${toolName}`);
  });

  const context = await callTool('get_repo_context', { appRepoPath, frameworkRepoPath });
  assert(context.activeAppRepo === appRepoPath, 'get_repo_context returned wrong app repo');
  assert(context.baseFrameworkRepo === frameworkRepoPath, 'get_repo_context returned wrong framework repo');
  assert(context.frameworkDependency, 'get_repo_context did not return framework dependency');

  const artifacts = await callTool('list_automation_artifacts', { appRepoPath });
  assert(artifacts.pages.some((file) => file.endsWith('loginPage.ts')), 'list_automation_artifacts missing loginPage');
  assert(artifacts.workflows.some((file) => file.endsWith('loginWorkflow.ts')), 'list_automation_artifacts missing loginWorkflow');
  assert(artifacts.models.some((file) => file.endsWith('userModel.ts')), 'list_automation_artifacts missing userModel');
  assert(artifacts.testData.some((file) => file.endsWith('users.ts')), 'list_automation_artifacts missing users test data');
  assert(artifacts.tests.some((file) => file.endsWith('login.spec.ts')), 'list_automation_artifacts missing login spec');

  const rules = await callTool('get_test_generation_rules', { frameworkRepoPath });
  includes(rules, 'Test Generation Rules', 'get_test_generation_rules missing heading');
  includes(rules, 'Prefer reuse over creation', 'get_test_generation_rules missing reuse guidance');

  const outputTemplate = await callTool('get_output_template', { frameworkRepoPath });
  includes(outputTemplate, 'Framework Mapping', 'get_output_template missing Framework Mapping');
  includes(outputTemplate, 'Generated Code', 'get_output_template missing Generated Code');

  const lessons = await callTool('get_lessons_learned', { frameworkRepoPath });
  includes(lessons, 'Test Generation Lessons Learned', 'get_lessons_learned missing heading');

  const artifact = await callTool('read_artifact', {
    appRepoPath,
    frameworkRepoPath,
    filePath: '_automation/tests/ui/login.spec.ts'
  });
  includes(artifact.content, 'LoginWorkflow', 'read_artifact missing expected login workflow reference');

  const examples = await callTool('get_relevant_examples', {
    appRepoPath,
    query: 'login',
    artifactTypes: ['tests', 'workflows', 'pages', 'testData', 'models'],
    limit: 5
  });
  assert(examples.examples.some((example) => example.file.includes('login')), 'get_relevant_examples did not return login-related files');

  const conventions = await callTool('summarize_repo_conventions', { appRepoPath, frameworkRepoPath });
  assert(conventions.observedConventions.frameworkImport.includes('@your-org/playwright-base-framework'), 'summarize_repo_conventions missed framework import');
  assert(conventions.observedConventions.pageObjectPattern.includes('BasePage'), 'summarize_repo_conventions missed BasePage pattern');
  assert(conventions.basePage?.content?.includes('export class BasePage'), 'summarize_repo_conventions missing BasePage content');

  child.stdin.end();
  child.kill();
  console.log('automation-context MCP smoke test passed.');
}

main().catch(async (error) => {
  child.kill();
  if (stderr) {
    console.error(stderr);
  }
  console.error(error);
  process.exitCode = 1;
  await once(child, 'exit').catch(() => {});
});
