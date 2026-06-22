import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';

const workflowPathPrefix = '_automation/workflows/';
const workflowIndexRelativePath = '_automation/context/workflowIndex.json';

export function createWorkflowReuseStore(options = {}) {
  const indexRelativePath = options.indexRelativePath ?? workflowIndexRelativePath;

  return {
    indexRelativePath,

    async stageFromContract(input = {}) {
      const repoPath = resolveRequiredPath(input.repoPath, 'repoPath');
      const parserOutput = parseJsonObject(input.parserOutput, 'Recorder Parser Output');
      const artifactContract = parseJsonObject(input.artifactContract, 'Artifact Contract');
      const operations = normalizeParserOperations(parserOutput);
      const workflows = extractWorkflowContracts(artifactContract);
      const now = new Date().toISOString();
      const index = await readWorkflowIndex(repoPath, indexRelativePath);
      const staged = [];

      for (const workflow of workflows) {
        const artifactPath = normalizeWorkflowArtifactPath(workflow.artifactPath);
        const operationOrders = [...new Set(workflow.operationOrders)].sort((a, b) => a - b);
        const workflowOperations = operations.filter((operation) => operationOrders.includes(operation.order));
        if (!artifactPath || !workflowOperations.length) {
          continue;
        }

        const signature = workflowOperations.map(operationSignature);
        const signatureHash = createHash('sha256').update(JSON.stringify(signature)).digest('hex');
        const existingIndex = index.workflows.findIndex((entry) => entry.artifactPath === artifactPath);
        const existing = existingIndex >= 0 ? index.workflows[existingIndex] : null;
        const artifactExists = existsSync(resolveWorkflowArtifact(repoPath, artifactPath));
        const record = {
          id: existing?.id ?? randomUUID(),
          workflowName: workflow.name,
          artifactPath,
          sanitizedRawCode: sanitizeRecorderCode(input.formattedCode),
          operations: workflowOperations,
          signature,
          signatureHash,
          entryState: stateLabel(workflowOperations[0]),
          exitState: stateLabel(workflowOperations.at(-1)),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };

        if (existingIndex >= 0) {
          index.workflows[existingIndex] = record;
        } else {
          index.workflows.push(record);
        }

        staged.push({
          workflowName: workflow.name,
          artifactPath,
          operationOrders,
          status: artifactExists ? 'available' : 'staged'
        });
      }

      if (staged.length) {
        index.updatedAt = now;
        index.workflows.sort((left, right) => left.workflowName.localeCompare(right.workflowName));
        await writeWorkflowIndex(repoPath, indexRelativePath, index);
      }

      return staged;
    },

    async list(repoPath) {
      const resolvedRepoPath = resolveRequiredPath(repoPath, 'repoPath');
      const index = await readWorkflowIndex(resolvedRepoPath, indexRelativePath);
      return index.workflows.map((workflow) => withAvailability(resolvedRepoPath, workflow));
    },

    async match(repoPath, parserOutput) {
      const resolvedRepoPath = resolveRequiredPath(repoPath, 'repoPath');
      const parsed = parseJsonObject(parserOutput, 'Recorder Parser Output');
      const operations = normalizeParserOperations(parsed);
      const records = (await this.list(resolvedRepoPath))
        .filter((workflow) => workflow.status === 'available');

      return matchWorkflowSignatures(operations, records);
    }
  };
}

export function parseJsonObject(value, label = 'JSON') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? text;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeParserOperations(parserOutput) {
  const locatorCatalog = new Map((parserOutput.locatorCatalog ?? []).map((locator) => [locator.id, locator]));
  const source = Array.isArray(parserOutput.operations)
    ? parserOutput.operations
    : Array.isArray(parserOutput.operationTrace) ? parserOutput.operationTrace : [];

  return source
    .map((operation, index) => {
      const order = Number(operation.order ?? index + 1);
      const type = normalizeWords(operation.type ?? operation.operationType);
      const meaningful = operation.meaningful ?? operation.isMeaningful ?? type !== 'noise';
      const locator = locatorCatalog.get(operation.locatorRef) ?? operation.locatorParts ?? {};
      return {
        order,
        type,
        intent: normalizeWords(operation.intent ?? operation.intentHint),
        pageOrStep: normalizeWords(operation.pageOrStepHint),
        locatorType: normalizeWords(locator.childTargetType),
        locatorValue: normalizeLocatorValue(locator.childTargetValue ?? locator.childTarget ?? operation.rawLocator),
        assertionRole: normalizeWords(operation.assertionRole),
        meaningful: Boolean(meaningful)
      };
    })
    .filter((operation) => Number.isInteger(operation.order) && operation.meaningful && operation.type !== 'noise');
}

export function matchWorkflowSignatures(operations, workflowRecords) {
  const candidates = [];

  for (const workflow of workflowRecords) {
    const expected = workflow.signature;
    if (!expected.length || expected.length > operations.length) {
      continue;
    }

    for (let start = 0; start <= operations.length - expected.length; start += 1) {
      const actual = operations.slice(start, start + expected.length);
      const score = sequenceSimilarity(actual, expected);
      if (score >= 0.82) {
        candidates.push({
          workflowName: workflow.workflowName,
          artifactPath: workflow.artifactPath,
          operationOrders: actual.map((operation) => operation.order),
          startsAt: stateLabel(actual[0]),
          endsAt: stateLabel(actual.at(-1)),
          score: Number(score.toFixed(3)),
          matchType: score === 1 ? 'exact' : 'strong'
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score
    || right.operationOrders.length - left.operationOrders.length
    || left.operationOrders[0] - right.operationOrders[0]);

  const claimedOrders = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (candidate.operationOrders.some((order) => claimedOrders.has(order))) {
      continue;
    }
    candidate.operationOrders.forEach((order) => claimedOrders.add(order));
    matches.push(candidate);
  }

  matches.sort((left, right) => left.operationOrders[0] - right.operationOrders[0]);
  return {
    matches,
    unmatchedOperationOrders: operations
      .map((operation) => operation.order)
      .filter((order) => !claimedOrders.has(order))
  };
}

export function sanitizeRecorderCode(value) {
  return String(value ?? '')
    .replace(/\.fill\(\s*(['"`])([\s\S]*?)\1\s*\)/g, ".fill('<redacted>')")
    .replace(/\.type\(\s*(['"`])([\s\S]*?)\1\s*\)/g, ".type('<redacted>')");
}

function extractWorkflowContracts(contract) {
  const methods = Array.isArray(contract.methods) ? contract.methods : [];
  return (Array.isArray(contract.workflows) ? contract.workflows : []).map((workflow) => {
    const name = String(workflow.className ?? workflow.name ?? workflow.exportName ?? '').trim();
    const artifactPath = workflow.file ?? workflow.path ?? workflow.filePath ?? '';
    const inlineOrders = workflow.method?.sourceOperationOrders
      ?? workflow.sourceOperationOrders
      ?? [];
    const ownedOrders = methods
      .filter((method) => method.owner === name)
      .flatMap((method) => method.sourceOperationOrders ?? []);
    return {
      name,
      artifactPath,
      operationOrders: [...inlineOrders, ...ownedOrders]
        .map(Number)
        .filter(Number.isInteger)
    };
  }).filter((workflow) => workflow.name && workflow.artifactPath);
}

function normalizeWorkflowArtifactPath(value) {
  const artifactPath = String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!artifactPath.startsWith(workflowPathPrefix) || artifactPath.includes('..')) {
    return '';
  }
  return artifactPath;
}

function resolveWorkflowArtifact(repoPath, artifactPath) {
  const target = resolve(repoPath, normalize(artifactPath));
  const relativePath = relative(repoPath, target);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Workflow artifact must stay inside the selected repository.');
  }
  return target;
}

function withAvailability(repoPath, workflow) {
  return {
    ...workflow,
    status: existsSync(resolveWorkflowArtifact(repoPath, workflow.artifactPath)) ? 'available' : 'staged'
  };
}

async function readWorkflowIndex(repoPath, indexRelativePath) {
  const indexPath = resolveIndexPath(repoPath, indexRelativePath);
  if (!existsSync(indexPath)) {
    return emptyWorkflowIndex();
  }

  const parsed = JSON.parse(await readFile(indexPath, 'utf-8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed.workflows)) {
    throw new Error(`${indexRelativePath} must contain workflow index version 1 with a workflows array.`);
  }
  return parsed;
}

async function writeWorkflowIndex(repoPath, indexRelativePath, index) {
  const indexPath = resolveIndexPath(repoPath, indexRelativePath);
  const temporaryPath = `${indexPath}.tmp`;
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
  await rename(temporaryPath, indexPath);
}

function resolveIndexPath(repoPath, indexRelativePath) {
  const target = resolve(repoPath, normalize(indexRelativePath));
  const relativePath = relative(repoPath, target);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Workflow index must stay inside the selected repository.');
  }
  return target;
}

function emptyWorkflowIndex() {
  return {
    version: 1,
    updatedAt: null,
    workflows: []
  };
}

function operationSignature(operation) {
  return {
    type: operation.type,
    intent: operation.intent,
    pageOrStep: operation.pageOrStep,
    locatorType: operation.locatorType,
    locatorValue: operation.locatorValue,
    assertionRole: operation.assertionRole
  };
}

function sequenceSimilarity(actual, expected) {
  if (actual.length !== expected.length || !actual.length) {
    return 0;
  }
  const total = actual.reduce((sum, operation, index) => sum + operationSimilarity(operation, expected[index]), 0);
  return total / actual.length;
}

function operationSimilarity(actual, expected) {
  if (actual.type !== expected.type) {
    return 0;
  }

  let score = 0.55;
  let weight = 0.55;
  for (const [left, right, fieldWeight] of [
    [actual.locatorType, expected.locatorType, 0.1],
    [actual.locatorValue, expected.locatorValue, 0.2],
    [actual.pageOrStep, expected.pageOrStep, 0.05],
    [actual.intent, expected.intent, 0.07],
    [actual.assertionRole, expected.assertionRole, 0.03]
  ]) {
    if (!left || !right) {
      continue;
    }
    weight += fieldWeight;
    score += fieldWeight * tokenSimilarity(left, right);
  }

  return score / weight;
}

function tokenSimilarity(left, right) {
  if (left === right) {
    return 1;
  }
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function normalizeLocatorValue(value) {
  return normalizeWords(value)
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWords(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stateLabel(operation) {
  return [operation?.pageOrStep, operation?.intent].filter(Boolean).join(': ') || '';
}

function resolveRequiredPath(value, name) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`${name} is required.`);
  }
  return resolve(text);
}
