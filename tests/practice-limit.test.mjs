import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

// «Практикум» is paid: Pro has no limit, a free account gets 3 trainer launches in total. Counted on the server.
const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Тест' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
test('Practicum: 3 free launches, then payment; Pro unlimited; quiz and checklist only after an allowed launch', async () => {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:'); let member = true;
  const server = createApp({ store, telegram: { isMember: async () => member, api: async () => true }, content: { lessons: [{ id: 1, sections: [{ paragraphs: ['x'] }] }] } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const start = (id, trainer) => fetch(base + '/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), id: trainer }) });
  const session = async id => (await (await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id) }) })).json()).practice;
  try {
    assert.deepEqual(await session(5), { unlimited: false, limit: 3, remaining: 3 });
    const first = await (await start(5, 'quiz')).json();
    assert.equal(first.remaining, 2); assert.equal(first.data.quiz.length, 7); assert.ok(first.data.quiz[0].why);
    const second = await (await start(5, 'handover')).json(); assert.equal(second.remaining, 1); assert.equal(second.data.handover.length, 5);
    assert.equal((await (await start(5, 'builder')).json()).remaining, 0);
    const blocked = await start(5, 'estimate'); assert.equal(blocked.status, 403);
    const body = await blocked.json(); assert.equal(body.reason, 'payment'); assert.equal(body.data, undefined, 'no content after the limit');
    assert.deepEqual(await session(5), { unlimited: false, limit: 3, remaining: 0 });
    assert.equal((await start(6, 'quiz')).status, 200, 'the limit is per account');
    assert.equal((await start(5, 'nope')).status, 400);
    store.upsertUser({ id: 7, first_name: 'P' }); store.grantAccess(7);
    for (let i = 0; i < 5; i++) assert.equal((await start(7, 'quiz')).status, 200);
    assert.deepEqual(await session(7), { unlimited: true, limit: 3, remaining: 3 });
    assert.equal((await fetch(base + '/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'quiz' }) })).status, 401);
    member = false; assert.equal((await start(6, 'quiz')).status, 403, 'subscription still required');
  } finally { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
