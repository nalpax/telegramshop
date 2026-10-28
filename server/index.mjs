import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store } from './store.mjs';
import { Telegram } from './telegram.mjs';
import { makeApi } from './api.mjs';
import { loadContent } from './content-node.mjs';
import { MIME as mime, SECURITY_HEADERS, body, errorStatus, json } from './http-common.mjs';

const nodeContent = await loadContent();

const publicRoot = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));

export function createApp({ store = new Store(), telegram = new Telegram(), content } = {}) {
  const api = makeApi(store, telegram, { ...nodeContent, ...content });
  return http.createServer(async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
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
      if (!response.headersSent) json(response, errorStatus(error), { error: 'Request could not be completed' });
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
