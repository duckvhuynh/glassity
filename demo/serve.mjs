// Tiny static server for the demo pages. Usage: node demo/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  if (path === '/') {
    // Redirect rather than rewrite, so the page's relative URLs resolve under /demo/.
    response.writeHead(302, { location: '/demo/index.html' }).end();
    return;
  }
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found: ' + path);
  }
}).listen(port, () => console.log(`glassity demo: http://localhost:${port}/`));
