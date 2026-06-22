import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflowReuseStore, sanitizeRecorderCode } from './workflow-reuse.mjs';

const tempDir = await mkdtemp(join(tmpdir(), 'workflow-reuse-'));
const workflowDir = join(tempDir, '_automation', 'workflows');
const workflowPath = join(workflowDir, 'loginWorkflow.ts');
const indexPath = join(tempDir, '_automation', 'context', 'workflowIndex.json');

const loginOperations = [
  operation(1, 'goto', 'Open application', 'Login'),
  operation(2, 'assertion', 'Confirm login readiness', 'Login', 'readiness'),
  operation(3, 'fill', 'Enter username', 'Login'),
  operation(4, 'fill', 'Enter password', 'Login'),
  operation(5, 'click', 'Submit login', 'Login')
];

try {
  await mkdir(workflowDir, { recursive: true });
  await writeFile(workflowPath, 'export class LoginWorkflow {}\n', 'utf-8');

  const store = createWorkflowReuseStore();
  const staged = await store.stageFromContract({
    repoPath: tempDir,
    parserOutput: { operationTrace: loginOperations },
    artifactContract: {
      workflows: [{ file: '_automation/workflows/loginWorkflow.ts', className: 'LoginWorkflow' }],
      methods: [{ owner: 'LoginWorkflow', name: 'login', sourceOperationOrders: [1, 2, 3, 4, 5] }]
    },
    formattedCode: "await page.getByLabel('Password').fill('secret-value');"
  });

  assert.equal(staged.length, 1);
  assert.equal(staged[0].status, 'available');

  const match = await store.match(tempDir, {
    operationTrace: [
      ...loginOperations,
      operation(6, 'select', 'Sort products', 'Inventory')
    ]
  });

  assert.equal(match.matches.length, 1);
  assert.equal(match.matches[0].workflowName, 'LoginWorkflow');
  assert.deepEqual(match.matches[0].operationOrders, [1, 2, 3, 4, 5]);
  assert.deepEqual(match.unmatchedOperationOrders, [6]);

  const index = JSON.parse(await readFile(indexPath, 'utf-8'));
  assert.equal(index.version, 1);
  assert.equal(index.workflows.length, 1);
  assert.equal(index.workflows[0].sanitizedRawCode.includes('secret-value'), false);
  assert.equal(
    sanitizeRecorderCode("await page.getByLabel('Password').fill('secret-value');"),
    "await page.getByLabel('Password').fill('<redacted>');"
  );

  await rm(workflowPath);
  assert.equal((await store.match(tempDir, { operationTrace: loginOperations })).matches.length, 0);

  console.log('workflow-reuse smoke test passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function operation(order, operationType, intentHint, pageOrStepHint, assertionRole = 'none') {
  return {
    order,
    operationType,
    intentHint,
    pageOrStepHint,
    assertionRole,
    isMeaningful: true,
    locatorParts: {
      childTargetType: operationType === 'goto' ? '' : 'testId',
      childTargetValue: operationType === 'goto' ? '' : `${pageOrStepHint}-${intentHint}`
    }
  };
}
