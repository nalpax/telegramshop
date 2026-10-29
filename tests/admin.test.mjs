import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { normalizeChannel, applyPromo } from '../server/telegram.mjs';

const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id, name = 'Тест') {
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: name, username: 'user' + id + 'abc' }), query_id: 't' });
  const check = [...data].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n');
  data.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(check).digest('hex'));
  return data.toString();
}
async function setup() {
  const old = { ...process.env };
  Object.assign(process.env, { BOT_TOKEN: TOKEN, ADMIN_IDS: '1', PRICE_STARS: '1000', MEMBERSHIP_CACHE_SECONDS: '0', NODE_ENV: 'test' });
  delete process.env.REQUIRED_CHANNEL_ID; delete process.env.REQUIRED_CHANNEL_URL;
  const store = new Store(':memory:'); const checked = []; let invoice;
  const telegram = { isMember: async (userId, channels) => { checked.push(channels.map(c => c.chatId)); return channels.length > 0; }, api: async (method, payload) => { if (method === 'createInvoiceLink') invoice = payload; return 'https://t.me/$inv'; } };
  const content = { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, sections: [{ paragraphs: ['x'] }] })), resources: { 'first-prompt': 'x', 'mobile-prompt': 'x', notes: 'x' }, prompts: { categories: [], items: [] }, articles: [] };
  const server = createApp({ store, telegram, content }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url, id = 1) => fetch(base + url, { headers: { 'X-Telegram-Init-Data': signed(id) } });
  const post = (url, data = {}, id = 1) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...data }) });
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  return { store, get, post, checked, done, invoice: () => invoice };
}

test('Admin endpoints reject everyone who is not in ADMIN_IDS and never leak participants', async () => {
  const t = await setup();
  try {
    for (const url of ['/api/admin/overview', '/api/admin/users', '/api/admin/users/5', '/api/admin/audit']) assert.equal((await t.get(url, 5)).status, 403, url);
    for (const url of ['/api/admin/grant', '/api/admin/revoke', '/api/admin/channels', '/api/admin/promos', '/api/admin/offer']) assert.equal((await t.post(url, { userId: 5 }, 5)).status, 403, url);
  } finally { await t.done(); }
});

test('Participants are recorded on session; admin can list, filter, grant and revoke Pro', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/examplechannel' }] })).status, 200);
    for (const id of [5, 6, 7]) assert.equal((await t.post('/api/session', {}, id)).status, 200);
    const all = await (await t.get('/api/admin/users')).json();
    assert.equal(all.total, 4); assert.ok(all.items.every(u => u.plan === 'free'));
    assert.equal((await (await t.get('/api/admin/users?q=user6')).json()).total, 1);
    assert.equal((await (await t.post('/api/admin/grant', { userId: 6 })).json()).plan, 'pro');
    assert.equal((await (await t.get('/api/admin/users?plan=pro')).json()).items[0].id, 6);
    assert.equal((await (await t.get('/api/session', 6)).status), 404);
    const session = await (await t.post('/api/session', {}, 6)).json(); assert.equal(session.access.active, true); assert.equal(session.isAdmin, false);
    const stats = (await (await t.get('/api/admin/overview')).json()).stats; assert.equal(stats.pro, 1); assert.equal(stats.free, 3);
    assert.equal((await (await t.post('/api/admin/revoke', { userId: 6 })).json()).plan, 'free');
    assert.equal((await t.post('/api/admin/grant', { userId: 99999 })).status, 400);
    assert.ok((await (await t.get('/api/admin/audit')).json()).items.length >= 3);
  } finally { await t.done(); }
});

test('Required channels are admin-configurable, validated, and every one is checked', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post('/api/admin/channels', { channels: [{ url: 'http://t.me/abcde' }] })).status, 400);
    assert.equal((await t.post('/api/admin/channels', { channels: [{ url: 'https://evil.example/abcde' }] })).status, 400);
    assert.equal((await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/abcde' }, { url: 'https://t.me/abcde' }] })).status, 400);
    assert.equal((await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/+AbCdEfGh12' }] })).status, 400, 'private invite needs a numeric id');
    const ok = await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/vibentry', title: 'Канал' }, { url: 'https://t.me/+AbCdEfGh12', chatId: '-1001234567890', title: 'Чат' }] });
    assert.equal(ok.status, 200);
    t.checked.length = 0;
    assert.equal((await t.get('/api/lessons/1', 8)).status, 200);
    assert.deepEqual(t.checked.at(-1), ['@vibentry', '-1001234567890']);
    assert.equal(normalizeChannel({ url: 'javascript:alert(1)' }), null);
    // A public link and an @ID that point to different chats: the button would lead to one channel and the check would ask about another.
    assert.equal(normalizeChannel({ url: 'https://t.me/vibeentry', chatId: '@vibentry' }), null);
    assert.equal(normalizeChannel({ url: 'https://t.me/vibeentry', chatId: '@VibeEntry' }).chatId, '@VibeEntry');
    assert.equal(normalizeChannel({ url: 'https://t.me/vibeentry' }).chatId, '@vibeentry');
    assert.equal(normalizeChannel({ url: 'https://t.me/vibeentry', chatId: '-1001234567890' }).chatId, '-1001234567890');
    assert.equal(normalizeChannel({ url: 'https://t.me/+AbCdEfGh123', chatId: '@vibentry' }).chatId, '@vibentry');
    assert.equal((await t.post('/api/admin/channels', { channels: [] })).status, 200);
    assert.equal((await t.get('/api/lessons/1', 8)).status, 403, 'an empty list lets nobody in');
  } finally { await t.done(); }
});

test('Promo codes validate, apply to the invoice amount and are counted only after payment', async () => {
  const t = await setup();
  try {
    await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/vibentry' }] });
    assert.equal((await t.post('/api/admin/promos', { code: 'bad code', percent: 10 })).status, 400);
    assert.equal((await t.post('/api/admin/promos', { code: 'START20', percent: 95 })).status, 400);
    assert.equal((await t.post('/api/admin/promos', { code: 'start20', percent: 20, maxUses: 1 })).status, 200);
    assert.equal((await t.post('/api/admin/offer', { priceStars: 1000, discountPercent: 0 })).status, 200);
    const quote = await (await t.post('/api/promo', { promo: 'Start20' }, 9)).json(); assert.equal(quote.methods.find(m => m.id === 'stars').amount, 800);
    assert.equal((await t.post('/api/promo', { promo: 'NOPE' }, 9)).status, 400);
    assert.equal((await t.post('/api/invoice', { promo: 'START20' }, 9)).status, 200);
    assert.equal(t.invoice().prices[0].amount, 800);
    const order = t.store.db.prepare('SELECT * FROM orders WHERE user_id=9').get(); assert.equal(order.stars, 800); assert.equal(order.promo, 'START20');
    assert.equal(t.store.promo('START20').used, 0, 'creating an invoice does not spend the code');
    assert.equal(t.store.recordPayment(9, { invoice_payload: order.id, currency: 'XTR', total_amount: 800, telegram_payment_charge_id: 'c9' }), true);
    t.store.recordPayment(9, { invoice_payload: order.id, currency: 'XTR', total_amount: 800, telegram_payment_charge_id: 'c9' });
    assert.equal(t.store.promo('START20').used, 1);
    assert.equal(applyPromo(t.store, 'START20', 1000).error !== undefined, true, 'max uses reached');
    t.store.savePromo({ code: 'OLD', percent: 10, expiresAt: '2000-01-01T00:00:00Z' });
    assert.match(applyPromo(t.store, 'OLD', 1000).error, /Срок/);
  } finally { await t.done(); }
});

test('Course text carries an invisible per-reader fingerprint, code stays clean, and scraping is rate-limited', async () => {
  const { fingerprint, decodeIds } = await import('../server/fingerprint.mjs');
  const md = 'Это длинный абзац обычного текста, который точно длиннее шестидесяти символов и поэтому получит отпечаток.\n\n```text\nCODE LINE that is much longer than sixty characters and must stay byte-for-byte identical here\n```\n\n- пункт списка тоже достаточно длинный для проверки, но синтаксис Markdown трогать нельзя никогда\n';
  const marked = fingerprint(md, 123456789);
  assert.deepEqual(decodeIds(marked), [123456789]);
  assert.equal(marked.replace(/[​‌⁠]/g, ''), md, 'only invisible characters are added');
  assert.ok(marked.includes('CODE LINE that is much longer than sixty characters and must stay byte-for-byte identical here'));
  const t = await setup();
  try {
    t.store.grantAccess(7); await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/vibentry' }] });
    await t.post('/api/session', {}, 7);
    const codes = []; for (let i = 0; i < 43; i++) codes.push((await t.get('/api/lessons/6', 7)).status);
    assert.equal(codes.slice(0, 40).every(c => c === 200), true); assert.equal(codes[41], 429);
    assert.equal((await t.get('/api/lessons/6', 8)).status, 403, 'other readers are unaffected');
    assert.ok((await (await t.get('/api/admin/audit')).json()).items.some(a => a.action === 'rate-limit'));
  } finally { await t.done(); }
});

test('Lesson progress is remembered on the server and comes back with the next session', async () => {
  const t = await setup();
  try {
    await t.post('/api/admin/channels', { channels: [{ url: 'https://t.me/vibentry' }] }); t.store.grantAccess(15);
    assert.deepEqual((await (await t.post('/api/session', {}, 15)).json()).done, []);
    await t.post('/api/progress', { lessonId: 1 }, 15); await t.post('/api/progress', { lessonId: 2 }, 15); await t.post('/api/progress', { lessonId: 2 }, 15);
    assert.deepEqual((await (await t.post('/api/session', {}, 15)).json()).done, [1, 2]);
    assert.deepEqual((await (await t.post('/api/session', {}, 16)).json()).done, [], 'progress is per account');
    assert.equal((await t.post('/api/progress', { lessonId: 25 }, 15)).status, 400);
    await t.post('/api/progress', { reset: true }, 15);
    assert.deepEqual((await (await t.post('/api/session', {}, 15)).json()).done, []);
  } finally { await t.done(); }
});
