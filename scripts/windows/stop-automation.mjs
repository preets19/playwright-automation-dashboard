import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const currentPid = process.pid;
const pidFile = join(rootDir, '.tmp', 'automation-pids.json');

const targetPids = new Set();

for (const pid of getTrackedPids()) {
  targetPids.add(pid);
}

targetPids.delete(currentPid);

if (targetPids.size > 0) {
  console.log(`Stopping automation process trees: ${[...targetPids].join(', ')}`);
  for (const pid of targetPids) {
    taskkill(['/PID', String(pid), '/T', '/F']);
  }
} else {
  console.log('No tracked automation process trees found.');
}

clearPidFile();

function getTrackedPids() {
  if (!existsSync(pidFile)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(pidFile, 'utf-8'));
    const entries = Array.isArray(parsed) ? parsed : [];

    return entries
      .map((entry) => Number(entry.pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch (error) {
    console.warn(`Unable to read tracked PID file: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function taskkill(args) {
  spawnSync('taskkill.exe', args, {
    stdio: 'inherit',
    windowsHide: true
  });
}

function clearPidFile() {
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}
