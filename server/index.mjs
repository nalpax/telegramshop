import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store } from './store.mjs';
import { Telegram } from './telegram.mjs';
import { makeApi } from './api.mjs';

const publicRoot = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 20000) { const error = new Error('Payload too large'); error.status = 413; throw error; } chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }

export function createApp({ store = new Store(), telegram = new Telegram(), content } = {}) {
  const api = makeApi(store, telegram, content);
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Do not set X-Frame-Options: Telegram Web embeds the Mini App in an iframe.
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://*.t.me");
    try {
      const url = new URL(request.url, 'http://localhost');
      if (await api(request, response, url, json, body)) return;
      if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { ok: true, app: 'vibentry' });
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed' });
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) return json(response, 404, { error: 'Not found' });
      const file = path.resolve(publicRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!file.startsWith(publicRoot + path.sep)) return json(response, 404, { error: 'Not found' });
      const info = await stat(file);
      if (!info.isFile()) return json(response, 404, { error: 'Not found' });
      const contentType = mime[path.extname(file)];
      if (!contentType) return json(response, 404, { error: 'Not found' });
      response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size, 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (!response.headersSent) json(response, error.code === 'ENOENT' ? 404 : error.status || (error instanceof SyntaxError || error instanceof URIError ? 400 : 500), { error: 'Request could not be completed' });
      else response.end();
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createApp();
  server.listen(port, host, () => console.log(`Vibentry: listening on ${host}:${port}. Telegram Stars access is configured through environment settings.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
