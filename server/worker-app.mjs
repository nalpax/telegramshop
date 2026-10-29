// Cloudflare host logic, kept free of `cloudflare:*` imports so Node tests can run it (server/worker.mjs is the thin entry).
// The same api.mjs answers /api/* as on a Node server; the bot receives updates by webhook instead of long polling.
import { createHmac } from 'node:crypto';
import { makeApi } from './api.mjs';
import { configureBot, handleUpdate, validateAppUrl } from './bot-core.mjs';
import { safeEqual } from './providers/index.mjs';
import { MIME, SECURITY_HEADERS, body, errorStatus, json } from './http-common.mjs';

export const WEBHOOK_PATH = '/telegram/webhook';
// Telegram echoes this in X-Telegram-Bot-Api-Secret-Token. Derived from the token, so there is no extra secret to manage.
export const webhookSecret = token => createHmac('sha256', String(token)).update('vibentry-telegram-webhook').digest('hex');

// Minimal stand-ins for node:http request/response, enough for api.mjs and http-common.mjs.
async function nodeRequest(request) {
  const raw = ['GET', 'HEAD'].includes(request.method) ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());
  return { method: request.method, headers: Object.fromEntries(request.headers), async *[Symbol.asyncIterator]() { if (raw.length) yield raw; } };
}
function nodeResponse() {
  const out = { status: 200, headers: {}, body: null, headersSent: false };
  out.writeHead = (status, headers = {}) => { out.status = status; Object.assign(out.headers, headers); out.headersSent = true; };
  out.end = (value = null) => { out.body = value; out.headersSent = true; };
  out.toResponse = () => new Response(out.body, { status: out.status, headers: out.headers });
  return out;
}

export function makeWorkerApp({ store, telegram, content, env = process.env, log = console.error }) {
  const api = makeApi(store, telegram, content);
  const appUrl = String(env.APP_URL || '').replace(/\/$/, '');
  const telegramApi = (method, payload) => telegram.api(method, payload);
  let bot = null; let botError = null;
  // Points the bot at this deployment once per object start. Someone else's webhook is never overwritten.
  function ensureBot() {
    if (!env.BOT_TOKEN) return Promise.resolve('no-token');
    if (!validateAppUrl(appUrl)) return Promise.resolve('no-app-url');
    // A BotFather token looks like 123456789:AA… — spaces, quotes or a "bot" prefix make every Telegram call fail.
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(env.BOT_TOKEN)) return Promise.resolve('token-format');
    let step = 'getWebhookInfo';
    bot ??= (async () => {
      const target = appUrl + WEBHOOK_PATH;
      const info = await telegramApi('getWebhookInfo');
      if (info.url && info.url !== target) return 'webhook-conflict';
      step = 'setWebhook';
      if (info.url !== target) await telegramApi('setWebhook', { url: target, secret_token: webhookSecret(env.BOT_TOKEN), allowed_updates: ['message', 'pre_checkout_query'] });
      step = 'configureBot';
      await configureBot(telegramApi, appUrl);
      botError = null;
      return 'ok';
    })().catch(error => {
      bot = null;
      // Telegram's error code and text (e.g. 401 Unauthorized) are safe to show; the token never is.
      botError = { step, code: Number(error.code) || 'network', ...(error.description ? { description: error.description } : {}) };
      log(`Bot setup failed at ${step} (code ${botError.code}). Credentials are not logged.`);
      return 'telegram-error';
    });
    return bot;
  }
  return async function handle(request) {
    const url = new URL(request.url);
    const reply = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (url.pathname === WEBHOOK_PATH) {
      if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
      if (!env.BOT_TOKEN || !safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), webhookSecret(env.BOT_TOKEN))) return reply(401, { error: 'Invalid secret' });
      let update;
      try { update = await body(await nodeRequest(request)); } catch { return reply(400, { error: 'Bad update' }); }
      // Always 200 once the secret matched: a failed reply (e.g. the user blocked the bot) must not stall Telegram's queue.
      // Payments are idempotent, so a later redelivery is harmless anyway.
      try { await handleUpdate(update, { api: telegramApi, store, appUrl, support: env.SUPPORT_USERNAME, log }); }
      catch (error) { log(`Update handling failed (code ${Number(error.code) || 'internal'}). Update bodies are not logged.`); }
      return reply(200, { ok: true });
    }
    if (url.pathname === '/health' && request.method === 'GET') { const state = await ensureBot(); return reply(200, { ok: true, app: 'vibentry', bot: state, ...(state === 'telegram-error' && botError ? { botError } : {}) }); }
    ensureBot();
    const response = nodeResponse();
    try {
      if (await api(await nodeRequest(request), response, url, json, body)) return response.toResponse();
      return reply(404, { error: 'Not found' });
    } catch (error) { return reply(errorStatus(error), { error: 'Request could not be completed' }); }
  };
}

// Static files from public/ only, same rules as the Node server: no dot-files, known types only, GET/HEAD.
export function isPublicAsset(pathname) {
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) return false;
  if (decoded === '/') return true;
  const dot = decoded.lastIndexOf('.');
  return dot > decoded.lastIndexOf('/') && Object.hasOwn(MIME, decoded.slice(dot));
}
export function withSecurityHeaders(response, pathname = '') {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) result.headers.set(name, value);
  if (response.ok && pathname && !pathname.startsWith('/api/')) result.headers.set('Cache-Control', pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
  return result;
}
// public/ is bundled into the script at deploy time (server/public-bundle.mjs): { '/index.html': { body, type } }.
export function serveAsset(files, request) {
  const { pathname } = new URL(request.url);
  const file = isPublicAsset(pathname) && files[pathname === '/' ? '/index.html' : decodeURIComponent(pathname)];
  if (!file) return withSecurityHeaders(Response.json({ error: 'Not found' }, { status: 404 }));
  return withSecurityHeaders(new Response(request.method === 'HEAD' ? null : file.body, { headers: { 'Content-Type': file.type } }), pathname);
}
// Requests that belong to the single app object (state, payments, bot); everything else is a static file.
export const isAppRoute = pathname => pathname.startsWith('/api/') || pathname === '/health' || pathname.startsWith('/telegram/');
