import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { sendBackup, weeklyBackup } from '../server/backup.mjs';

// Lifetime purchases live in this database, so it must be possible to get it out and back in.
function filled() {
  const store = new Store(':memory:');
  store.upsertUser({ id: 5, first_name: 'Анна', username: 'anna_test' }); store.complete(5, 1); store.setFavorite(5, '001', true);
  const order = store.createOrder(5, 100, 'one_time'); store.recordPayment(5, { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'b1' });
  store.savePromo({ code: 'START20', percent: 20 }); store.saveSettings({ priceStars: 100, discountPercent: 0 }); store.markStep(5, 'subscribed');
  return store;
}
test('A backup restores into an empty database with purchases, progress and settings intact', () => {
  const dump = filled().dump(Date.parse('2026-11-01T10:00:00Z'));
  assert.equal(dump.format, 'vibentry-backup'); assert.equal(dump.tables.payments.length, 1);
  const copy = new Store(':memory:'); copy.restore(dump);
  assert.equal(copy.entitlement(5).active, true); assert.deepEqual(copy.getProgress(5), [1]); assert.equal(copy.promo('START20').percent, 20);
  assert.deepEqual(copy.marks(5).favorites, ['001']); assert.equal(copy.settings().priceStars, 100);
  assert.throws(() => copy.restore({ format: 'something-else', tables: {} }), /not a Vibentry backup/);
});
test('The bot sends the backup as a protected document to admins; weekly, in the daytime, at most once a week', async () => {
  const store = filled(); const uploads = [];
  const telegram = { upload: async (method, form) => { uploads.push({ method, chat: form.get('chat_id'), protect: form.get('protect_content'), file: form.get('document') }); return true; } };
  await sendBackup({ store, telegram, chatIds: [1], now: Date.parse('2026-11-01T10:00:00Z') });
  assert.equal(uploads[0].method, 'sendDocument'); assert.equal(uploads[0].chat, '1'); assert.equal(uploads[0].protect, 'true');
  assert.match(uploads[0].file.name, /^vibentry-backup-2026-11-01\.json$/);
  assert.equal(JSON.parse(await uploads[0].file.text()).tables.users[0].username, 'anna_test');
  const day = Date.parse('2026-11-02T09:00:00Z'); uploads.length = 0;
  assert.equal(await weeklyBackup({ store, telegram, chatIds: [1, 2], now: day }), true); assert.equal(uploads.length, 2);
  assert.equal(await weeklyBackup({ store, telegram, chatIds: [1, 2], now: day + 3 * 86400000 }), false, 'not again within a week');
  assert.equal(await weeklyBackup({ store, telegram, chatIds: [1, 2], now: day + 7 * 86400000 + 12 * 3600000 }), false, 'not at night');
  assert.equal(await weeklyBackup({ store, telegram, chatIds: [], now: day + 8 * 86400000 }), false, 'nobody to send to');
});
test('Admin button sends the backup only to the admin who asked', async () => {
  const TOKEN = 'synthetic-test-token-not-a-credential';
  const signed = id => { const d = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'A' }), query_id: 't' }); d.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update([...d].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex')); return d.toString(); };
  const old = { ...process.env }; Object.assign(process.env, { BOT_TOKEN: TOKEN, NODE_ENV: 'test', ADMIN_IDS: '1' });
  const store = filled(); const chats = [];
  const server = createApp({ store, telegram: { isMember: async () => true, api: async () => true, upload: async (m, form) => { chats.push(form.get('chat_id')); return true; } }, content: {} });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const post = id => fetch(base + '/api/admin/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: signed(id) }) });
  try { assert.equal((await post(5)).status, 403); assert.equal((await post(1)).status, 200); assert.deepEqual(chats, ['1']); }
  finally { await new Promise(r => server.close(r)); store.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
test('restore-backup script: refuses a non-empty database without --force', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibentry-restore-')); const file = path.join(dir, 'b.json'); const db = path.join(dir, 'db.sqlite');
  try {
    writeFileSync(file, JSON.stringify(filled().dump()));
    const run = (...args) => spawnSync(process.execPath, ['scripts/restore-backup.mjs', file, db, ...args], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.notEqual(run().status, 0, 'second time the database is not empty');
    assert.equal(run('--force').status, 0);
    const restored = new Store(db); assert.equal(restored.entitlement(5).active, true); restored.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
