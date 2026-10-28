import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(filename = process.env.DATABASE_PATH || './var/vibentry.sqlite') {
    if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, stars INTEGER NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), user_id INTEGER NOT NULL, stars INTEGER NOT NULL, expires_at INTEGER, paid_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS progress (user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, completed_at INTEGER NOT NULL, PRIMARY KEY(user_id,lesson_id));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS refunds (charge_id TEXT PRIMARY KEY, refunded_at INTEGER NOT NULL);`);
  }
  createOrder(userId, stars, mode) { const id = randomUUID(); this.db.prepare('INSERT INTO orders VALUES (?,?,?,?,?)').run(id, userId, stars, mode, Date.now()); return this.order(id); }
  order(id) { return this.db.prepare('SELECT * FROM orders WHERE id=?').get(id) || null; }
  entitlement(userId, now = Math.floor(Date.now() / 1000)) {
    const payment = this.db.prepare('SELECT * FROM payments WHERE user_id=? AND charge_id NOT IN (SELECT charge_id FROM refunds) AND (expires_at IS NULL OR expires_at>?) ORDER BY expires_at IS NULL DESC, expires_at DESC LIMIT 1').get(userId, now);
    return payment ? { active: true, expiresAt: payment.expires_at ?? null } : { active: false, expiresAt: null };
  }
  recordPayment(userId, payment, now = Math.floor(Date.now() / 1000)) {
    const order = this.order(payment?.invoice_payload);
    if (!order || order.user_id !== userId || payment.currency !== 'XTR' || payment.total_amount !== order.stars || typeof payment.telegram_payment_charge_id !== 'string' || !payment.telegram_payment_charge_id) return false;
    const expiry = order.mode === 'subscription' ? payment.subscription_expiration_date : null;
    if (order.mode === 'subscription' && (!payment.is_recurring || !Number.isSafeInteger(expiry) || expiry <= now)) return false;
    // Idempotency: Telegram may deliver the same update again after a restart.
    this.db.prepare('INSERT OR IGNORE INTO payments VALUES (?,?,?,?,?,?)').run(payment.telegram_payment_charge_id, order.id, userId, order.stars, expiry, now);
    return true;
  }
  getProgress(userId) { return this.db.prepare('SELECT lesson_id FROM progress WHERE user_id=? ORDER BY lesson_id').all(userId).map(r => r.lesson_id); }
  complete(userId, lesson) { this.db.prepare('INSERT OR IGNORE INTO progress VALUES (?,?,?)').run(userId, lesson, Date.now()); }
  reset(userId) { this.db.prepare('DELETE FROM progress WHERE user_id=?').run(userId); }
  refund(chargeId) { if (typeof chargeId === 'string') this.db.prepare('INSERT OR IGNORE INTO refunds VALUES (?,?)').run(chargeId, Date.now()); }
  settings() { try { return JSON.parse(this.db.prepare("SELECT value FROM settings WHERE key='offer'").get()?.value || '{}'); } catch { return {}; } }
  saveSettings(value) { this.db.prepare("INSERT INTO settings VALUES ('offer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value)); }
  close() { this.db.close(); }
}
