import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflowReuseStore, sanitizeRecorderCode } from './workflow-reuse.mjs';

const tempDir = await mkdtemp(join(tmpdir(), 'workflow-reuse-'));
const workflowDir = join(tempDir, '_automation', 'workflows');
const workflowPath = join(workflowDir, 'loginWorkflow.ts');
const submitWorkflowPath = join(workflowDir, 'submitWorkflow.ts');
const indexPath = join(tempDir, '_automation', 'context', 'workflowIndex.json');

const loginOperations = [
  operation(1, 'goto', 'Open application', 'Login'),
  operation(2, 'assertion', 'Confirm login readiness', 'Login', 'readiness'),
  operation(3, 'fill', 'Enter username', 'Login'),
  operation(4, 'fill', 'Enter password', 'Login'),
  operation(5, 'click', 'Submit login', 'Login')
];

// Independent action elsewhere in the recording, on a non-overlapping operation range,
// so LoginWorkflow's and SubmitWorkflow's matches can be verified without one subsuming
// the other under the matcher's overlap-exclusivity rule.
const submitOperations = [
  operation(7, 'click', 'Open submit dialog', 'Checkout'),
  operation(8, 'click', 'Confirm submit', 'Checkout')
];

try {
  await mkdir(workflowDir, { recursive: true });
  await writeFile(workflowPath, 'export class LoginWorkflow {}\n', 'utf-8');
  await writeFile(submitWorkflowPath, 'export class SubmitWorkflow {}\n', 'utf-8');

  const store = createWorkflowReuseStore();
  const staged = await store.stageFromContract({
    repoPath: tempDir,
    parserOutput: { operationTrace: [...loginOperations, ...submitOperations] },
    artifactContract: {
      workflows: [
        {
          ref: 'loginWorkflow',
          action: 'create',
          existingArtifact: '',
          filePath: '_automation/workflows/loginWorkflow.ts',
          className: 'LoginWorkflow',
          imports: [],
          dependsOn: [],
          // Realistic Prompt 3 separation: the readiness assertion at order 2 lives in its
          // own field, not in ownedActionOperationOrders, leaving a gap at [1, 3, 4, 5].
          ownedActionOperationOrders: [1, 3, 4, 5],
          readinessOperationOrders: [2],
          assertionOperationOrders: [],
          methods: [{
            methodRef: 'login',
            name: 'login',
            params: [],
            returnType: 'void',
            steps: [],
            returnBindings: []
          }],
          returnShape: { typeName: '', fields: [] }
        },
        {
          ref: 'submitWorkflow',
          action: 'create',
          existingArtifact: '',
          filePath: '_automation/workflows/submitWorkflow.ts',
          className: 'SubmitWorkflow',
          imports: [],
          dependsOn: [],
          // No readiness/assertion op inside this span, so it stays contiguous: [7, 8].
          ownedActionOperationOrders: [7, 8],
          readinessOperationOrders: [],
          assertionOperationOrders: [],
          methods: [{
            methodRef: 'submit',
            name: 'submit',
            params: [],
            returnType: 'void',
            steps: [],
            returnBindings: []
          }],
          returnShape: { typeName: '', fields: [] }
        }
      ]
    },
    formattedCode: "await page.getByLabel('Password').fill('secret-value');"
  });

  assert.equal(staged.length, 2);
  assert.ok(staged.every((entry) => entry.status === 'available'));
  // staged[].operationOrders stays action-only (the staging-status field), unaffected by the
  // match-span fix.
  assert.deepEqual(
    staged.find((entry) => entry.workflowName === 'LoginWorkflow').operationOrders,
    [1, 3, 4, 5]
  );
  assert.deepEqual(
    staged.find((entry) => entry.workflowName === 'SubmitWorkflow').operationOrders,
    [7, 8]
  );

  const fullRecording = [
    ...loginOperations,
    operation(6, 'select', 'Sort products', 'Inventory'),
    ...submitOperations
  ];

  const match = await store.match(tempDir, { operationTrace: fullRecording });

  // LoginWorkflow's match span now fills the gap at order 2 (readiness op), so its signature
  // spans the full contiguous [1, 2, 3, 4, 5] and matches the recording exactly.
  // SubmitWorkflow's span [7, 8] never had a gap and continues to match independently, since
  // it does not overlap LoginWorkflow's span.
  assert.equal(match.matches.length, 2);
  assert.equal(match.matches[0].workflowName, 'LoginWorkflow');
  assert.deepEqual(match.matches[0].operationOrders, [1, 2, 3, 4, 5]);
  assert.equal(match.matches[1].workflowName, 'SubmitWorkflow');
  assert.deepEqual(match.matches[1].operationOrders, [7, 8]);
  assert.deepEqual(match.unmatchedOperationOrders, [6]);

  const index = JSON.parse(await readFile(indexPath, 'utf-8'));
  assert.equal(index.version, 1);
  assert.equal(index.workflows.length, 2);
  assert.equal(
    index.workflows.find((entry) => entry.workflowName === 'LoginWorkflow').sanitizedRawCode.includes('secret-value'),
    false
  );
  assert.equal(
    sanitizeRecorderCode("await page.getByLabel('Password').fill('secret-value');"),
    "await page.getByLabel('Password').fill('<redacted>');"
  );

  await rm(submitWorkflowPath);
  const afterDeleteMatch = await store.match(tempDir, { operationTrace: fullRecording });
  assert.equal(afterDeleteMatch.matches.length, 1);
  assert.equal(afterDeleteMatch.matches[0].workflowName, 'LoginWorkflow');

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
