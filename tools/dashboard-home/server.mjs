import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const publicDir = join(dashboardDir, 'public');
const port = Number(process.env.DASHBOARD_PORT ?? 4310);
const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

const server = createServer(async (request, response) => {
  try {
    await serveStatic(new URL(request.url ?? '/', `http://${request.headers.host}`).pathname, response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    process.exit(0);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host);

async function serveStatic(pathname, response) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(publicDir, `.${requestedPath}`);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !(await stat(filePath)).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}
