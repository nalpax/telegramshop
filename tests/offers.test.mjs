import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { applyPromo } from '../server/telegram.mjs';
import { sendOffers, offerSettings } from '../server/offers.mjs';
import { handleUpdate } from '../server/bot-core.mjs';

// Automatic offers: off until the owner switches them on, only while a payment method works, only daytime, personal
// one-time codes that really expire after 48 hours, a ladder capped at 50%, and «Не присылать предложения» in every message.
const DAY = 86400000; const NOW = Date.parse('2026-11-02T09:00:00Z');
const appUrl = 'https://app.example';
function setup({ enabled = true, ready = true } = {}) {
  const old = process.env.PRICE_RUB; process.env.PRICE_RUB = '1299';
  const store = new Store(':memory:'); const sent = [];
  const api = async (method, payload) => { sent.push({ method, payload }); return true; };
  if (enabled) store.saveOfferSettings({ enabled: true, ladder: [15, 30, 50] });
  const user = (id, { seen = NOW - 10 * DAY, first = NOW - 10 * DAY, done = [], pro = false } = {}) => { store.upsertUser({ id, first_name: 'U' + id }, first); store.upsertUser({ id, first_name: 'U' + id }, seen); for (const l of done) store.db.prepare('INSERT INTO progress VALUES (?,?,?)').run(id, l, seen); if (pro) store.grantAccess(id); };
  const run = now => sendOffers({ store, api, appUrl, purchase: () => ({ ready }), now, log: () => {} });
  return { store, sent, api, user, run, restore: () => { if (old === undefined) delete process.env.PRICE_RUB; else process.env.PRICE_RUB = old; } };
}
test('Monthly personal codes: 15% -> 30% -> 50%, 48 hours, exact price, opt-out button; never for buyers or new users', async () => {
  const t = setup();
  try {
    t.user(1); t.user(2, { pro: true }); t.user(3, { first: NOW - DAY, seen: NOW - DAY }); t.user(4); t.store.setOffers(4, false);
    const r = await t.run(NOW);
    assert.equal(r.offers, 1);
    const msg = t.sent.find(s => s.payload.chat_id === 1).payload;
    const code = msg.text.match(/VIBE-[A-Z0-9]{6}/)[0];
    assert.match(msg.text, /15%/); assert.match(msg.text, /1\s104 ₽ вместо 1\s299 ₽/u); assert.match(msg.text, /48 часов/); assert.match(msg.text, /навсегда/); assert.match(msg.text, /4 ноября, 12:00/);
    assert.equal(msg.reply_markup.inline_keyboard[0][0].web_app.url, `${appUrl}/#buy?promo=${code}`);
    assert.equal(msg.reply_markup.inline_keyboard.at(-1)[0].callback_data, 'offers:off');
    assert.equal(applyPromo(t.store, code, 100, NOW, 1).percent, 15);
    assert.match(applyPromo(t.store, code, 100, NOW, 9).error, /не найден/, 'personal code works only for its owner');
    assert.match(applyPromo(t.store, code, 100, NOW + 49 * 3600000, 1).error, /закончился/, 'really expires after 48 hours');
    const visit = now => t.store.upsertUser({ id: 1, first_name: 'U1' }, now - DAY);
    const mine = () => t.sent.filter(s => s.payload.chat_id === 1 && /VIBE-/.test(s.payload.text || '')).map(s => s.payload.text);
    t.sent.length = 0; visit(NOW + 10 * DAY); await t.run(NOW + 10 * DAY); assert.equal(mine().length, 0, 'once a month');
    for (const [day, percent] of [[31, '30%'], [62, '50%'], [93, '50%']]) { t.sent.length = 0; visit(NOW + day * DAY); await t.run(NOW + day * DAY); assert.equal(mine().length, 1, `day ${day}`); assert.match(mine()[0], new RegExp(percent), `day ${day}: ladder capped at 50%`); }
  } finally { t.restore(); }
});
test('Nothing is sent while switched off, while payment does not work, at night, or to users gone for 90 days', async () => {
  for (const [opts, now, label] of [[{ enabled: false }, NOW, 'off'], [{ ready: false }, NOW, 'no payment'], [{}, Date.parse('2026-11-02T20:30:00Z'), 'night']]) {
    const t = setup(opts); try { t.user(1, { done: [1, 2, 3, 4, 5] }); assert.deepEqual(await t.run(now), { offers: 0, nudges: 0, afterFree: 0 }, label); assert.equal(t.sent.length, 0, label); } finally { t.restore(); }
  }
  const t = setup(); try { t.user(1, { seen: NOW - 100 * DAY, first: NOW - 100 * DAY }); assert.equal((await t.run(NOW)).offers, 0); } finally { t.restore(); }
  assert.deepEqual(offerSettings(new Store(':memory:')), { enabled: false, ladder: [15, 30, 50] });
});
test('One "less than 12 hours left" nudge for an unused code; one message a day after the free lessons', async () => {
  const t = setup();
  try {
    t.user(1); await t.run(NOW);
    t.sent.length = 0; assert.equal((await t.run(NOW + 46 * 3600000)).nudges, 1); // 10:00 Moscow time, 2 hours left
    assert.match(t.sent[0].payload.text, /меньше 12 часов/);
    assert.equal((await t.run(NOW + 47 * 3600000)).nudges, 0, 'only once');
    const u = setup(); try {
      u.user(5, { seen: NOW - 2 * DAY, first: NOW - 20 * DAY, done: [1, 2, 3, 4, 5] }); u.store.db.prepare('UPDATE users SET last_offer_at=? WHERE id=5').run(NOW - DAY);
      const r = await u.run(NOW); assert.equal(r.afterFree, 1); assert.match(u.sent[0].payload.text, /бесплатную часть/); assert.match(u.sent[0].payload.text, /навсегда/);
      assert.equal((await u.run(NOW + DAY)).afterFree, 0, 'only once');
    } finally { u.restore(); }
  } finally { t.restore(); }
});
test('"Не присылать предложения" and /offers', async () => {
  const t = setup();
  try {
    t.user(1);
    await handleUpdate({ callback_query: { id: 'c', from: { id: 1 }, data: 'offers:off', message: { chat: { id: 1 } } } }, { api: t.api, store: t.store, appUrl });
    assert.match(t.sent[0].payload.text, /не будем/i);
    assert.equal((await t.run(NOW)).offers, 0);
    await handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/offers' } }, { api: t.api, store: t.store, appUrl });
    assert.equal(t.sent.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data, 'offers:on');
  } finally { t.restore(); }
});
test('API: the session carries the personal code; admin saves the ladder and refuses more than 50%', async () => {
  const { createHmac } = await import('node:crypto'); const { createApp } = await import('../server/index.mjs');
  const TOKEN = 'synthetic-test-token-not-a-credential';
  const signed = id => { const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }), query_id: 't' }); d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex')); return d.toString(); };
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', ADMIN_IDS: '1', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:'); store.upsertUser({ id: 5, first_name: 'U' });
  store.addPersonalPromo('VIBE-ABCDEF', 30, new Date(Date.now() + 3600000).toISOString(), 5);
  const server = createApp({ store, telegram: { isMember: async () => true, api: async () => true }, content: {} }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`; const post = (url, id, body = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...body }) });
  try {
    assert.deepEqual((await (await post('/api/session', 5)).json()).personalOffer, { code: 'VIBE-ABCDEF', percent: 30, expiresAt: store.promo('VIBE-ABCDEF').expires_at });
    assert.equal((await (await post('/api/session', 6)).json()).personalOffer, null);
    assert.equal((await post('/api/promo', 6, { promo: 'VIBE-ABCDEF' })).status, 400, 'someone else cannot use it');
    assert.equal((await post('/api/admin/auto-offers', 1, { enabled: true, ladder: [15, 30, 60] })).status, 400);
    const ok = await (await post('/api/admin/auto-offers', 1, { enabled: true, ladder: [10, 25, 50] })).json();
    assert.deepEqual([ok.autoOffers.enabled, ok.autoOffers.ladder, ok.autoOffers.stats.sent], [true, [10, 25, 50], 1]);
    assert.equal(ok.promos.some(p => p.code === 'VIBE-ABCDEF'), false, 'personal codes are not mixed into the admin promo list');
    assert.equal((await post('/api/admin/auto-offers', 5, { enabled: false, ladder: [15] })).status, 403);
  } finally { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
