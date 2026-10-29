import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { handleUpdate, weekPlanMessage } from '../server/bot-core.mjs';
import { startTip } from '../public/js/onboarding.js';

const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
const titles = Array.from({ length: 24 }, (_, i) => `Урок ${i + 1}`);

test('Onboarding: answers are validated, stored per account and returned with the session; skipping is remembered too', async () => {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', ADMIN_IDS: '1', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:');
  const server = createApp({ store, telegram: { isMember: async () => true, api: async () => true }, content: {} }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`; const post = (url, id, body = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...body }) });
  try {
    assert.equal((await (await post('/api/session', 5)).json()).onboarding, null);
    assert.equal((await post('/api/onboarding', 5, { goal: 'earn', experience: 'hacker' })).status, 400);
    assert.equal((await post('/api/onboarding', 5, { goal: 'earn', experience: 'tried' })).status, 200);
    assert.deepEqual((await (await post('/api/session', 5)).json()).onboarding, { goal: 'earn', experience: 'tried' });
    assert.equal((await post('/api/onboarding', 6, { skip: true })).status, 200);
    assert.deepEqual((await (await post('/api/session', 6)).json()).onboarding, { goal: 'skip', experience: 'skip' });
    const card = await (await fetch(base + '/api/admin/users/5', { headers: { 'X-Telegram-Init-Data': signed(1) } })).json();
    assert.deepEqual(card.onboarding, { goal: 'earn', experience: 'tried' });
  } finally { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
test('Start tip depends on the answers and never points a free user to a paid lesson first', () => {
  assert.equal(startTip({ goal: 'own', experience: 'none' }).lesson, 1);
  assert.equal(startTip({ goal: 'own', experience: 'tried' }).lesson, 3);
  assert.equal(startTip({ goal: 'earn', experience: 'pro' }).lesson, 5);
  assert.match(startTip({ goal: 'earn', experience: 'none' }).text, /модул[ия] 3/);
  for (const goal of ['own', 'earn', 'learn']) for (const experience of ['none', 'tried', 'pro']) assert.ok(startTip({ goal, experience }).lesson <= 5);
});
test('Week plan after purchase: the next unfinished lessons, then practice, signed by the author', () => {
  const m = weekPlanMessage({ done: [1, 2, 3, 4, 5], titles, appUrl: 'https://app.example', support: 'nalpax' });
  assert.match(m.text, /День 1 — урок 06 «Урок 6»/); assert.match(m.text, /День 5 — урок 10/); assert.match(m.text, /День 6/); assert.match(m.text, /День 7/);
  assert.match(m.text, /@nalpax/); assert.doesNotMatch(m.text, /гарант|доход|заработаете/i);
  assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, 'https://app.example/#lesson?id=6');
  assert.match(weekPlanMessage({ done: [], titles, appUrl: 'https://app.example' }).text, /День 1 — урок 01/);
  assert.match(weekPlanMessage({ done: Array.from({ length: 22 }, (_, i) => i + 1), titles, appUrl: 'https://app.example' }).text, /урок 24/);
});
test('The plan is sent after a confirmed payment only', async () => {
  const store = new Store(':memory:'); const sent = []; const api = async (method, payload) => { sent.push(payload); return true; };
  store.complete(7, 1);
  const order = store.createOrder(7, 50, 'one_time');
  const paid = { message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, successful_payment: { invoice_payload: order.id, currency: 'XTR', total_amount: 50, telegram_payment_charge_id: 'w1' } } };
  await handleUpdate(paid, { api, store, appUrl: 'https://app.example', titles });
  assert.equal(sent.length, 2); assert.match(sent[1].text, /План на первую неделю/); assert.match(sent[1].text, /урок 02/);
  sent.length = 0;
  await handleUpdate({ message: { ...paid.message, successful_payment: { ...paid.message.successful_payment, total_amount: 1, telegram_payment_charge_id: 'w2' } } }, { api, store, appUrl: 'https://app.example', titles });
  assert.equal(sent.some(m => /План на первую неделю/.test(m.text)), false);
});
