import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { EXERCISES, STAGES, checkAnswer, exerciseById, publicExercise } from '../server/exercises.mjs';

// Lesson exercises and the learning project: server-side checks, access by lesson, saved results, stage completion.
const TOKEN = 'synthetic-test-token-not-a-credential';
function signed(id) {
  const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Т' }), query_id: 't' });
  d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return d.toString();
}
async function setup() {
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', MEMBERSHIP_CACHE_SECONDS: '0', REQUIRED_CHANNEL_ID: '@examplechannel', REQUIRED_CHANNEL_URL: 'https://t.me/examplechannel' });
  const store = new Store(':memory:'); const members = new Set([5, 6]);
  const server = createApp({ store, telegram: { isMember: async id => members.has(id), api: async () => true }, content: { lessons: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, title: `Урок ${i + 1}`, sections: [{ paragraphs: ['x'] }] })) } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, id = 5) => fetch(base + path, { headers: { 'X-Telegram-Init-Data': signed(id) } });
  const post = (path, body, id = 5) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id), ...body }) });
  const done = async () => { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); };
  return { store, get, post, done };
}
const GOOD_PROMPT = 'Создай учебную страницу для репетитора в папке site. Для кого: родители школьников. Блоки: шапка; первый экран; три формата занятий; контакт. Не выдумывай отзывы. Сначала покажи план.';

test('Exercises: the public version has no answers, notes or rules; definitions match real lessons and stages', () => {
  for (const x of EXERCISES) {
    const shown = JSON.stringify(publicExercise(x));
    if (x.type === 'choice') for (const item of x.items) { assert.ok(!shown.includes(item.why), `${x.id}: explanation is hidden`); assert.ok(!('right' in publicExercise(x).items[0])); for (const [, note] of item.options) if (note) assert.ok(!shown.includes(note), `${x.id}: option note is hidden`); }
    if (x.type === 'improve') for (const c of x.checks) assert.ok(!shown.includes(c.miss), `${x.id}: hints only after an answer`);
    assert.ok(x.lesson >= 1 && x.lesson <= 24);
  }
  for (const s of STAGES) for (const id of s.exercises) assert.equal(exerciseById(id).stage, s.id);
  // Nothing of this lives in the public app files.
  const pub = readdirSync('public/js').map(f => readFileSync('public/js/' + f, 'utf8')).join('\n');
  for (const x of EXERCISES.filter(x => x.type === 'choice')) assert.ok(!pub.includes(x.items[0].why.slice(0, 40)), `${x.id} explanation not in public JS`);
});

test('Exercises: rule-based checks give a useful breakdown and accept reasonable alternatives', () => {
  const prompt = exerciseById('task-prompt');
  const weak = checkAnswer(prompt, { text: prompt.starter });
  assert.equal(weak.passed, false); assert.ok(weak.feedback.every(f => f.text));
  const half = checkAnswer(prompt, { text: 'Сделай страницу репетитора для школьников, чтобы было красиво и современно.' });
  assert.equal(half.passed, false);
  assert.deepEqual(half.feedback.filter(f => !f.optional && !f.ok).map(f => f.label), ['Перечислены блоки', 'Понятно, как принять работу']);
  assert.equal(checkAnswer(prompt, { text: GOOD_PROMPT }).passed, true);
  const blocks = exerciseById('page-blocks');
  assert.equal(checkAnswer(blocks, { blocks: ['header', 'hero', 'formats', 'contact', 'note'] }).passed, true);
  assert.equal(checkAnswer(blocks, { blocks: ['header', 'hero', 'contact', 'formats'] }).passed, true, 'contact before formats is a fine alternative');
  const wrong = checkAnswer(blocks, { blocks: ['hero', 'header', 'reviews', 'formats', 'contact'] });
  assert.equal(wrong.passed, false); assert.ok(wrong.feedback.some(f => /Отзывы/.test(f.text))); assert.ok(wrong.feedback.some(f => /Шапку/.test(f.text)));
  assert.throws(() => checkAnswer(blocks, { blocks: ['header', 'header'] }), { status: 400 });
  const choice = exerciseById('edit-or-task');
  const partly = checkAnswer(choice, { picks: [0, 0, 1] });
  assert.equal(partly.passed, false); assert.match(partly.summary, /1 из 3/);
  assert.equal(checkAnswer(choice, { picks: [0, 1, 0] }).passed, true);
  assert.throws(() => checkAnswer(choice, { picks: [0, 1] }), { status: 400 });
  const list = exerciseById('launch-check');
  const all = Object.fromEntries(list.items.map(([id]) => [id, 'done']));
  assert.equal(checkAnswer(list, { marks: { ...all, form: 'na', errors: 'na' } }).passed, true, '«не используется» is fine');
  assert.equal(checkAnswer(list, { marks: { ...all, links: 'fix' } }).passed, false);
  assert.match(checkAnswer(list, { marks: { open: 'done' } }).summary, /Отметьте все пункты/);
  assert.match(checkAnswer(list, { marks: all }).summary, /приложение сайт не проверяло/);
});

test('Exercises API: access by lesson, mistake, retry, saved result after reload, versions, no auth', async () => {
  const t = await setup();
  try {
    assert.equal((await fetch((await t.get('/api/project')).url)).status, 401, 'no initData');
    assert.equal((await t.get('/api/exercises', 7)).status, 403, 'channel subscription required');
    const list = await (await t.get('/api/exercises')).json();
    assert.deepEqual(list.items.filter(x => x.open).map(x => x.id), ['task-prompt', 'page-blocks'], 'free user: only exercises of lessons 01–05');
    const closed = await t.get('/api/exercises/style-contrast');
    assert.equal(closed.status, 403); const closedBody = await closed.json();
    assert.equal(closedBody.reason, 'payment'); assert.ok(!JSON.stringify(closedBody).includes('#C8C8C8'), 'no content without access');
    assert.equal((await t.post('/api/exercises/style-contrast', { answer: { picks: [1] } })).status, 403);
    assert.equal((await t.get('/api/exercises/nope')).status, 404);
    const first = await (await t.get('/api/exercises/task-prompt')).json();
    assert.equal(first.saved, null); assert.equal(first.exercise.starter, 'Сделай красивый сайт для репетитора.');
    const miss = await (await t.post('/api/exercises/task-prompt', { answer: { text: 'Сделай красивый сайт для репетитора.' } })).json();
    assert.equal(miss.result.passed, false); assert.equal(miss.passed, false);
    const ok = await (await t.post('/api/exercises/task-prompt', { answer: { text: GOOD_PROMPT, extra: 'x'.repeat(50) } })).json();
    assert.equal(ok.result.passed, true); assert.equal(ok.passed, true);
    const worse = await (await t.post('/api/exercises/task-prompt', { answer: { text: 'короткий текст без деталей вообще' } })).json();
    assert.equal(worse.result.passed, false); assert.equal(worse.passed, true, 'a failed retry keeps the passed result');
    const reload = await (await t.get('/api/exercises/task-prompt')).json();
    assert.equal(reload.saved.attempts, 3); assert.equal(reload.saved.passed, true); assert.equal(reload.saved.answer.text, 'короткий текст без деталей вообще');
    assert.ok(!('extra' in reload.saved.answer), 'only known answer fields are stored'); assert.equal(reload.saved.outdated, false);
    t.store.db.prepare("UPDATE exercise_results SET version=0 WHERE exercise_id='task-prompt'").run();
    assert.equal((await (await t.get('/api/exercises/task-prompt')).json()).saved.outdated, true, 'made for an older version');
    assert.equal((await t.post('/api/exercises/page-blocks', { answer: { blocks: ['nope'] } })).status, 400);
    assert.equal((await (await t.get('/api/exercises', 6)).json()).items.find(x => x.id === 'task-prompt').passed, false, 'results are per account');
  } finally { await t.done(); }
});

test('Project: a stage is done only with its lessons and passed exercises; viewing does not count; Pro opens the rest', async () => {
  const t = await setup();
  try {
    let p = await (await t.get('/api/project')).json();
    assert.equal(p.completed, 0); assert.equal(p.current, 0); assert.equal(p.stages.length, 4);
    assert.deepEqual(p.stages.map(s => s.id), ['structure', 'design', 'content', 'publish']);
    await t.get('/api/exercises/task-prompt'); await t.get('/api/exercises/page-blocks'); // opening is not doing
    p = await (await t.get('/api/project')).json(); assert.equal(p.stages[0].ready, 0);
    await t.post('/api/exercises/task-prompt', { answer: { text: GOOD_PROMPT } });
    await t.post('/api/exercises/page-blocks', { answer: { blocks: ['header', 'hero', 'formats', 'contact'] } });
    await t.post('/api/progress', { lessonId: 3 });
    p = await (await t.get('/api/project')).json();
    assert.equal(p.stages[0].done, false, 'lesson 06 is still missing'); assert.equal(p.stages[0].ready, 3); assert.equal(p.stages[0].total, 4);
    assert.equal(p.stages[0].lessons.find(l => l.id === 6).open, false, 'lesson 06 is paid');
    t.store.grantAccess(5);
    await t.post('/api/progress', { lessonId: 6 });
    p = await (await t.get('/api/project')).json();
    assert.equal(p.stages[0].done, true); assert.equal(p.completed, 1); assert.equal(p.current, 1);
    assert.equal((await t.get('/api/exercises/style-contrast')).status, 200, 'Pro opens paid exercises');
    // Lesson exercises do not use the Practicum free launches.
    assert.equal(t.store.practiceUsed(5), 0);
  } finally { await t.done(); }
});
