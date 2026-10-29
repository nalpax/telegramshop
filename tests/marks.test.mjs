import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// Favourite prompts and ticked lesson checklist items are kept on the server, per Telegram account.
const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Тест' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
test('Marks: favourites and checklist ticks are per account, validated and respect paid access', async () => {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:'); let member = true;
  const content = { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, sections: [{ paragraphs: ['x'] }] })), prompts: { categories: [], items: [{ id: '001', title: 'a', use: 'b', prompt: 'c' }, { id: '002', title: 'a', use: 'b', prompt: 'c' }] } };
  const server = createApp({ store, telegram: { isMember: async () => member, api: async () => true }, content }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = id => fetch(base + '/api/marks', { headers: { 'X-Telegram-Init-Data': signed(id) } });
  const post = (id, data) => fetch(base + '/api/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...data }) });
  try {
    assert.deepEqual(await (await get(5)).json(), { favorites: [], tasks: {} });
    assert.equal((await post(5, { favorite: { id: '002', on: true } })).status, 200);
    assert.equal((await post(5, { favorite: { id: '001', on: true } })).status, 200);
    assert.equal((await post(5, { favorite: { id: '001', on: true } })).status, 200, 'idempotent');
    assert.equal((await post(5, { favorite: { id: '999', on: true } })).status, 400, 'unknown prompt');
    assert.equal((await post(5, { task: { lessonId: 3, index: 1, on: true } })).status, 200, 'free lesson');
    assert.equal((await post(5, { task: { lessonId: 3, index: 4, on: true } })).status, 200);
    assert.equal((await post(5, { task: { lessonId: 3, index: 4, on: false } })).status, 200);
    assert.equal((await post(5, { task: { lessonId: 6, index: 0, on: true } })).status, 403, 'paid lesson needs the purchase');
    assert.equal((await post(5, { task: { lessonId: 3, index: 500, on: true } })).status, 400);
    assert.equal((await post(5, { task: { lessonId: 30, index: 0, on: true } })).status, 400);
    assert.deepEqual(await (await get(5)).json(), { favorites: ['001', '002'], tasks: { 3: [1] } });
    assert.deepEqual(await (await get(6)).json(), { favorites: [], tasks: {} }, 'other accounts see nothing');
    store.grantAccess(5);
    assert.equal((await post(5, { task: { lessonId: 6, index: 0, on: true } })).status, 200);
    assert.equal((await post(5, { favorite: { id: '002', on: false } })).status, 200);
    assert.deepEqual(await (await get(5)).json(), { favorites: ['001'], tasks: { 3: [1], 6: [0] } });
    // A progress reset clears the ticks too.
    const r = await fetch(base + '/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(5), reset: true }) }); assert.equal(r.status, 200);
    assert.deepEqual((await (await get(5)).json()).tasks, {});
    assert.equal((await fetch(base + '/api/marks')).status, 401);
    member = false; assert.equal((await get(5)).status, 403, 'subscription still required');
  } finally { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
