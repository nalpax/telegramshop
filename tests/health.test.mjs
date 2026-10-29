import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// «Проверка системы» in the admin panel: one line per check, ok / fail / off with a reason, never a secret.
const TOKEN = '123456:synthetic_health_test_token_not_real';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'A' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
async function setup({ botUsername = 'vibentry_bot', chatError = false, providerPing = true } = {}) {
  const old = { ...process.env };
  Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', ADMIN_IDS: '1', BOT_USERNAME: 'vibentry_bot', APP_URL: 'https://app.example', CRYPTOBOT_TOKEN: 'synthetic-cryptobot-secret' });
  const store = new Store(':memory:'); store.saveChannels([{ chatId: '@goodchannel', url: 'https://t.me/goodchannel', title: 'A' }]);
  const api = async (method, payload) => {
    if (method === 'getMe') return { id: 99, username: botUsername };
    if (method === 'getWebhookInfo') return { url: 'https://app.example/telegram/webhook', pending_update_count: 0 };
    if (method === 'getChatMember') { if (chatError) { const e = new Error('x'); e.code = 400; e.description = 'Bad Request: chat not found'; throw e; } return { status: payload.user_id === 99 ? 'administrator' : 'member' }; }
    return true;
  };
  const providers = { list: [
    { id: 'cryptobot', title: 'CryptoBot', currency: 'USDT', configured: () => true, ping: async () => { if (!providerPing) throw Object.assign(new Error('x'), { status: 401 }); return true; } },
    { id: 'platega', title: 'Карта / СБП', currency: 'RUB', configured: () => false },
  ], get: id => null };
  const server = createApp({ store, telegram: { isMember: async () => true, api }, content: { providers } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const get = id => fetch(base + '/api/admin/health', { headers: { 'X-Telegram-Init-Data': signed(id), Host: 'app.example' } });
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  return { store, get, done };
}
const byId = (items, id) => items.find(i => i.id === id);
test('System check: bot, channels, address, providers, database and last payment; no secrets', async () => {
  const t = await setup();
  try {
    assert.equal((await t.get(5)).status, 403, 'admins only');
    const response = await t.get(1); const text = await response.text(); const { items } = JSON.parse(text);
    for (const secret of ['synthetic_health_test_token', 'synthetic-cryptobot-secret', '123456:']) assert.equal(text.includes(secret), false, secret);
    assert.equal(byId(items, 'bot').status, 'ok'); assert.match(byId(items, 'bot').detail, /@vibentry_bot/);
    assert.equal(byId(items, 'webhook').status, 'ok');
    assert.equal(byId(items, 'channel:@goodchannel').status, 'ok'); assert.match(byId(items, 'channel:@goodchannel').detail, /администратор/);
    assert.equal(byId(items, 'url').status, 'ok');
    assert.equal(byId(items, 'provider:cryptobot').status, 'ok');
    assert.equal(byId(items, 'provider:platega').status, 'off');
    assert.match(byId(items, 'webhook:cryptobot').detail, /ещё не приходил/);
    assert.equal(byId(items, 'database').status, 'ok');
    assert.equal(byId(items, 'payment').status, 'off'); assert.match(byId(items, 'payment').detail, /Пока не было/);
    const order = t.store.createOrder(1, 100, 'one_time'); t.store.recordPayment(1, { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'h1' });
    assert.equal(byId((await (await t.get(1)).json()).items, 'payment').status, 'ok');
  } finally { await t.done(); }
});
test('System check reports problems with the reason', async () => {
  const t = await setup({ botUsername: 'other_bot', chatError: true, providerPing: false });
  try {
    const { items } = await (await t.get(1)).json();
    assert.equal(byId(items, 'bot').status, 'fail'); assert.match(byId(items, 'bot').detail, /other_bot/);
    assert.equal(byId(items, 'channel:@goodchannel').status, 'fail'); assert.match(byId(items, 'channel:@goodchannel').detail, /chat not found/);
    assert.equal(byId(items, 'provider:cryptobot').status, 'fail'); assert.match(byId(items, 'provider:cryptobot').detail, /401/);
  } finally { await t.done(); }
});
