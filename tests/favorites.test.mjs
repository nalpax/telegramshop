import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.mjs';
import { StoreCore, FAVORITES_LIMIT } from '../server/store-core.mjs';
import { createApp } from '../server/index.mjs';

// Bookmarks of prompts, lessons and articles: per account, validated, titles only.
const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Тест' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
async function setup() {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:');
  const content = {
    lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, title: `Урок ${i + 1}`, sections: [{ paragraphs: ['Секретный текст урока'] }] })),
    prompts: { categories: [], items: Array.from({ length: 210 }, (_, i) => ({ id: String(i + 1).padStart(3, '0'), title: `Промпт ${i + 1}`, use: 'b', prompt: 'Секретный текст промпта' })) },
    articles: [{ id: 'start-how', title: 'Как начать', groupTitle: 'Старт', markdown: 'Секретный текст статьи', free: true }],
  };
  const server = createApp({ store, telegram: { isMember: async () => true, api: async () => true }, content }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, id = 5) => fetch(base + path, { method, headers: id ? { 'X-Telegram-Init-Data': signed(id) } : {} });
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  return { store, call, done };
}

test('Favorites: add, repeat, remove, other accounts, unknown kind and id, no auth', async () => {
  const t = await setup();
  try {
    assert.deepEqual(await (await t.call('GET', '/api/favorites')).json(), { limit: FAVORITES_LIMIT, items: [] });
    assert.equal((await t.call('PUT', '/api/favorites/prompt/002')).status, 200);
    assert.equal((await t.call('PUT', '/api/favorites/lesson/6')).status, 200, 'a free user may bookmark a paid lesson');
    const added = await t.call('PUT', '/api/favorites/article/start-how');
    const body = await added.json();
    assert.deepEqual(body.items.map(i => [i.kind, i.id]).sort(), [['article', 'start-how'], ['lesson', 6], ['prompt', '002']]);
    assert.ok(body.items.every(i => Object.keys(i).sort().join() === 'id,kind,title'), 'only id, kind and title');
    assert.ok(!JSON.stringify(body).includes('Секретный'), 'no lesson, prompt or article text');
    assert.equal((await t.call('PUT', '/api/favorites/prompt/002')).status, 200, 'repeat is harmless');
    assert.equal((await (await t.call('GET', '/api/favorites')).json()).items.length, 3, 'no duplicate');
    assert.equal((await t.call('DELETE', '/api/favorites/prompt/002')).status, 200);
    assert.equal((await t.call('DELETE', '/api/favorites/prompt/002')).status, 200, 'removing twice is harmless');
    assert.deepEqual((await (await t.call('GET', '/api/favorites')).json()).items.map(i => i.kind).sort(), ['article', 'lesson']);
    assert.deepEqual((await (await t.call('GET', '/api/favorites', 6)).json()).items, [], 'other accounts see nothing');
    assert.equal((await t.call('DELETE', '/api/favorites/lesson/6', 6)).status, 200);
    assert.equal((await (await t.call('GET', '/api/favorites')).json()).items.length, 2, 'another account cannot remove my bookmark');
    assert.equal((await t.call('PUT', '/api/favorites/prompt/999')).status, 404, 'unknown prompt');
    assert.equal((await t.call('PUT', '/api/favorites/lesson/25')).status, 404, 'unknown lesson');
    assert.equal((await t.call('PUT', '/api/favorites/article/nope')).status, 404, 'unknown article');
    assert.equal((await t.call('PUT', '/api/favorites/lesson/start-how')).status, 404, 'an id of another kind');
    assert.equal((await t.call('PUT', '/api/favorites/video/1')).status, 400, 'unknown kind');
    assert.equal((await t.call('PUT', '/api/favorites/prompt/002', 0)).status, 401, 'no initData');
    assert.equal((await t.call('POST', '/api/favorites/prompt/002')).status, 404, 'only PUT and DELETE');
  } finally { await t.done(); }
});

test('Favorites: at most 200 per account', async () => {
  const t = await setup();
  try {
    for (let i = 1; i <= FAVORITES_LIMIT; i++) t.store.addFavorite(5, 'prompt', String(i).padStart(3, '0'), i);
    const over = await t.call('PUT', '/api/favorites/prompt/201');
    assert.equal(over.status, 409);
    assert.match((await over.json()).error, /200/);
    assert.equal((await t.call('PUT', '/api/favorites/prompt/001')).status, 200, 'an existing bookmark is still fine');
    assert.equal((await t.call('DELETE', '/api/favorites/prompt/001')).status, 200);
    assert.equal((await t.call('PUT', '/api/favorites/prompt/201')).status, 200, 'room again after removing one');
  } finally { await t.done(); }
});

test('Favorites: prompt favorites from before v1.1 are migrated, old backups restore', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE favorites (user_id INTEGER NOT NULL, prompt_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, prompt_id))');
  db.prepare('INSERT INTO favorites VALUES (?,?,?)').run(5, '007', 100);
  const store = new StoreCore(db);
  assert.deepEqual(store.favorites(5).map(r => ({ ...r })), [{ kind: 'prompt', item_id: '007', created_at: 100 }]);
  assert.deepEqual(store.marks(5).favorites, ['007']);
  const backup = store.dump();
  backup.tables.favorites = [{ user_id: 9, prompt_id: '010', created_at: 5 }];
  store.restore(backup);
  assert.deepEqual(store.favorites(9).map(r => ({ ...r })), [{ kind: 'prompt', item_id: '010', created_at: 5 }]);
  db.close();
});
