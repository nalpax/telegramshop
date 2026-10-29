import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.mjs';
import { StoreCore } from '../server/store-core.mjs';
import { createApp } from '../server/index.mjs';

// Funnel events: app_open -> lesson 1 opened -> lesson 1 done -> paywall seen -> checkout started -> paid.
const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
async function setup() {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', ADMIN_IDS: '1', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel', PRICE_STARS: '100' });
  const store = new Store(':memory:');
  const server = createApp({ store, telegram: { isMember: async () => true, api: async () => true }, content: { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, title: `Урок ${i + 1}`, sections: [{ paragraphs: ['x'] }] })) } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, id, body = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...body }) });
  const funnel = async (q = '', id = 1) => fetch(base + '/api/admin/funnel' + q, { headers: { 'X-Telegram-Init-Data': signed(id) } });
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  return { store, post, funnel, done };
}

test('Events: whitelist, validation, 204, daily dedupe, the client cannot write paid', async () => {
  const t = await setup();
  try {
    const r = await t.post('/api/event', 10, { type: 'app_open' });
    assert.equal(r.status, 204); assert.equal(await r.text(), '');
    await t.post('/api/event', 10, { type: 'app_open' }); await t.post('/api/event', 10, { type: 'paywall_view' }); await t.post('/api/event', 10, { type: 'paywall_view' });
    const count = type => t.store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE type=?').get(type).n;
    assert.equal(count('app_open'), 1, 'app_open at most once a day'); assert.equal(count('paywall_view'), 1);
    for (const type of ['paid', 'lesson_done', 'promo_applied', 'anything']) assert.equal((await t.post('/api/event', 10, { type, meta: 'stars' })).status, 400, type);
    assert.equal(count('paid'), 0, 'the client cannot write paid');
    assert.equal((await t.post('/api/event', 10, { type: 'lesson_open', meta: 25 })).status, 400);
    assert.equal((await t.post('/api/event', 10, { type: 'lesson_open', meta: '1' })).status, 400, 'lesson id is a number');
    assert.equal((await t.post('/api/event', 10, { type: 'checkout_start', meta: 'paypal' })).status, 400);
    assert.equal((await t.post('/api/event', 10, { type: 'checkout_start', meta: 'stars' })).status, 204);
    assert.equal((await fetch((await t.funnel()).url.replace('/api/admin/funnel', '/api/event'), { method: 'POST', body: '{"type":"app_open"}' })).status, 401, 'no initData');
    // Next day app_open counts again (but the person is still one person in the funnel).
    t.store.addEvent(10, 'app_open', null, Date.now() + 86400000 + 1000);
    assert.equal(count('app_open'), 2);
    const row = t.store.db.prepare("SELECT * FROM events WHERE type='checkout_start'").get();
    assert.deepEqual(Object.keys(row).sort(), ['at', 'id', 'meta', 'type', 'user_id'], 'only id, user id, type, meta and time');
  } finally { await t.done(); }
});

test('Funnel: steps with conversion, lessons, methods and promo codes on a fixture; empty period; admin only', async () => {
  const t = await setup();
  try {
    const empty = await (await t.funnel('?days=7')).json();
    assert.ok(empty.steps.every(s => s.count === 0) && empty.steps.every(s => s.fromPrevious === null || s.fromPrevious === 0));
    assert.equal(empty.lessons.length, 24); assert.deepEqual(empty.methods, []); assert.deepEqual(empty.promos, []);
    for (const id of [10, 11, 12, 13, 1]) await t.post('/api/event', id, { type: 'app_open' }); // 1 is the admin: not counted
    for (const id of [10, 11, 12]) await t.post('/api/event', id, { type: 'lesson_open', meta: 1 });
    await t.post('/api/event', 10, { type: 'lesson_open', meta: 2 });
    for (const id of [10, 11]) await t.post('/api/progress', id, { lessonId: 1 }); // lesson_done comes from the server
    await t.post('/api/progress', 10, { lessonId: 1 }); // repeat: no second event
    await t.post('/api/progress', 10, { lessonId: 2 });
    for (const id of [10, 11]) await t.post('/api/event', id, { type: 'paywall_view' });
    await t.post('/api/event', 10, { type: 'checkout_start', meta: 'stars' });
    t.store.savePromo({ code: 'START20', percent: 20 });
    assert.equal((await t.post('/api/promo', 10, { promo: 'START20' })).status, 200);
    await t.post('/api/promo', 11, { promo: 'START20' });
    const order = t.store.createOrder(10, 80, 'one_time', 'START20');
    t.store.recordPayment(10, { invoice_payload: order.id, currency: 'XTR', total_amount: 80, telegram_payment_charge_id: 'f1' });
    t.store.recordPayment(10, { invoice_payload: order.id, currency: 'XTR', total_amount: 80, telegram_payment_charge_id: 'f1' }); // redelivery
    t.store.grantAccess(12); // manual Pro: not a payment
    const f = await (await t.funnel('?days=30')).json();
    assert.deepEqual(f.steps.map(s => [s.id, s.count]), [['app_open', 4], ['lesson1_open', 3], ['lesson1_done', 2], ['paywall_view', 2], ['checkout_start', 1], ['paid', 1]]);
    assert.deepEqual(f.steps.map(s => s.fromPrevious), [null, 75, 66.7, 100, 50, 100]);
    assert.deepEqual(f.lessons.slice(0, 3).map(l => [l.id, l.opened, l.done]), [[1, 3, 2], [2, 1, 1], [3, 0, 0]]);
    assert.equal(f.lessons[0].title, 'Урок 1');
    assert.deepEqual(f.methods, [{ provider: 'stars', currency: 'XTR', n: 1, total: 80 }]);
    assert.deepEqual(f.promos, [{ code: 'START20', applied: 2, paid: 1 }]);
    t.store.db.prepare('UPDATE events SET at=?').run(Date.now() - 40 * 86400000);
    assert.equal((await (await t.funnel('?days=30')).json()).steps[0].count, 0, 'old events fall out of the period');
    assert.equal((await (await t.funnel()).json()).steps[0].count, 4, 'all time');
    assert.equal((await t.funnel('', 10)).status, 403);
  } finally { await t.done(); }
});

test('Funnel: v1.0 funnel_events are moved over once', () => {
  const db = new DatabaseSync(':memory:');
  new StoreCore(db); // fresh schema
  db.exec("CREATE TABLE funnel_events (user_id INTEGER NOT NULL, step TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(user_id, step)); INSERT INTO funnel_events VALUES (5,'tariff_open',100),(5,'pay_click',200),(5,'subscribed',50); INSERT INTO progress VALUES (5,1,300)");
  new StoreCore(db);
  assert.deepEqual(db.prepare('SELECT type, meta, at FROM events ORDER BY at').all().map(r => ({ ...r })), [{ type: 'paywall_view', meta: null, at: 100 }, { type: 'checkout_start', meta: null, at: 200 }, { type: 'lesson_done', meta: '1', at: 300 }]);
  assert.throws(() => db.prepare('SELECT * FROM funnel_events').all());
  db.close();
});
