import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { StoreCore } from '../server/store-core.mjs';
import { durableSql } from '../server/durable-sql.mjs';

// Stand-in for ctx.storage.sql: same call shape (exec(query, ...bindings) -> cursor with toArray() and rowsWritten).
// Like the real API it rejects undefined bindings, BEGIN/SAVEPOINT and PRAGMA.
function fakeDurableSql() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  return { exec(query, ...bindings) {
    if (/^\s*(PRAGMA|BEGIN|SAVEPOINT)/im.test(query)) throw new Error('not authorized');
    if (bindings.some(value => value === undefined)) throw new TypeError('undefined binding');
    if (!bindings.length && query.split(';').filter(part => part.trim()).length > 1) { db.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
    const statement = db.prepare(query);
    if (/^\s*(SELECT|WITH)/i.test(query)) return { toArray: () => statement.all(...bindings), rowsWritten: 0 };
    const { changes } = statement.run(...bindings); return { toArray: () => [], rowsWritten: Number(changes) };
  } };
}
test('Durable Object SQLite adapter runs the store: payments, idempotency, refunds, users and stats', () => {
  const sql = fakeDurableSql();
  const store = new StoreCore(durableSql(sql));
  new StoreCore(durableSql(sql)); // a restarted object re-runs the schema on the same data without errors
  const order = store.createOrder(7, 100, 'one_time', null);
  const paid = { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'do-charge' };
  assert.equal(store.recordPayment(8, paid), false);
  assert.equal(store.recordPayment(7, paid), true);
  assert.equal(store.recordPayment(7, paid), true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM payments').get().n, 1);
  assert.equal(store.entitlement(7).active, true);
  store.upsertUser({ id: 7, first_name: 'Читатель' }); store.complete(7, 1);
  assert.equal(store.listUsers({ plan: 'pro' }).total, 1);
  assert.equal(store.stats().pro, 1);
  const external = store.createExternalOrder(9, 'cryptobot', 5, 'USDT');
  store.attachInvoice('cryptobot', 'inv-1', external.id);
  assert.equal(store.recordExternalPayment('cryptobot', 'inv-1', { amount: 5, currency: 'USDT' }), 'new');
  assert.equal(store.recordExternalPayment('cryptobot', 'inv-1', { amount: 5, currency: 'USDT' }), 'duplicate');
  assert.equal(store.revokeAccess(7), 1); assert.equal(store.entitlement(7).active, false);
  assert.equal(store.grantAccess(7), true); assert.equal(store.entitlement(7).active, true);
});
