import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { makeProviders } from '../server/providers/index.mjs';

const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Тест' }), query_id: 't' });
  const check = [...data].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n');
  data.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(check).digest('hex'));
  return data.toString();
}
async function setup(extraEnv = {}) {
  const old = { ...process.env };
  Object.assign(process.env, { BOT_TOKEN: TOKEN, ADMIN_IDS: '1', PRICE_STARS: '1000', MEMBERSHIP_CACHE_SECONDS: '0', NODE_ENV: 'test', APP_URL: 'https://app.example.com', BOT_USERNAME: 'vibentrybot',
    PLATEGA_MERCHANT_ID: 'merchant-1', PLATEGA_SECRET: 'platega-secret', CRYPTOBOT_TOKEN: '123:cryptotoken', XROCKET_API_KEY: 'xr-key', XROCKET_WEBHOOK_SECRET: 'xr-hook', ...extraEnv });
  delete process.env.REQUIRED_CHANNEL_ID; delete process.env.REQUIRED_CHANNEL_URL;
  const remote = { status: {}, created: [], messages: [] }; // what the "provider" says about each invoice
  const fetchImpl = async (url, init) => {
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.endsWith('/transaction/process')) { remote.created.push({ provider: 'platega', headers: init.headers, body }); remote.status['pl-1'] = { status: 'PENDING', paymentDetails: { amount: body.paymentDetails.amount, currency: 'RUB' } }; return reply({ transactionId: 'pl-1', redirect: 'https://pay.platega.example/pl-1', status: 'PENDING' }); }
    if (url.includes('/transaction/')) return reply(remote.status[url.split('/transaction/')[1]] || {}, remote.status[url.split('/transaction/')[1]] ? 200 : 404);
    if (url.endsWith('/createInvoice')) { remote.created.push({ provider: 'cryptobot', headers: init.headers, body }); remote.status['777'] = { status: 'active', amount: body.amount, asset: 'USDT' }; return reply({ ok: true, result: { invoice_id: 777, status: 'active', mini_app_invoice_url: 'https://t.me/CryptoBot/app?startapp=invoice-x', bot_invoice_url: 'https://t.me/CryptoBot?start=x' } }); }
    if (url.includes('/getInvoices')) { const id = new URL(url).searchParams.get('invoice_ids'); return reply({ ok: true, result: { items: remote.status[id] ? [remote.status[id]] : [] } }); }
    if (url.endsWith('/api/v1/invoices')) { remote.created.push({ provider: 'xrocket', headers: init.headers, body }); remote.status['xr-1'] = { id: 'xr-1', status: 'active', priceAmount: body.priceAmount, priceCurrency: body.priceCurrency, clientInvoiceId: body.clientInvoiceId }; return reply({ ...remote.status['xr-1'], links: { telegramBotLink: 'https://t.me/xRocket?start=inv_xr1', telegramMiniAppLink: 'https://t.me/xRocket/app?startapp=inv_xr1' } }); }
    if (url.includes('/api/v1/invoice?invoiceId=')) { const id = new URL(url).searchParams.get('invoiceId'); return reply(remote.status[id] || {}, remote.status[id] ? 200 : 404); }
    return reply({}, 404);
  };
  const store = new Store(':memory:');
  const telegram = { isMember: async () => true, api: async (method, payload) => { remote.messages.push({ method, payload }); return 'https://t.me/$stars'; } };
  const content = { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, sections: [{ paragraphs: ['x'] }] })), resources: { 'first-prompt': 'x', 'mobile-prompt': 'x', notes: 'x' }, prompts: { categories: [], items: [] }, articles: [], providers: makeProviders(process.env, fetchImpl) };
  const server = createApp({ store, telegram, content }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url, id = 1) => fetch(base + url, { headers: { 'X-Telegram-Init-Data': signed(id) } });
  const post = (url, data = {}, id = 1) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...data }) });
  const raw = (url, body, headers) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  await post('/api/admin/channels', { channels: [{ url: 'https://t.me/vibentry' }] });
  return { store, get, post, raw, remote, done };
}
const enableAll = async t => {
  await t.post('/api/admin/offer', { priceStars: 1000, priceRub: 990, priceUsdt: 9.99, discountPercent: 0 });
  for (const id of ['platega', 'cryptobot', 'xrocket']) assert.equal((await t.post('/api/admin/providers', { id, enabled: true })).status, 200);
};
const cryptoSignature = body => createHmac('sha256', createHash('sha256').update('123:cryptotoken').digest()).update(body).digest('hex');

test('Providers stay hidden until configured, priced and switched on in the admin panel', async () => {
  const t = await setup({ PLATEGA_SECRET: '' });
  try {
    const config = async () => (await (await fetch(t.get.toString() && `http://127.0.0.1:${new URL((await t.get('/api/config')).url).port}/api/config`)).json());
    assert.deepEqual((await config()).methods.map(m => m.id), ['stars']);
    assert.equal((await t.post('/api/admin/providers', { id: 'platega', enabled: true })).status, 400, 'no credentials -> cannot enable');
    assert.equal((await t.post('/api/admin/providers', { id: 'cryptobot', enabled: true })).status, 200);
    assert.deepEqual((await config()).methods.map(m => m.id), ['stars'], 'no USDT price yet');
    await t.post('/api/admin/offer', { priceStars: 1000, priceUsdt: 9.99, discountPercent: 0 });
    const methods = (await config()).methods; assert.deepEqual(methods.map(m => m.id), ['stars', 'cryptobot']); assert.equal(methods[1].amount, 9.99);
    assert.equal((await t.post('/api/admin/providers', { id: 'cryptobot', enabled: true }, 5)).status, 403);
    assert.equal(JSON.stringify(await (await t.get('/api/admin/overview')).json()).includes('cryptotoken'), false, 'secrets never reach the browser');
  } finally { await t.done(); }
});

test('CryptoBot: invoice, signed webhook, provider re-check, idempotency and amount mismatch', async () => {
  const t = await setup();
  try {
    await enableAll(t);
    await t.post('/api/admin/promos', { code: 'HALF', percent: 50 });
    const invoice = await (await t.post('/api/invoice', { method: 'cryptobot', promo: 'half' }, 9)).json();
    assert.match(invoice.url, /^https:\/\/t\.me\/CryptoBot/); assert.ok(invoice.orderId);
    const sent = t.remote.created.find(c => c.provider === 'cryptobot'); assert.equal(sent.body.amount, '5.00'); assert.equal(sent.body.asset, 'USDT'); assert.equal(sent.body.payload, invoice.orderId);
    assert.equal((await (await t.get('/api/order/' + invoice.orderId, 9)).json()).paid, false);
    const body = JSON.stringify({ update_id: 1, update_type: 'invoice_paid', request_date: new Date().toISOString(), payload: { invoice_id: 777, status: 'paid' } });
    assert.equal((await t.raw('/api/webhooks/cryptobot', body, { 'crypto-pay-api-signature': 'f'.repeat(64) })).status, 401);
    assert.equal((await t.raw('/api/webhooks/cryptobot', body, { 'crypto-pay-api-signature': cryptoSignature(body) })).status, 200);
    assert.equal((await (await t.post('/api/session', {}, 9)).json()).access.active, false, 'a signed webhook alone does not unlock: the provider still says "active"');
    t.remote.status['777'].status = 'paid';
    assert.equal((await t.raw('/api/webhooks/cryptobot', body, { 'crypto-pay-api-signature': cryptoSignature(body) })).status, 200);
    assert.equal((await t.raw('/api/webhooks/cryptobot', body, { 'crypto-pay-api-signature': cryptoSignature(body) })).status, 200);
    assert.equal((await (await t.post('/api/session', {}, 9)).json()).access.active, true);
    assert.equal(t.store.db.prepare('SELECT count(*) AS n FROM payments WHERE user_id=9').get().n, 1);
    assert.equal(t.store.promo('HALF').used, 1);
    assert.equal((await (await t.get('/api/order/' + invoice.orderId, 9)).json()).paid, true);
    assert.equal((await t.get('/api/order/' + invoice.orderId, 10)).status, 404, 'orders are private to the buyer');
    const stats = (await (await t.get('/api/admin/overview')).json()).stats; assert.deepEqual(stats.revenueBy, [{ currency: 'USDT', total: 5, n: 1 }]);
    // an invoice the provider reports with a different amount never grants access
    const cheat = await (await t.post('/api/invoice', { method: 'cryptobot' }, 11)).json();
    t.remote.status['777'] = { status: 'paid', amount: '0.01', asset: 'USDT' }; t.store.attachInvoice('cryptobot', '888', cheat.orderId);
    const b2 = JSON.stringify({ update_type: 'invoice_paid', payload: { invoice_id: 888 } }); t.remote.status['888'] = { status: 'paid', amount: '0.01', asset: 'USDT' };
    await t.raw('/api/webhooks/cryptobot', b2, { 'crypto-pay-api-signature': cryptoSignature(b2) });
    assert.equal((await (await t.post('/api/session', {}, 11)).json()).access.active, false);
  } finally { await t.done(); }
});

test('Platega: header-authenticated callback is re-checked with GET /transaction/{id}; polling covers a missed callback', async () => {
  const t = await setup();
  try {
    await enableAll(t);
    const invoice = await (await t.post('/api/invoice', { method: 'platega' }, 20)).json();
    const sent = t.remote.created.find(c => c.provider === 'platega');
    assert.equal(sent.headers['X-MerchantId'], 'merchant-1'); assert.equal(sent.body.paymentDetails.amount, 990); assert.equal(sent.body.paymentDetails.currency, 'RUB'); assert.equal(sent.body.id, invoice.orderId);
    const callback = JSON.stringify({ id: 'pl-1', amount: 990, currency: 'RUB', status: 'CONFIRMED', paymentMethod: 2, payload: invoice.orderId });
    assert.equal((await t.raw('/api/webhooks/platega', callback, { 'x-merchantid': 'merchant-1', 'x-secret': 'wrong' })).status, 401);
    assert.equal((await t.raw('/api/webhooks/platega', callback, { 'x-merchantid': 'merchant-1', 'x-secret': 'platega-secret' })).status, 200);
    assert.equal((await (await t.post('/api/session', {}, 20)).json()).access.active, false, 'GET /transaction still says PENDING');
    t.remote.status['pl-1'].status = 'CONFIRMED';
    await new Promise(r => setTimeout(r, 3100));
    assert.equal((await (await t.get('/api/order/' + invoice.orderId, 20)).json()).paid, true, 'status poll finds the payment without a callback');
    assert.equal((await (await t.post('/api/session', {}, 20)).json()).access.active, true);
    assert.ok(t.remote.messages.some(m => m.method === 'sendMessage' && m.payload.chat_id === 20));
  } finally { await t.done(); }
});

test('xRocket (current API): invoice fields, signed webhook is only a hint, the lookup at xRocket decides', async () => {
  const t = await setup();
  try {
    await enableAll(t);
    const invoice = await (await t.post('/api/invoice', { method: 'xrocket' }, 30)).json();
    assert.equal(invoice.url, 'https://t.me/xRocket/app?startapp=inv_xr1');
    const sent = t.remote.created.find(c => c.provider === 'xrocket');
    assert.equal(sent.headers.Authorization, 'Bearer xr-key');
    assert.deepEqual([sent.body.priceAmount, sent.body.priceCurrency, sent.body.numPayments, sent.body.clientInvoiceId], ['9.99', 'USDT', 1, invoice.orderId]);
    const body = JSON.stringify({ id: 'wh-1', timestamp: new Date().toISOString(), type: 'invoice', data: { event: 'invoice_status_changed', invoice: { id: 'xr-1', status: 'paid', priceAmount: '9.99', priceCurrency: 'USDT', clientInvoiceId: invoice.orderId } } });
    const sign = (stamp, secret = 'xr-hook') => ({ signature: createHmac('sha256', secret).update(`${stamp}.${body}`).digest('hex'), 'signature-timestamp': String(stamp), 'signature-version': 'v1' });
    assert.equal((await t.raw('/api/webhooks/xrocket', body, sign(Date.now(), 'other'))).status, 401);
    assert.equal((await t.raw('/api/webhooks/xrocket', body, sign(Date.now() - 600000))).status, 401, 'older than five minutes');
    assert.equal((await t.raw('/api/webhooks/xrocket', body, sign(Date.now()))).status, 200);
    assert.equal((await (await t.post('/api/session', {}, 30)).json()).access.active, false, 'xRocket itself still says active: no access');
    t.remote.status['xr-1'] = { ...t.remote.status['xr-1'], status: 'paid', priceAmount: '1.00' };
    await t.raw('/api/webhooks/xrocket', body, sign(Date.now()));
    assert.equal((await (await t.post('/api/session', {}, 30)).json()).access.active, false, 'paid, but the wrong amount: refused');
    t.remote.status['xr-1'] = { ...t.remote.status['xr-1'], status: 'paid', priceAmount: '9.99' };
    await t.raw('/api/webhooks/xrocket', body, sign(Date.now())); await t.raw('/api/webhooks/xrocket', body, sign(Date.now()));
    assert.equal((await (await t.post('/api/session', {}, 30)).json()).access.active, true);
    assert.equal(t.store.db.prepare("SELECT count(*) AS n FROM payments WHERE provider='xrocket'").get().n, 1, 'a repeated webhook does not double the payment');
  } finally { await t.done(); }
});

test('Stars checkout still works next to other methods and unknown methods are refused', async () => {
  const t = await setup();
  try {
    await enableAll(t);
    assert.equal((await t.post('/api/invoice', { method: 'paypal' }, 40)).status, 503);
    const stars = await (await t.post('/api/invoice', { method: 'stars' }, 41)).json(); assert.equal(stars.url, 'https://t.me/$stars');
    assert.equal(t.remote.messages.at(-1).payload.prices[0].amount, 1000);
    assert.equal((await t.raw('/api/webhooks/nope', '{}', {})).status, 404);
  } finally { await t.done(); }
});
