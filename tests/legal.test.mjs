import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// Documents for the payment provider and the bank: they must open in a normal browser, without Telegram.
async function setup(env) {
  const old = { ...process.env };
  Object.assign(process.env, { BOT_TOKEN: 'synthetic-test-token-not-a-credential', PLATEGA_SECRET: 'synthetic-platega-secret', NODE_ENV: 'test', BOT_USERNAME: 'vibentry_test_bot', SUPPORT_USERNAME: 'nalpax', ...env });
  const store = new Store(':memory:');
  const server = createApp({ store, telegram: { isMember: async () => false, api: async () => true }, content: { prompts: { categories: [], items: [{ id: '001', title: 't', use: 'u', prompt: 'p' }] }, articles: [] } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  return { store, base, done };
}
test('/api/legal: seller, support and current prices, public, without secrets', async () => {
  const t = await setup({ SELLER_STATUS: 'ИП', SELLER_NAME: 'Иванов Иван Иванович', SELLER_INN: '123456789012', SUPPORT_EMAIL: 'help@example.com' });
  try {
    t.store.saveSettings({ priceStars: 500, priceRub: 1990, priceUsdt: null, discountPercent: 0, saleEndsAt: null });
    const response = await fetch(t.base + '/api/legal'); assert.equal(response.status, 200);
    const text = await response.text(); const data = JSON.parse(text);
    assert.equal(data.seller.name, 'Иванов Иван Иванович'); assert.equal(data.seller.inn, '123456789012'); assert.equal(data.seller.status, 'ИП');
    assert.equal(data.support.telegram, 'nalpax'); assert.equal(data.support.email, 'help@example.com'); assert.equal(data.support.bot, 'vibentry_test_bot');
    assert.equal(data.prices.rub, 1990); assert.equal(data.prices.stars, 500);
    assert.deepEqual(data.course, { lessons: 24, freeLessons: 5, prompts: 1, articles: 0 });
    assert.equal(data.documentsDate, '2026-10-29');
    for (const secret of ['synthetic-test-token', 'synthetic-platega-secret']) assert.equal(text.includes(secret), false, secret);
  } finally { await t.done(); }
});
test('/api/legal: malformed seller details are not shown, nothing is invented', async () => {
  const t = await setup({ SELLER_NAME: '', SELLER_INN: '12345', SUPPORT_EMAIL: 'not an email' });
  try {
    const data = await (await fetch(t.base + '/api/legal')).json();
    assert.deepEqual(data.seller, { status: null, name: null, inn: null }, 'no seller status or details unless the owner sets them'); assert.equal(data.support.email, null);
    assert.equal(data.prices.rub, null); assert.equal(data.prices.stars, null);
  } finally { await t.done(); }
});
test('Document pages open in a browser and link to each other', async () => {
  const t = await setup({});
  const pages = ['/tariffs.html', '/terms.html', '/privacy.html', '/contacts.html'];
  try {
    for (const page of pages) {
      const response = await fetch(t.base + page); assert.equal(response.status, 200, page); assert.match(response.headers.get('content-type'), /text\/html/);
      const html = await response.text();
      for (const other of pages) assert.ok(html.includes(`href="${other}"`), `${page} links ${other}`);
      assert.ok(html.includes('src="/js/legal.js"'), page);
      assert.equal(/самозанят|ИНН \d|ФИО:/i.test(html), false, `${page}: no seller status or personal data in the static text`); assert.equal(/style=|<script>/.test(html), false, `${page}: CSP forbids inline styles and scripts`);
    }
    const terms = await (await fetch(t.base + '/terms.html')).text();
    assert.match(terms, /24 часов/); assert.match(terms, /не предоставляется/);
    const privacy = await (await fetch(t.base + '/privacy.html')).text();
    for (const word of ['Telegram ID', 'Cloudflare', 'Platega', 'метк', 'localStorage']) assert.ok(privacy.includes(word), word);
  } finally { await t.done(); }
});
test('Rubles: PRICE_RUB is the starting price; the admin can change it without a Stars price; the sale applies to rubles', async () => {
  const { createHmac } = await import('node:crypto');
  const TOKEN = 'synthetic-test-token-not-a-credential';
  const initData = id => { const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Админ' }), query_id: 't' }); const c = [...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n'); d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(c).digest('hex')); return d.toString(); };
  const t = await setup({ BOT_TOKEN: TOKEN, PRICE_RUB: '1299', ADMIN_IDS: '1' });
  const legal = async () => (await (await fetch(t.base + '/api/legal')).json()).prices;
  const offer = body => fetch(t.base + '/api/admin/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: initData(1), ...body }) });
  try {
    assert.equal((await legal()).rub, 1299); assert.equal((await legal()).stars, null);
    assert.equal((await offer({ priceStars: null, priceRub: 1499, discountPercent: 10 })).status, 200);
    const p = await legal(); assert.equal(p.rub, 1349); assert.equal(p.regular.rub, 1499); assert.equal(p.salePercent, 10); assert.equal(p.stars, null);
    assert.equal((await offer({ priceStars: null, priceRub: null, discountPercent: 0 })).status, 400, 'at least one price');
    assert.equal((await offer({ priceStars: 0, priceRub: 1299, discountPercent: 0 })).status, 400, 'a Stars price, if given, is a positive integer');
    assert.equal((await offer({ priceStars: 700, priceRub: 1299, discountPercent: 0 })).status, 200);
    assert.deepEqual([(await legal()).rub, (await legal()).stars], [1299, 700]);
    const fresh = await setup({ PRICE_RUB: 'abc' }); try { assert.equal((await (await fetch(fresh.base + '/api/legal')).json()).prices.rub, null); } finally { await fresh.done(); }
  } finally { await t.done(); }
});
