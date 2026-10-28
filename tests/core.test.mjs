import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateInitData } from '../server/auth.mjs';
import { Store } from '../server/store.mjs';
import { validCheckout, offerFor } from '../server/telegram.mjs';
import { createApp } from '../server/index.mjs';
import { validateAppUrl, messageFor } from '../server/bot.mjs';

const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id = 42, date = Math.floor(Date.now() / 1000)) {
  const data = new URLSearchParams({ auth_date: String(date), user: JSON.stringify({ id, first_name: 'Пользователь' }), query_id: 'test' });
  const check = [...data].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  data.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return data.toString();
}
test('Telegram auth rejects tampering, stale data, duplicate keys and missing hash', () => {
  assert.equal(validateInitData(signed(), TOKEN).id, 42);
  assert.equal(validateInitData(signed().replace('test', 'tampered'), TOKEN), null);
  assert.equal(validateInitData(signed(42, Math.floor(Date.now() / 1000) - 7200), TOKEN), null);
  assert.equal(validateInitData(signed() + '&auth_date=1', TOKEN), null);
  assert.equal(validateInitData('user={}', TOKEN), null);
});
test('Stars payments validate ownership, currency, amount, recurring expiry and idempotency', () => {
  const store = new Store(':memory:');
  const order = store.createOrder(42, 100, 'subscription');
  const now = Math.floor(Date.now() / 1000);
  const payment = { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'test-charge', subscription_expiration_date: now + 2592000, is_recurring: true };
  assert.equal(store.recordPayment(99, payment), false);
  assert.equal(store.recordPayment(42, { ...payment, currency: 'RUB' }), false);
  assert.equal(store.recordPayment(42, { ...payment, total_amount: 1 }), false);
  assert.equal(store.recordPayment(42, { ...payment, subscription_expiration_date: 1 }), false);
  assert.equal(store.recordPayment(42, payment), true);
  assert.equal(store.recordPayment(42, payment), true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM payments').get().n, 1);
  assert.equal(store.entitlement(42).active, true);
  assert.equal(store.entitlement(42, now + 2592001).active, false);
  assert.equal(validCheckout(store, { invoice_payload: order.id, from: { id: 42 }, currency: 'XTR', total_amount: 100 }), true);
  assert.equal(validCheckout(store, { invoice_payload: order.id, from: { id: 99 }, currency: 'XTR', total_amount: 100 }), false);
  store.close();
});
test('One-time purchase and progress are persisted in the store', () => {
  const store = new Store(':memory:'); const order = store.createOrder(1, 100, 'one_time');
  assert.equal(store.recordPayment(1, { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'once' }), true);
  assert.equal(store.entitlement(1, 9999999999).active, true);
  store.refund('once'); assert.equal(store.entitlement(1).active, false);
  store.complete(1, 1); store.complete(1, 1); assert.deepEqual(store.getProgress(1), [1]); store.reset(1); assert.deepEqual(store.getProgress(1), []); store.close();
});
test('Bot launch button and HTTPS validation', () => {
  assert.equal(validateAppUrl('https://example.com'), true);
  assert.equal(validateAppUrl('http://example.com'), false);
  assert.equal(validateAppUrl('https://localhost'), false);
  const message = messageFor('/start', 'https://example.com');
  assert.equal(message.reply_markup.inline_keyboard[0][0].web_app.url, 'https://example.com');
  assert.match(message.text, /первые 5 уроков бесплатно/);
});
test('Offers apply and expire deterministically, leaving existing purchases unchanged', () => {
  const store = new Store(':memory:');
  store.saveSettings({ priceStars: 500, discountPercent: 20, saleEndsAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(offerFor(store, Date.parse('2029-01-01')).priceStars, 400);
  assert.equal(offerFor(store, Date.parse('2031-01-01')).priceStars, 500);
  store.close();
});
test('API enforces channel membership, paid content and server-side price; private sources are not static', async () => {
  const old = { ...process.env }; process.env.BOT_TOKEN = TOKEN; process.env.PRICE_STARS = '100'; process.env.REQUIRED_CHANNEL_ID = '@examplechannel'; process.env.REQUIRED_CHANNEL_URL = 'https://t.me/examplechannel'; process.env.ADMIN_IDS = '42'; process.env.MEMBERSHIP_CACHE_SECONDS = '0';
  const store = new Store(':memory:'); let member = false; let captured;
  const telegram = { isMember: async () => member, api: async (method, payload) => { captured = { method, payload }; return 'https://t.me/$test-invoice'; } };
  // Synthetic lessons keep tests runnable without publishing the owner's paid course.
  const content = { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, sections: [{ paragraphs: ['Synthetic fixture'] }] })), resources: { 'first-prompt': 'Synthetic prompt', 'mobile-prompt': 'Synthetic prompt', notes: 'Synthetic notes' }, prompts: { categories: [{ id: 'c1', title: 'Synthetic', ids: ['001'] }], items: [{ id: '001', title: 'Synthetic title', use: 'Synthetic use', prompt: 'SYNTHETIC-PROMPT-TEXT' }] }, articles: [{ id: 'open-note', group: 'start', groupTitle: 'Start', title: 'Open', description: 'd', free: true, markdown: 'Free **text**' }, { id: 'paid-note', group: 'tools', groupTitle: 'Tools', title: 'Paid', description: 'd', markdown: 'SYNTHETIC-PAID-ARTICLE' }] };
  const server = createApp({ store, telegram, content }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = url => fetch(base + url, { headers: { 'X-Telegram-Init-Data': signed() } });
  const post = (url, data = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(), ...data }) });
  try {
    const page = await fetch(base + '/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(base + '/style.css')).status, 200);
    assert.equal((await get('/api/lessons/1')).status, 403);
    member = true;
    assert.equal((await get('/api/lessons/1')).status, 200);
    // Lessons 01–05 are free after subscription; 06+ and the templates need the purchase.
    for (const free of [2, 3, 4, 5]) assert.equal((await get('/api/lessons/' + free)).status, 200, 'lesson ' + free);
    assert.equal((await get('/api/lessons/6')).status, 403);
    assert.equal((await get('/api/lessons/24')).status, 403);
    assert.equal((await get('/api/resources/first-prompt')).status, 403);
    assert.equal((await (await fetch(base + '/api/config')).json()).freeLessons, 5);
    // Library: titles are listed after subscription; texts only after purchase.
    const promptList = await (await get('/api/prompts')).json();
    assert.equal(promptList.items.length, 1); assert.equal(JSON.stringify(promptList).includes('SYNTHETIC-PROMPT-TEXT'), false);
    assert.equal((await get('/api/prompts/001')).status, 403);
    const articleList = await (await get('/api/articles')).json();
    assert.equal(articleList.items.length, 2); assert.equal(JSON.stringify(articleList).includes('SYNTHETIC-PAID-ARTICLE'), false);
    assert.equal((await get('/api/articles/open-note')).status, 200);
    assert.equal((await get('/api/articles/paid-note')).status, 403);
    assert.equal((await get('/api/prompts/999')).status, 404);
    assert.equal((await post('/api/progress', { lessonId: 5 })).status, 200);
    assert.equal((await post('/api/progress', { lessonId: 6 })).status, 403);
    assert.equal((await fetch(base + '/data/lessons.json')).status, 404);
    assert.equal((await fetch(base + '/handoff/course/Vibentry_Course_v02.pdf')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/api/lessons/1')).status, 401);
    const invoice = await post('/api/invoice', { price: 1 }); assert.equal(invoice.status, 200);
    assert.equal(captured.payload.currency, 'XTR'); assert.equal(captured.payload.prices[0].amount, 100);
    assert.equal(captured.payload.subscription_period, undefined);
    assert.equal((await post('/api/invoice')).status, 429);
    store.recordPayment(42, { invoice_payload: captured.payload.payload, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'integration', is_recurring: true, subscription_expiration_date: Math.floor(Date.now()/1000)+2592000 });
    assert.equal((await get('/api/lessons/24')).status, 200);
    const otherAccount = await fetch(base + '/api/lessons/24', { headers: { 'X-Telegram-Init-Data': signed(99) } });
    assert.equal(otherAccount.status, 403);
    assert.equal((await get('/api/resources/first-prompt')).status, 200);
    assert.equal((await (await get('/api/prompts/001')).json()).text, 'SYNTHETIC-PROMPT-TEXT');
    assert.equal((await (await get('/api/articles/paid-note')).json()).markdown, 'SYNTHETIC-PAID-ARTICLE');
    assert.equal((await fetch(base + '/api/prompts/001', { headers: { 'X-Telegram-Init-Data': signed(99) } })).status, 403);
    assert.equal((await post('/api/progress', { lessonId: 24 })).status, 200);
    assert.equal((await post('/api/session')).status, 200);
    assert.equal((await post('/api/admin/offer', { priceStars: 500, discountPercent: 20, saleEndsAt: null })).status, 200);
    assert.equal((await (await fetch(base + '/api/config')).json()).priceStars, 400);
    assert.equal((await post('/api/admin/offer', { priceStars: 0, discountPercent: 20 })).status, 400);
    const unauthorizedAdmin = await fetch(base + '/api/admin/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(99), priceStars: 1, discountPercent: 0 }) });
    assert.equal(unauthorizedAdmin.status, 403);
    const incomplete = createApp({ store, telegram, content: { lessons: content.lessons.slice(0, 1), resources: {} } });
    await new Promise(resolve => incomplete.listen(0, '127.0.0.1', resolve));
    try {
      const local = `http://127.0.0.1:${incomplete.address().port}`;
      const config = await (await fetch(local + '/api/config')).json();
      assert.equal(config.paymentsEnabled, false);
      const blockedInvoice = await fetch(local + '/api/invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(99) }) });
      assert.equal(blockedInvoice.status, 503);
    } finally { await new Promise(resolve => incomplete.close(resolve)); }
    member = false; assert.equal((await get('/api/lessons/24')).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});

test('Membership checks are cached briefly, failures are reported without granting access', async () => {
  const old = { ...process.env }; process.env.BOT_TOKEN = TOKEN; process.env.REQUIRED_CHANNEL_ID = '@examplechannel'; process.env.MEMBERSHIP_CACHE_SECONDS = '60';
  const store = new Store(':memory:'); let calls = 0; let fail = false;
  const telegram = { isMember: async () => { calls++; if (fail) throw new Error('network'); return true; }, api: async () => 'x' };
  const server = createApp({ store, telegram, content: { lessons: [{ id: 1, sections: [{ paragraphs: ['x'] }] }], resources: {}, prompts: { categories: [], items: [] }, articles: [] } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; const get = url => fetch(base + url, { headers: { 'X-Telegram-Init-Data': signed(7) } });
  try {
    assert.equal((await get('/api/lessons/1')).status, 200); assert.equal((await get('/api/lessons/1')).status, 200); assert.equal(calls, 1);
    const fresh = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(7) }) });
    assert.equal(fresh.status, 200); assert.equal(calls, 2);
    fail = true;
    assert.equal((await get('/api/lessons/1')).status, 200);
    process.env.MEMBERSHIP_CACHE_SECONDS = '0';
    assert.equal((await get('/api/lessons/1')).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
test('The app and the server agree on the free lessons (01–05)', async () => {
  const { FREE_LESSONS } = await import('../server/telegram.mjs');
  const course = await import('../public/js/course.js');
  assert.equal(FREE_LESSONS, 5);
  assert.deepEqual(course.lessons.filter(l => l.free).map(l => l.id), [1, 2, 3, 4, 5]);
});
