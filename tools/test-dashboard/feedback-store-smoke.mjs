import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFeedbackStore } from './feedback-store.mjs';

const tempDir = await mkdtemp(join(tmpdir(), 'feedback-store-'));
const dbPath = join(tempDir, 'feedback-loop.db');

try {
  const store = createFeedbackStore({ dbPath });
  const sessionId = store.createSession({
    repoName: 'playwright-app-template',
    repoPath: 'C:\\Users\\example\\Source\\Repo\\playwright-app-template',
    automationRoot: 'C:\\Users\\example\\Source\\Repo\\playwright-app-template\\_automation',
    testType: 'UI',
    testSuite: 'Regression',
    scenario: 'User can add a product to cart and checkout',
    testObjective: 'Verify user can place an order.',
    passCondition: 'Thank-you message is visible.',
    status: 'draft',
    modelName: 'example-model',
    promptFlow: 'guided',
    promptVersion: 'capture-only-v1'
  });

  store.addRecorderInput(sessionId, {
    rawCode: 'raw recorder code',
    formattedCode: 'formatted recorder code',
    entryUrl: 'https://www.saucedemo.com/'
  });

  store.addStep(sessionId, {
    stepName: 'recorder_interpreter',
    promptText: 'analysis prompt',
    responseText: 'analysis response',
    inputTokens: 1000,
    outputTokens: 500,
    modelName: 'example-model'
  });

  store.addArtifactSnapshot(sessionId, {
    snapshotType: 'initial_generated',
    filePath: '_automation/tests/ui/checkout.spec.ts',
    content: 'generated code'
  });

  store.addValidationRun(sessionId, {
    command: 'npm.cmd run typecheck',
    status: 'passed',
    exitCode: 0,
    durationMs: 1200
  });

  store.addLesson(sessionId, {
    category: 'assertions',
    pattern: 'string matcher against Locator',
    lesson: 'Workflow results used by toContain should be resolved strings.',
    confidence: 'medium',
    promoted: false
  });

  store.addCaptureEvent(sessionId, {
    eventName: 'guided_prompt_copied',
    payload: {
      promptFlow: 'guided',
      guidedStage: 'analysis',
      request: {
        scenario: 'User can add a product to cart and checkout'
      }
    }
  });

  const count = store.sessionCount();
  store.close();

  if (count !== 1) {
    throw new Error(`Expected 1 session, found ${count}.`);
  }

  console.log('feedback-store smoke test passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
