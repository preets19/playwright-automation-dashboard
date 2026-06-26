// Single shared place that decides where the user's app repos live. Previously this was a
// hardcoded guess (process.env.AUTOMATION_WORKSPACE_ROOT ?? homedir()/Source/Repo) baked into
// both test-dashboard/server.mjs and automation-context-mcp/server.mjs independently — the same
// "guess a directory layout" anti-pattern already fixed once for the framework repo (see
// framework-resolver.mjs). automation-context-mcp in particular is normally launched
// independently by an external MCP client, bypassing the dashboard's own handoff flow entirely,
// so the hardcoded default was the real-world path for it, not just a rare edge case.
//
// Only the dashboard's own authenticated UI (dashboard-home, test-dashboard) ever calls
// setWorkspaceRoot — automation-context-mcp only ever reads. An MCP tool-call argument must
// never be able to redefine this boundary itself.
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRootStatePath = join(repoRoot, '.tmp', 'workspace-root.json');
const defaultWorkspaceRoot = resolve(process.env.AUTOMATION_WORKSPACE_ROOT ?? resolve(homedir(), 'Source', 'Repo'));

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, 'utf-8'));
}

// Re-read fresh every call (never cached at module scope), same principle as
// framework-resolver.mjs: the persisted choice can change at any time via the dashboard's own
// UI, and every reader must see that change immediately, not a value cached from process start.
export async function getWorkspaceRoot() {
  const state = await readJsonIfExists(workspaceRootStatePath);
  if (state?.workspaceRootPath && existsSync(state.workspaceRootPath)) {
    return resolve(state.workspaceRootPath);
  }

  return defaultWorkspaceRoot;
}

// Denylist of obviously-wrong workspace roots — a user explicitly setting their own workspace
// folder should never be able to point this at somewhere that exposes far more than intended,
// even by an honest mistake (typing "C:\" instead of a real subfolder). Not exhaustive by
// design: it stops the obvious cases, not every possible overly-broad choice.
export function isDangerousWorkspaceRoot(candidatePath) {
  const normalized = resolve(candidatePath).toLowerCase();

  if (/^[a-z]:[\\/]?$/.test(normalized)) {
    return true;
  }

  const dangerousRoots = [
    process.env.WINDIR,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ]
    .filter(Boolean)
    .map((value) => resolve(value).toLowerCase());

  return dangerousRoots.includes(normalized);
}

// Best-effort canonicalization: resolves symlinks/junctions when the path exists, otherwise
// falls back to the plain resolved path (realpath throws on a path that doesn't exist yet).
async function canonicalize(candidatePath) {
  try {
    return await realpath(candidatePath);
  } catch {
    return resolve(candidatePath);
  }
}

// Containment check used to enforce "this path must be inside the workspace root" — resolves
// symlinks/junctions on both sides before comparing. path.resolve() alone does NOT dereference
// symlinks, so a junction that sits inside the workspace root but actually points elsewhere
// would otherwise pass a naive string-prefix check while granting access outside it.
export async function isPathInsideWorkspace(candidatePath, workspaceRootPath) {
  const canonicalRoot = await canonicalize(workspaceRootPath);
  const canonicalCandidate = await canonicalize(candidatePath);
  const relativePath = relative(canonicalRoot, canonicalCandidate);

  return relativePath !== '' && !relativePath.startsWith('..') && resolve(canonicalRoot, relativePath) === canonicalCandidate;
}

export async function setWorkspaceRoot(candidatePath) {
  const normalized = resolve(String(candidatePath ?? '').trim());
  if (!normalized || !existsSync(normalized)) {
    throw new Error(`Workspace folder was not found: ${normalized}`);
  }

  if (!(await stat(normalized)).isDirectory()) {
    throw new Error(`Workspace path is not a folder: ${normalized}`);
  }

  if (isDangerousWorkspaceRoot(normalized)) {
    throw new Error(`${normalized} is too broad to use as a workspace folder (a drive root or system directory). Choose a more specific folder.`);
  }

  await mkdir(dirname(workspaceRootStatePath), { recursive: true });
  await writeFile(
    workspaceRootStatePath,
    `${JSON.stringify({ workspaceRootPath: normalized, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf-8'
  );

  return normalized;
}
