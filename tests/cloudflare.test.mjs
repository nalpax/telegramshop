import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { StoreCore } from '../server/store-core.mjs';
import { durableSql } from '../server/durable-sql.mjs';

// Stand-in for ctx.storage.sql: same call shape (exec(query, ...bindings) -> cursor with toArray() and rowsWritten).
// Like the real API it rejects undefined bindings, BEGIN/SAVEPOINT and PRAGMA.
function fakeDurableSql() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  return { exec(query, ...bindings) {
    if (/^\s*(PRAGMA|BEGIN|SAVEPOINT)/im.test(query)) throw new Error('not authorized');
    if (bindings.some(value => value === undefined)) throw new TypeError('undefined binding');
    if (!bindings.length && query.split(';').filter(part => part.trim()).length > 1) { db.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
    const statement = db.prepare(query);
    if (/^\s*(SELECT|WITH)/i.test(query)) return { toArray: () => statement.all(...bindings), rowsWritten: 0 };
    const { changes } = statement.run(...bindings); return { toArray: () => [], rowsWritten: Number(changes) };
  } };
}
test('Durable Object SQLite adapter runs the store: payments, idempotency, refunds, users and stats', () => {
  const sql = fakeDurableSql();
  const store = new StoreCore(durableSql(sql));
  new StoreCore(durableSql(sql)); // a restarted object re-runs the schema on the same data without errors
  const order = store.createOrder(7, 100, 'one_time', null);
  const paid = { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'do-charge' };
  assert.equal(store.recordPayment(8, paid), false);
  assert.equal(store.recordPayment(7, paid), true);
  assert.equal(store.recordPayment(7, paid), true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM payments').get().n, 1);
  assert.equal(store.entitlement(7).active, true);
  store.upsertUser({ id: 7, first_name: 'Читатель' }); store.complete(7, 1);
  assert.equal(store.listUsers({ plan: 'pro' }).total, 1);
  assert.equal(store.stats().pro, 1);
  const external = store.createExternalOrder(9, 'cryptobot', 5, 'USDT');
  store.attachInvoice('cryptobot', 'inv-1', external.id);
  assert.equal(store.recordExternalPayment('cryptobot', 'inv-1', { amount: 5, currency: 'USDT' }), 'new');
  assert.equal(store.recordExternalPayment('cryptobot', 'inv-1', { amount: 5, currency: 'USDT' }), 'duplicate');
  assert.equal(store.revokeAccess(7), 1); assert.equal(store.entitlement(7).active, false);
  assert.equal(store.grantAccess(7), true); assert.equal(store.entitlement(7).active, true);
});

// ---- worker host (server/worker-app.mjs) with a fake Telegram, through Web Request/Response like on Cloudflare ----
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { WEBHOOK_PATH, isAppRoute, isPublicAsset, makeWorkerApp, serveAsset, webhookSecret, withSecurityHeaders } from '../server/worker-app.mjs';

const TOKEN = '123456789:synthetic_test_token_not_a_credential';
const APP = 'https://vibentry.example.workers.dev';
function signed(id = 42) {
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Пользователь' }), query_id: 'test' });
  const check = [...data].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n');
  data.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(check).digest('hex'));
  return data.toString();
}
function workerHarness({ webhookUrl = '' } = {}) {
  Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'production', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const calls = []; const store = new Store(':memory:');
  const telegram = { isMember: async () => true, api: async (method, payload) => { calls.push({ method, payload }); return method === 'getWebhookInfo' ? { url: webhookUrl } : true; } };
  const content = { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, sections: [{ paragraphs: ['Synthetic fixture'] }] })) };
  const handle = makeWorkerApp({ store, telegram, content, env: { BOT_TOKEN: TOKEN, APP_URL: APP + '/' }, log: () => {} });
  return { calls, store, handle };
}
const hook = (update, secret = webhookSecret(TOKEN)) => new Request(APP + WEBHOOK_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) }, body: JSON.stringify(update) });

test('Worker: webhook needs the derived secret; a paid update grants access once', async () => {
  const t = workerHarness(); const order = t.store.createOrder(42, 50, 'one_time');
  const update = { update_id: 1, message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, successful_payment: { invoice_payload: order.id, currency: 'XTR', total_amount: 50, telegram_payment_charge_id: 'w-1' } } };
  assert.equal((await t.handle(hook(update, null))).status, 401);
  assert.equal((await t.handle(hook(update, webhookSecret('another-token')))).status, 401);
  assert.equal(t.store.entitlement(42).active, false);
  assert.equal((await t.handle(hook(update))).status, 200);
  assert.equal((await t.handle(hook(update))).status, 200);
  assert.equal(t.store.db.prepare('SELECT count(*) AS n FROM payments').get().n, 1);
  assert.equal(t.store.entitlement(42).active, true);
  assert.equal((await t.handle(new Request(APP + WEBHOOK_PATH))).status, 405);
  assert.equal(webhookSecret(TOKEN).length, 64); assert.match(webhookSecret(TOKEN), /^[0-9a-f]+$/);
});
test('Worker: /health sets the webhook once and never replaces someone else\'s', async () => {
  const t = workerHarness();
  const health = await (await t.handle(new Request(APP + '/health'))).json();
  assert.deepEqual(health, { ok: true, app: 'vibentry', bot: 'ok' });
  const set = t.calls.find(c => c.method === 'setWebhook');
  assert.equal(set.payload.url, APP + WEBHOOK_PATH); assert.equal(set.payload.secret_token, webhookSecret(TOKEN));
  assert.ok(t.calls.some(c => c.method === 'setChatMenuButton' && c.payload.menu_button.web_app.url === APP));
  await t.handle(new Request(APP + '/health'));
  assert.equal(t.calls.filter(c => c.method === 'getWebhookInfo').length, 1);
  const other = workerHarness({ webhookUrl: 'https://elsewhere.example/hook' });
  assert.equal((await (await other.handle(new Request(APP + '/health'))).json()).bot, 'webhook-conflict');
  assert.equal(other.calls.some(c => c.method === 'setWebhook'), false);
});
test('Worker: api.mjs answers through the Web Request shim (GET header auth, POST body, errors)', async () => {
  const t = workerHarness();
  assert.equal((await t.handle(new Request(APP + '/api/config'))).status, 200);
  assert.equal((await t.handle(new Request(APP + '/api/lessons/1'))).status, 401);
  const lesson = await t.handle(new Request(APP + '/api/lessons/1', { headers: { 'X-Telegram-Init-Data': signed() } }));
  assert.equal(lesson.status, 200); assert.equal((await lesson.json()).id, 1);
  assert.equal((await t.handle(new Request(APP + '/api/lessons/5', { headers: { 'X-Telegram-Init-Data': signed() } }))).status, 200);
  assert.equal((await t.handle(new Request(APP + '/api/lessons/6', { headers: { 'X-Telegram-Init-Data': signed() } }))).status, 403);
  const session = await t.handle(new Request(APP + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed() }) }));
  assert.equal(session.status, 200); assert.equal((await session.json()).user.id, 42);
  assert.equal((await t.handle(new Request(APP + '/api/session', { method: 'POST', body: '{bad' }))).status, 400);
  assert.equal((await t.handle(new Request(APP + '/api/session', { method: 'POST', body: 'x'.repeat(30000) }))).status, 413);
  assert.equal((await t.handle(new Request(APP + '/api/nope'))).status, 404);
});
test('Worker routing: only public files, private paths and dot-files are refused, security headers on every response', () => {
  for (const ok of ['/', '/index.html', '/style.css', '/js/app.js', '/assets/brand.png']) assert.equal(isPublicAsset(ok), true, ok);
  for (const bad of ['/.env', '/data/lessons.json.bak', '/server/api.mjs', '/%2e%2e/x.json'.replace('.json', ''), '/js/.hidden.js', '/%E0%A4%A', '/data']) assert.equal(isPublicAsset(bad), false, bad);
  assert.equal(isAppRoute('/api/config'), true); assert.equal(isAppRoute('/telegram/webhook'), true); assert.equal(isAppRoute('/style.css'), false);
  const page = withSecurityHeaders(new Response('x', { headers: { 'Content-Type': 'text/html' } }), '/');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors/); assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(withSecurityHeaders(new Response('x'), '/style.css').headers.get('cache-control'), 'public, max-age=300');
});
test('Worker: bundled public files are served with type and headers; anything else is 404', async () => {
  const files = { '/index.html': { body: '<!doctype html>', type: 'text/html; charset=utf-8' }, '/assets/brand.png': { body: new Uint8Array([137, 80]).buffer, type: 'image/png' } };
  const home = serveAsset(files, new Request(APP + '/'));
  assert.equal(home.status, 200); assert.equal(await home.text(), '<!doctype html>'); assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  const png = serveAsset(files, new Request(APP + '/assets/brand.png'));
  assert.equal(png.headers.get('content-type'), 'image/png'); assert.equal((await png.arrayBuffer()).byteLength, 2);
  assert.equal(await serveAsset(files, new Request(APP + '/', { method: 'HEAD' })).text(), '');
  for (const miss of ['/missing.css', '/.env', '/data/lessons.json', '/server/worker.mjs']) assert.equal(serveAsset(files, new Request(APP + miss)).status, 404, miss);
});
test('Worker /health explains bot setup failures without exposing the token', async () => {
  const run = async (token, telegramApi) => {
    const telegram = { isMember: async () => true, api: telegramApi };
    const handle = makeWorkerApp({ store: new Store(':memory:'), telegram, content: {}, env: { BOT_TOKEN: token, APP_URL: APP }, log: () => {} });
    const response = await handle(new Request(APP + '/health'));
    const text = await response.text(); assert.equal(text.includes(token), false); return JSON.parse(text);
  };
  const never = async () => { throw new Error('must not call Telegram'); };
  for (const bad of [' ' + TOKEN, 'bot' + TOKEN, `"${TOKEN}"`, 'not-a-token']) assert.equal((await run(bad, never)).bot, 'token-format', bad);
  const unauthorized = async () => { const error = new Error('Telegram API request failed'); error.code = 401; error.description = 'Unauthorized'; throw error; };
  assert.deepEqual(await run(TOKEN, unauthorized), { ok: true, app: 'vibentry', bot: 'telegram-error', botError: { step: 'getWebhookInfo', code: 401, description: 'Unauthorized' } });
  const menuFails = async method => { if (method === 'getWebhookInfo') return { url: '' }; if (method === 'setChatMenuButton') { const error = new Error('x'); error.code = 400; throw error; } return true; };
  assert.equal((await run(TOKEN, menuFails)).botError.step, 'configureBot');
});
