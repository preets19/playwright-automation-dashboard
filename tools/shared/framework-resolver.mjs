// Single shared place that decides where the base framework's files actually live, for every
// tool in this repo that needs a framework-relative path (test-dashboard's HTTP server,
// automation-context-mcp's stdio MCP server, and anything added later). This is the ONE place
// that needs to change if resolution logic ever changes again (e.g. a third tier added) — no
// caller should build its own PRIMARY/LEGACY check.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const frameworkPackage = '@your-org/playwright-base-framework';

// tools/shared/ and tools/<tool-name>/ are both exactly one level under tools/, so '../..' from
// here lands at the same repo root regardless of which tool imports this module.
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const frameworkRepoStatePath = join(repoRoot, '.tmp', 'framework-repo-resolution.json');

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, 'utf-8'));
}

// PRIMARY: resolve the framework as a real dependency of the given app repo — its package.json
// must list it, and Node's own resolution (scoped to that repo, so it honors that repo's own
// node_modules/symlinks/workspaces) must be able to find it. Zero guessing, zero sibling-folder
// assumption, zero separate persistence: anchored entirely to appRepoDir, which the caller has
// already confirmed, and to that repo's own already-resolved dependency tree.
export async function resolveFrameworkRepoFromDependency(appRepoDir) {
  if (!appRepoDir) {
    return null;
  }

  const packageJson = await readJsonIfExists(join(appRepoDir, 'package.json'));
  const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  if (!Object.hasOwn(dependencies, frameworkPackage)) {
    return null;
  }

  try {
    // Probe node_modules lookup directories directly rather than resolving a package.json
    // subpath import — a strict "exports" map (as this framework package has) does not expose
    // "./package.json", so require.resolve(`${frameworkPackage}/package.json`) throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED even when the package is correctly installed.
    const requireFromApp = createRequire(join(appRepoDir, 'package.json'));
    const lookupDirs = requireFromApp.resolve.paths(frameworkPackage) ?? [];
    for (const candidateDir of lookupDirs) {
      const candidatePath = join(candidateDir, frameworkPackage);
      if (existsSync(candidatePath)) {
        return resolve(await realpath(candidatePath));
      }
    }
    return null;
  } catch {
    // Listed in package.json but not actually installed/resolvable — treat as legacy, not an error.
    return null;
  }
}

async function readFrameworkRepoOverrides() {
  return (await readJsonIfExists(frameworkRepoStatePath)) ?? {};
}

async function writeFrameworkRepoOverride(repoKey, entry) {
  try {
    await mkdir(dirname(frameworkRepoStatePath), { recursive: true });
    const overrides = await readFrameworkRepoOverrides();
    overrides[repoKey] = { ...entry, updatedAt: new Date().toISOString() };
    await writeFile(frameworkRepoStatePath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf-8');
  } catch {
    // Best-effort; resolution just re-derives the sibling guess again next call if this fails.
  }
}

// Validates that a candidate path actually looks like the framework package before it is ever
// trusted as an override or sibling guess — never silently point resolution at the wrong folder.
async function isFrameworkRepo(candidatePath) {
  if (!candidatePath || !existsSync(candidatePath)) {
    return false;
  }

  const packageJson = await readJsonIfExists(join(candidatePath, 'package.json'));
  return packageJson?.name === frameworkPackage;
}

// Persist a caller-supplied override for repoKey (e.g. an app repo path) after confirming it
// actually looks like the framework package. Exposed so an HTTP API route (or any other caller)
// can let a user manually point a non-migrated repo at its framework checkout.
export async function setFrameworkRepoOverride(repoKey, frameworkRepoPath) {
  const candidate = resolve(frameworkRepoPath);
  if (!(await isFrameworkRepo(candidate))) {
    throw new Error(`${candidate} does not look like ${frameworkPackage} (no matching package.json name).`);
  }

  await writeFrameworkRepoOverride(repoKey, { frameworkRepoPath: candidate, mode: 'legacy-manual-override' });
  return candidate;
}

// LEGACY: only reached for assets the dependency-resolved root (if any) does not contain. Prefers
// a previously-confirmed override, then falls back to deriving a sibling folder next to the app
// repo's own directory (never a separately-configured workspace root — same anchoring principle
// as the primary path). Explicitly marked legacy: this whole path should become unreachable once
// every app repo and every framework-relative asset is on the dependency model above.
async function resolveFrameworkRepoLegacy(repoKey, { appRepoDir } = {}) {
  if (repoKey) {
    const overrides = await readFrameworkRepoOverrides();
    const override = overrides[repoKey];
    if (override?.frameworkRepoPath && existsSync(override.frameworkRepoPath)) {
      return { frameworkRepo: override.frameworkRepoPath, mode: 'legacy-manual-override' };
    }
  }

  if (appRepoDir) {
    const siblingGuess = join(dirname(appRepoDir), 'playwright-base-framework');
    if (await isFrameworkRepo(siblingGuess)) {
      if (repoKey) {
        await writeFrameworkRepoOverride(repoKey, { frameworkRepoPath: siblingGuess, mode: 'legacy-sibling-derived' });
      }
      return { frameworkRepo: siblingGuess, mode: 'legacy-sibling-derived' };
    }
  }

  return {
    frameworkRepo: null,
    mode: 'unresolved',
    message: appRepoDir
      ? `Could not resolve the framework repo for ${appRepoDir}: not an installed dependency, no sibling folder, and no override on file.`
      : 'Could not resolve the framework repo: no app repo context, no explicit override, and no override on file.'
  };
}

// Resolve both the PRIMARY (dependency) and LEGACY (sibling/override) framework roots, once per
// call — NOT short-circuited on PRIMARY succeeding, because resolveFrameworkAsset below may still
// need the legacy root as a fallback for an asset PRIMARY's root doesn't happen to contain (e.g.
// .ai/, not yet published in the framework's npm package). Re-run fresh every call (never cached
// at module scope): switching the selected app repo must never leak a previously-resolved root
// into a different repo's context.
//
// repoKey identifies whose override to read/persist (typically the app repo path); appRepoDir is
// used for both the PRIMARY dependency check and the LEGACY sibling derivation — pass both as the
// same value in the common case. explicitOverridePath is a one-off override supplied directly for
// this call (e.g. an MCP tool argument) — a deliberate, in-the-moment instruction from the caller,
// so unlike a silently-persisted override it outranks PRIMARY too: when given and valid, it is the
// only root consulted, skipping both the dependency check and the sibling guess entirely.
export async function resolveFrameworkRoots({ repoKey, appRepoDir, explicitOverridePath } = {}) {
  if (explicitOverridePath) {
    const candidate = resolve(explicitOverridePath);
    if (await isFrameworkRepo(candidate)) {
      if (repoKey) {
        await writeFrameworkRepoOverride(repoKey, { frameworkRepoPath: candidate, mode: 'legacy-explicit-override' });
      }
      return { dependencyRepo: null, legacyRepo: candidate, legacyMode: 'legacy-explicit-override' };
    }
  }

  const dependencyRepo = await resolveFrameworkRepoFromDependency(appRepoDir);
  const legacy = await resolveFrameworkRepoLegacy(repoKey ?? appRepoDir, { appRepoDir });

  return {
    dependencyRepo,
    legacyRepo: legacy.frameworkRepo,
    legacyMode: legacy.mode,
    legacyMessage: legacy.message
  };
}

// The ONE place that decides where a framework-relative asset (e.g. 'src', '.ai') actually lives.
// Checks PRIMARY's root first, then LEGACY's root — independently per asset, since each root can
// have a different subset of the framework's files (e.g. a published npm package may ship src/
// but not .ai/ yet). Every reader of a framework-relative path must call this rather than
// building its own PRIMARY/LEGACY check.
export function resolveFrameworkAsset(roots, assetRelativePath) {
  const candidates = [
    roots.dependencyRepo ? { root: roots.dependencyRepo, mode: 'dependency' } : null,
    roots.legacyRepo ? { root: roots.legacyRepo, mode: roots.legacyMode } : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolvedPath = join(candidate.root, assetRelativePath);
    if (existsSync(resolvedPath)) {
      return { available: true, resolvedPath, frameworkRepo: candidate.root, mode: candidate.mode };
    }
  }

  const checkedPaths = candidates.map((candidate) => join(candidate.root, assetRelativePath));
  const message = checkedPaths.length
    ? `${assetRelativePath} was not found under any resolved framework location: ${checkedPaths.join(', ')}`
    : (roots.legacyMessage ?? `Could not resolve a framework repo to look for ${assetRelativePath}.`);
  console.warn(message);
  return { available: false, resolvedPath: null, frameworkRepo: null, mode: 'unresolved', message };
}
