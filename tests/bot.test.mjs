import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { handleUpdate } from '../server/bot-core.mjs';

const appUrl = 'https://example.com';
function harness() { const calls = []; const api = async (method, payload) => { calls.push({ method, payload }); return true; }; return { calls, api, store: new Store(':memory:'), log: () => {} }; }
test('Bot handler: pre-checkout, successful payment, duplicate delivery, refund and wrong amount', async () => {
  const t = harness(); const order = t.store.createOrder(5, 50, 'one_time');
  await handleUpdate({ pre_checkout_query: { id: 'q1', invoice_payload: order.id, from: { id: 5 }, currency: 'XTR', total_amount: 50 } }, { ...t, appUrl });
  await handleUpdate({ pre_checkout_query: { id: 'q2', invoice_payload: order.id, from: { id: 6 }, currency: 'XTR', total_amount: 50 } }, { ...t, appUrl });
  assert.deepEqual(t.calls.map(c => c.payload.ok), [true, false]);
  const paid = { message: { chat: { id: 5, type: 'private' }, from: { id: 5 }, successful_payment: { invoice_payload: order.id, currency: 'XTR', total_amount: 50, telegram_payment_charge_id: 'ch-1' } } };
  await handleUpdate(paid, { ...t, appUrl }); await handleUpdate(paid, { ...t, appUrl });
  assert.equal(t.store.db.prepare('SELECT count(*) AS n FROM payments').get().n, 1);
  assert.equal(t.store.entitlement(5).active, true);
  assert.match(t.calls.at(-1).payload.text, /Оплата получена/);
  await handleUpdate({ message: { chat: { id: 5 }, refunded_payment: { telegram_payment_charge_id: 'ch-1' } } }, { ...t, appUrl });
  assert.equal(t.store.entitlement(5).active, false);
  const other = t.store.createOrder(6, 50, 'one_time');
  await handleUpdate({ message: { chat: { id: 6, type: 'private' }, from: { id: 6 }, successful_payment: { invoice_payload: other.id, currency: 'XTR', total_amount: 1, telegram_payment_charge_id: 'ch-2' } } }, { ...t, appUrl });
  assert.equal(t.store.entitlement(6).active, false);
  assert.match(t.calls.at(-1).payload.text, /не открылся автоматически/);
});
test('Bot handler: /id and /start answer in private chats only', async () => {
  const t = harness();
  await handleUpdate({ message: { chat: { id: 11, type: 'private' }, from: { id: 11 }, text: '/id' } }, { ...t, appUrl });
  await handleUpdate({ message: { chat: { id: 11, type: 'private' }, from: { id: 11 }, text: '/start' } }, { ...t, appUrl });
  await handleUpdate({ message: { chat: { id: -100, type: 'group' }, from: { id: 11 }, text: '/start' } }, { ...t, appUrl });
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0].payload.text, 'Ваш Telegram ID: 11');
  assert.equal(t.calls[1].payload.reply_markup.inline_keyboard[0][0].web_app.url, appUrl);
});
