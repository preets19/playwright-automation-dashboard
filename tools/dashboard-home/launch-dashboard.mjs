import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.DASHBOARD_PORT ?? 4310);
const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';
const dashboardUrl = `http://${host}:${port}/`;
const healthCheckUrl = `http://${host}:${port}/api/process`;
const dashboardDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));

if (!(await isDashboardRunning())) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: dashboardDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });

  child.unref();

  if (!(await waitForDashboard())) {
    console.error(`Dashboard Home did not start at ${dashboardUrl}`);
    process.exit(1);
  }
}

openBrowser();

// Checked against a dedicated JSON endpoint, not the page title — title text is presentation
// copy that can change for unrelated reasons (a rebrand, a typo fix) and would otherwise make
// this silently report "not running" with no error.
function isDashboardRunning() {
  return new Promise((resolveRunning) => {
    const request = get(healthCheckUrl, { timeout: 2000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolveRunning(false);
          return;
        }

        try {
          const parsed = JSON.parse(body);
          resolveRunning(parsed.ok === true && typeof parsed.pid === 'number');
        } catch {
          resolveRunning(false);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      resolveRunning(false);
    });
    request.on('error', () => resolveRunning(false));
  });
}

function waitForDashboard() {
  const deadline = Date.now() + 8000;

  return new Promise((resolveReady) => {
    const check = async () => {
      if (await isDashboardRunning()) {
        resolveReady(true);
        return;
      }

      if (Date.now() > deadline) {
        resolveReady(false);
        return;
      }

      setTimeout(check, 250);
    };

    check();
  });
}

function openBrowser() {
  spawn('cmd.exe', ['/c', 'start', '', dashboardUrl], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref();
}
