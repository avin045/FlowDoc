// Minimal static server. Serves the workspace (extension/app.html) as a plain
// web app on http://localhost:5173 and the demo site on /demo/.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
};

function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (clean.startsWith('demo')) return join(root, clean);
  return join(root, 'extension', clean);
}

export function startServer(p = port) {
  const server = createServer(async (req, res) => {
    let path = new URL(req.url, 'http://x').pathname;
    if (path === '/') path = '/app.html';
    if (path.endsWith('/')) path += 'index.html';
    const file = resolvePath(path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(p, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  await startServer();
  console.log(`FlowDoc workspace: http://localhost:${port}/app.html`);
  console.log(`Demo site:           http://localhost:${port}/demo/`);
}
