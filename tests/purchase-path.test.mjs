import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { handleUpdate, messageFor, tariffMessage, docsMessage } from '../server/bot-core.mjs';

// The payment provider's moderation needs the whole path in the bot: what is sold -> exact price -> a clickable
// "Оплатить" -> what happens next. Until a payment method is live, the button answers with a clear stub.
const appUrl = 'https://app.example';
const info = (ready = false) => ({ prices: { rub: 1299, stars: null }, ready, course: { lessons: 24, freeLessons: 5, prompts: 300, articles: 35 } });
function harness(ready = false) { const calls = []; return { calls, store: new Store(':memory:'), api: async (method, payload) => { calls.push({ method, payload }); return true; }, purchase: () => info(ready) }; }
const button = (markup, pred) => markup.inline_keyboard.flat().find(pred);

test('Bot /start leads to the tariff, documents and support', () => {
  const m = messageFor('/start', appUrl);
  for (const data of ['tariff', 'docs']) assert.ok(button(m.reply_markup, b => b.callback_data === data), data);
  assert.ok(button(m.reply_markup, b => b.web_app?.url === appUrl));
});
test('Tariff message: name, exact price, what is included, lifetime, and a clickable pay button', () => {
  const m = tariffMessage(info(), appUrl);
  assert.match(m.text, /Полный доступ/); assert.match(m.text, /1\s299 ₽/u); assert.match(m.text, /24 урока/); assert.match(m.text, /300 промптов/);
  assert.match(m.text, /навсегда/); assert.match(m.text, /без подписки/); assert.doesNotMatch(m.text, /уточняется|от 1|после регистрации/i);
  const pay = button(m.reply_markup, b => b.callback_data === 'pay'); assert.match(pay.text, /Оплатить 1\s299 ₽/u);
  assert.ok(button(m.reply_markup, b => b.url === appUrl + '/terms.html'));
});
test('"Оплатить" without a live payment method shows a stub and charges nothing', async () => {
  const t = harness(false);
  await handleUpdate({ callback_query: { id: 'c1', from: { id: 5 }, data: 'pay', message: { chat: { id: 5 } } } }, { api: t.api, store: t.store, appUrl, purchase: t.purchase });
  const answer = t.calls.find(c => c.method === 'answerCallbackQuery');
  assert.equal(answer.payload.show_alert, true); assert.match(answer.payload.text, /Оплата пока недоступна/);
  assert.equal(t.calls.some(c => /Invoice/.test(c.method)), false);
  assert.equal(t.store.db.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
});
test('"Оплатить" with a live payment method opens the checkout in the app', async () => {
  const t = harness(true);
  await handleUpdate({ callback_query: { id: 'c2', from: { id: 5 }, data: 'pay', message: { chat: { id: 5 } } } }, { api: t.api, store: t.store, appUrl, purchase: t.purchase });
  const sent = t.calls.find(c => c.method === 'sendMessage');
  assert.equal(button(sent.payload.reply_markup, b => b.web_app).web_app.url, appUrl + '/#buy');
});
test('/tariff, /start buy and the "tariff" button all show the tariff; /docs and the button show the documents', async () => {
  for (const update of [{ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: '/tariff' } }, { message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: '/start buy' } }, { callback_query: { id: 'c3', from: { id: 7 }, data: 'tariff', message: { chat: { id: 7 } } } }]) {
    const t = harness(); await handleUpdate(update, { api: t.api, store: t.store, appUrl, purchase: t.purchase });
    assert.match(t.calls.find(c => c.method === 'sendMessage').payload.text, /Полный доступ[\s\S]*1\s299 ₽/u);
  }
  const t = harness(); await handleUpdate({ callback_query: { id: 'c4', from: { id: 7 }, data: 'docs', message: { chat: { id: 7 } } } }, { api: t.api, store: t.store, appUrl, purchase: t.purchase });
  const docs = t.calls.find(c => c.method === 'sendMessage').payload;
  for (const page of ['tariffs', 'terms', 'privacy', 'contacts']) assert.ok(button(docs.reply_markup, b => b.url === `${appUrl}/${page}.html`), page);
  assert.deepEqual(docsMessage(appUrl).reply_markup, docs.reply_markup);
});
test('Without any price the tariff says so honestly and the stub still answers', () => {
  const m = tariffMessage({ ...info(), prices: { rub: null, stars: null } }, appUrl);
  assert.match(m.text, /Цена появится перед началом продаж/); assert.ok(button(m.reply_markup, b => b.callback_data === 'pay'));
});
