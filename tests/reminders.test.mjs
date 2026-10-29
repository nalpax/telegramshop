import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { handleUpdate, sendReminders } from '../server/bot-core.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-11-02T09:00:00Z'); // 12:00 in Moscow
const titles = Array.from({ length: 24 }, (_, i) => `Урок ${i + 1}`);
function setup() {
  const store = new Store(':memory:'); const sent = [];
  const api = async (method, payload) => { sent.push({ method, payload }); return true; };
  const user = (id, { seen, done = [], pro = false }) => { store.upsertUser({ id, first_name: 'U' + id }, seen); for (const l of done) store.db.prepare('INSERT INTO progress VALUES (?,?,?)').run(id, l, seen); if (pro) store.grantAccess(id); };
  return { store, sent, api, user };
}
test('Reminders: one message after 3 quiet days, only for unfinished courses, never twice for the same pause', async () => {
  const t = setup();
  t.user(1, { seen: NOW - 4 * DAY, done: [1, 2, 3] });          // free, stopped at 04 -> remind
  t.user(2, { seen: NOW - 1 * DAY, done: [1] });                // active recently -> no
  t.user(3, { seen: NOW - 4 * DAY, done: [] });                 // never started -> no
  t.user(4, { seen: NOW - 4 * DAY, done: [1, 2, 3, 4, 5] });    // free part finished -> no sales spam
  t.user(5, { seen: NOW - 5 * DAY, done: [1, 2, 3, 4, 5, 6], pro: true }); // paid, next 07 -> remind
  t.user(6, { seen: NOW - 40 * DAY, done: [1] });               // gone for good -> no
  t.user(7, { seen: NOW - 4 * DAY, done: [1] }); t.store.setReminders(7, false); // opted out -> no
  const count = await sendReminders({ store: t.store, api: t.api, appUrl: 'https://app.example', titles, now: NOW });
  assert.equal(count, 2);
  assert.deepEqual(t.sent.map(s => s.payload.chat_id), [1, 5]);
  const first = t.sent[0].payload;
  assert.match(first.text, /уроке 04 «Урок 4»/);
  assert.equal(first.reply_markup.inline_keyboard[0][0].web_app.url, 'https://app.example/#lesson?id=4');
  assert.equal(first.reply_markup.inline_keyboard[1][0].callback_data, 'reminders:off');
  assert.equal(await sendReminders({ store: t.store, api: t.api, appUrl: 'https://app.example', titles, now: NOW + DAY }), 0, 'not twice for the same pause');
  t.store.upsertUser({ id: 1, first_name: 'U1' }, NOW + 2 * DAY); // came back, then went quiet again
  // A week later: user 1 (back on day 2, quiet again) and user 2 (quiet since the day before the first run) get one each.
  t.sent.length = 0;
  assert.equal(await sendReminders({ store: t.store, api: t.api, appUrl: 'https://app.example', titles, now: NOW + 6 * DAY }), 2);
  assert.deepEqual(t.sent.map(s => s.payload.chat_id).sort(), [1, 2]);
});
test('Reminders are sent only in the daytime (Moscow) and a failed send does not stop the rest', async () => {
  const t = setup(); t.user(1, { seen: NOW - 4 * DAY, done: [1] }); t.user(2, { seen: NOW - 4 * DAY, done: [1] });
  const night = Date.parse('2026-11-02T20:00:00Z'); // 23:00 in Moscow
  assert.equal(await sendReminders({ store: t.store, api: t.api, appUrl: 'https://app.example', titles, now: night }), 0);
  let calls = 0; const flaky = async (method, payload) => { calls++; if (payload.chat_id === 1) { const e = new Error('blocked'); e.code = 403; throw e; } return true; };
  assert.equal(await sendReminders({ store: t.store, api: flaky, appUrl: 'https://app.example', titles, now: NOW }), 1);
  assert.equal(calls, 2);
  assert.equal(await sendReminders({ store: t.store, api: flaky, appUrl: 'https://app.example', titles, now: NOW + 3600000 }), 0, 'a blocked user is not retried every hour');
});
test('"Не напоминать" turns reminders off; /reminders turns them back on', async () => {
  const t = setup(); t.user(1, { seen: NOW - 4 * DAY, done: [1] });
  await handleUpdate({ callback_query: { id: 'cb1', from: { id: 1 }, data: 'reminders:off', message: { chat: { id: 1 }, message_id: 9 } } }, { api: t.api, store: t.store, appUrl: 'https://app.example' });
  assert.equal(t.sent[0].method, 'answerCallbackQuery');
  assert.equal(await sendReminders({ store: t.store, api: t.api, appUrl: 'https://app.example', titles, now: NOW }), 0);
  await handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/reminders' } }, { api: t.api, store: t.store, appUrl: 'https://app.example' });
  const reply = t.sent.at(-1).payload; assert.match(reply.text, /выключены/); assert.equal(reply.reply_markup.inline_keyboard[0][0].callback_data, 'reminders:on');
  await handleUpdate({ callback_query: { id: 'cb2', from: { id: 1 }, data: 'reminders:on', message: { chat: { id: 1 }, message_id: 10 } } }, { api: t.api, store: t.store, appUrl: 'https://app.example' });
  assert.equal(await sendReminders({ store: t.store, api: t.api, appUrl: 'https://app.example', titles, now: NOW }), 1);
});
