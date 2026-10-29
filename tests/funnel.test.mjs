import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// The funnel: opened -> subscribed -> lesson 01 -> free part (05) -> opened the tariff -> pressed «Оплатить» -> bought.
const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
test('Funnel: each step counted once per person; manual Pro is not a purchase; period filter; admin only', async () => {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', ADMIN_IDS: '1', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:'); const members = new Set([10, 11, 12]);
  const server = createApp({ store, telegram: { isMember: async id => members.has(id), api: async () => true }, content: { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, sections: [{ paragraphs: ['x'] }] })) } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, id, body = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...body }) });
  const funnel = async (q = '') => (await fetch(base + '/api/admin/funnel' + q, { headers: { 'X-Telegram-Init-Data': signed(1) } })).json();
  try {
    for (const id of [10, 11, 12, 13]) await post('/api/session', id); // 13 is not subscribed
    await post('/api/session', 10); // a second visit does not count twice
    for (const l of [1, 2, 3, 4, 5]) await post('/api/progress', 10, { lessonId: l });
    await post('/api/progress', 11, { lessonId: 1 });
    for (const id of [10, 11, 13]) await post('/api/event', id, { step: 'tariff_open' }); // the tariff is visible without a subscription
    await post('/api/event', 10, { step: 'pay_click' }); await post('/api/event', 10, { step: 'pay_click' });
    assert.equal((await post('/api/event', 10, { step: 'anything' })).status, 400);
    const order = store.createOrder(10, 100, 'one_time'); store.recordPayment(10, { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'f1' });
    store.grantAccess(12); // manual Pro: not a purchase
    const f = await funnel();
    assert.deepEqual(f.steps.map(s => [s.id, s.count]), [['opened', 4], ['subscribed', 3], ['lesson1', 2], ['free', 1], ['tariff', 3], ['pay', 1], ['bought', 1]]);
    assert.equal(f.steps[1].ofTotal, 75); assert.equal(f.steps[2].ofPrevious, 67);
    store.db.prepare('UPDATE users SET first_seen=? WHERE id=13').run(Date.now() - 40 * 86400000);
    assert.equal((await funnel('?days=30')).steps[0].count, 3, 'only people who first came in the last 30 days');
    assert.equal((await fetch(base + '/api/admin/funnel', { headers: { 'X-Telegram-Init-Data': signed(10) } })).status, 403);
  } finally { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
