import { randomUUID } from 'node:crypto';

// Platform-neutral store. `db` is anything with exec(sql) and prepare(sql).get/all/run(...args) -> {changes}:
// node:sqlite on a server (server/store.mjs), Durable Object SQLite on Cloudflare (server/durable-sql.mjs).
// Every table with data worth keeping, parents before children (orders before payments and invoices).
export const BACKUP_TABLES = ['users', 'orders', 'payments', 'refunds', 'provider_invoices', 'progress', 'settings', 'promo_codes', 'audit', 'favorites', 'task_checks', 'events', 'exercise_results'];
export const FAVORITE_KINDS = ['prompt', 'lesson', 'article', 'resource'];
export const FAVORITES_LIMIT = 200;
const FAVORITES_COLUMNS = 'user_id INTEGER NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, kind, item_id)';
// Funnel events (admin «Воронка»). Only a numeric user id, a type and a short meta — no names or texts.
export const EVENT_TYPES = ['app_open', 'lesson_open', 'lesson_done', 'paywall_view', 'checkout_start', 'paid', 'promo_applied'];
// Kept at most once per 24 hours per user (and per meta for lesson_open), so reopening the app does not inflate the numbers.
const DAILY_EVENTS = ['app_open', 'paywall_view', 'lesson_open', 'promo_applied'];
export class StoreCore {
  constructor(db) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, stars INTEGER NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), user_id INTEGER NOT NULL, stars INTEGER NOT NULL, expires_at INTEGER, paid_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS progress (user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, completed_at INTEGER NOT NULL, PRIMARY KEY(user_id,lesson_id));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS refunds (charge_id TEXT PRIMARY KEY, refunded_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, username TEXT, language TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS promo_codes (code TEXT PRIMARY KEY, percent INTEGER NOT NULL, max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, expires_at TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);`);
    // No PRAGMA here: Durable Objects do not allow every PRAGMA. An existing column is reported as "duplicate column".
    const addColumn = (table, column, ddl) => { try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`); } catch (error) { if (!/duplicate column/i.test(String(error?.message))) throw error; } };
    addColumn('orders', 'promo', 'TEXT'); addColumn('orders', 'provider', "TEXT NOT NULL DEFAULT 'stars'"); addColumn('orders', 'currency', 'TEXT'); addColumn('orders', 'amount', 'REAL');
    addColumn('users', 'reminders_off', 'INTEGER NOT NULL DEFAULT 0'); addColumn('users', 'practice_used', 'INTEGER NOT NULL DEFAULT 0'); addColumn('users', 'goal', 'TEXT'); addColumn('users', 'experience', 'TEXT');
    addColumn('users', 'offers_off', 'INTEGER NOT NULL DEFAULT 0'); addColumn('users', 'offer_count', 'INTEGER NOT NULL DEFAULT 0'); addColumn('users', 'last_offer_at', 'INTEGER'); addColumn('users', 'after_free_at', 'INTEGER');
    addColumn('promo_codes', 'user_id', 'INTEGER'); addColumn('promo_codes', 'nudged', 'INTEGER NOT NULL DEFAULT 0'); addColumn('users', 'reminded_at', 'INTEGER');
    addColumn('payments', 'provider', "TEXT NOT NULL DEFAULT 'stars'"); addColumn('payments', 'amount', 'REAL'); addColumn('payments', 'currency', 'TEXT');
    // v1.1: bookmarks of any kind (prompt, lesson, article). Before that the table held prompt ids only; move them over once.
    let legacyFavorites = false; try { this.db.prepare('SELECT prompt_id FROM favorites LIMIT 0').all(); legacyFavorites = true; } catch {}
    if (legacyFavorites) this.db.exec(`ALTER TABLE favorites RENAME TO favorites_v0;
      CREATE TABLE favorites (${FAVORITES_COLUMNS});
      INSERT OR IGNORE INTO favorites SELECT user_id, 'prompt', prompt_id, created_at FROM favorites_v0;
      DROP TABLE favorites_v0;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS favorites (${FAVORITES_COLUMNS});
      CREATE TABLE IF NOT EXISTS task_checks (user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, item INTEGER NOT NULL, PRIMARY KEY(user_id, lesson_id, item));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, meta TEXT, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_type_at ON events(type, at);
      CREATE INDEX IF NOT EXISTS events_user_type ON events(user_id, type);`);
    // v1.0 kept only the first time per step (funnel_events). Move what maps onto the new types, rebuild lesson_done and paid
    // from progress and payments, then drop the old table. Runs once.
    let legacyFunnel = false; try { this.db.prepare('SELECT step FROM funnel_events LIMIT 0').all(); legacyFunnel = true; } catch {}
    if (legacyFunnel) this.db.exec(`INSERT INTO events (user_id, type, meta, at) SELECT user_id, CASE step WHEN 'tariff_open' THEN 'paywall_view' ELSE 'checkout_start' END, NULL, at FROM funnel_events WHERE step IN ('tariff_open', 'pay_click');
      INSERT INTO events (user_id, type, meta, at) SELECT user_id, 'lesson_done', CAST(lesson_id AS TEXT), completed_at FROM progress;
      INSERT INTO events (user_id, type, meta, at) SELECT user_id, 'paid', provider, paid_at * 1000 FROM payments WHERE provider != 'manual';
      DROP TABLE funnel_events;`);
    // Lesson exercises (server/exercises.mjs): the last answer and its check, the version of the exercise it was made for,
    // and whether it was ever passed (a later failed retry does not take a passed result away).
    this.db.exec('CREATE TABLE IF NOT EXISTS exercise_results (user_id INTEGER NOT NULL, exercise_id TEXT NOT NULL, version INTEGER NOT NULL, answer TEXT NOT NULL, result TEXT NOT NULL, passed INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, exercise_id))');
    this.db.exec("CREATE TABLE IF NOT EXISTS provider_invoices (provider TEXT NOT NULL, external_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id), created_at INTEGER NOT NULL, PRIMARY KEY(provider, external_id))");
  }
  createOrder(userId, stars, mode, promo = null) { const id = randomUUID(); this.db.prepare('INSERT INTO orders (id,user_id,stars,mode,created_at,promo) VALUES (?,?,?,?,?,?)').run(id, userId, stars, mode, Date.now(), promo); return this.order(id); }
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
    const inserted = this.db.prepare("INSERT OR IGNORE INTO payments (charge_id,order_id,user_id,stars,expires_at,paid_at,provider,amount,currency) VALUES (?,?,?,?,?,?,'stars',?,'XTR')").run(payment.telegram_payment_charge_id, order.id, userId, order.stars, expiry, now, order.stars).changes;
    if (inserted && order.promo) this.db.prepare('UPDATE promo_codes SET used = used + 1 WHERE code = ?').run(order.promo);
    if (inserted) this.addEvent(userId, 'paid', 'stars', now * 1000);
    return true;
  }
  // ---- external providers (Platega, CryptoBot, xRocket) ----
  createExternalOrder(userId, provider, amount, currency, promo = null) {
    const id = randomUUID();
    this.db.prepare("INSERT INTO orders (id,user_id,stars,mode,created_at,promo,provider,currency,amount) VALUES (?,?,0,'one_time',?,?,?,?,?)").run(id, userId, Date.now(), promo, provider, currency, amount);
    return this.order(id);
  }
  attachInvoice(provider, externalId, orderId) { this.db.prepare('INSERT OR IGNORE INTO provider_invoices VALUES (?,?,?,?)').run(provider, String(externalId), orderId, Date.now()); }
  orderByInvoice(provider, externalId) { return this.db.prepare('SELECT o.* FROM provider_invoices i JOIN orders o ON o.id=i.order_id WHERE i.provider=? AND i.external_id=?').get(provider, String(externalId)) || null; }
  invoiceForOrder(orderId) { return this.db.prepare('SELECT * FROM provider_invoices WHERE order_id=?').get(orderId) || null; }
  orderPaid(orderId) { return !!this.db.prepare('SELECT 1 FROM payments WHERE order_id=?').get(orderId); }
  // Called only after the provider itself confirmed the payment. Amount and currency must match what we asked for.
  recordExternalPayment(provider, externalId, { amount, currency } = {}, now = Math.floor(Date.now() / 1000)) {
    const order = this.orderByInvoice(provider, externalId);
    if (!order || order.provider !== provider || order.currency !== currency || !Number.isFinite(amount) || Math.abs(amount - order.amount) > 0.005) return false;
    const inserted = this.db.prepare('INSERT OR IGNORE INTO payments (charge_id,order_id,user_id,stars,expires_at,paid_at,provider,amount,currency) VALUES (?,?,?,0,NULL,?,?,?,?)').run(`${provider}:${externalId}`, order.id, order.user_id, now, provider, order.amount, order.currency).changes;
    if (inserted && order.promo) this.db.prepare('UPDATE promo_codes SET used = used + 1 WHERE code = ?').run(order.promo);
    if (inserted) this.addEvent(order.user_id, 'paid', provider, now * 1000);
    return inserted ? 'new' : 'duplicate';
  }
  providerState() { try { return JSON.parse(this.db.prepare("SELECT value FROM settings WHERE key='providers'").get()?.value || '{}'); } catch { return {}; } }
  saveProviderState(state) { this.db.prepare("INSERT INTO settings VALUES ('providers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(state)); }
  getProgress(userId) { return this.db.prepare('SELECT lesson_id FROM progress WHERE user_id=? ORDER BY lesson_id').all(userId).map(r => r.lesson_id); }
  complete(userId, lesson, now = Date.now()) { if (this.db.prepare('INSERT OR IGNORE INTO progress VALUES (?,?,?)').run(userId, lesson, now).changes) this.addEvent(userId, 'lesson_done', String(lesson), now); }
  reset(userId) { this.db.prepare('DELETE FROM progress WHERE user_id=?').run(userId); this.db.prepare('DELETE FROM task_checks WHERE user_id=?').run(userId); }
  // ---- reminders: one message after a quiet pause (server/bot-core.mjs sendReminders) ----
  reminderCandidates() {
    return this.db.prepare(`SELECT u.id, u.last_seen, u.reminded_at, (SELECT MAX(completed_at) FROM progress p WHERE p.user_id=u.id) AS last_done
      FROM users u WHERE u.reminders_off=0 AND EXISTS(SELECT 1 FROM progress p WHERE p.user_id=u.id)`).all();
  }
  markReminded(userId, now = Date.now()) { this.db.prepare('UPDATE users SET reminded_at=? WHERE id=?').run(now, userId); }
  setReminders(userId, on) { this.db.prepare('UPDATE users SET reminders_off=? WHERE id=?').run(on ? 0 : 1, userId); }
  remindersOn(userId) { return !this.db.prepare('SELECT reminders_off FROM users WHERE id=?').get(userId)?.reminders_off; }
  // ---- first-visit questions (public/js/onboarding.js) ----
  onboarding(userId) { const r = this.db.prepare('SELECT goal, experience FROM users WHERE id=?').get(userId); return r?.goal ? { goal: r.goal, experience: r.experience } : null; }
  setOnboarding(userId, goal, experience) { this.db.prepare('UPDATE users SET goal=?, experience=? WHERE id=?').run(goal, experience, userId); }
  // ---- backup (server/backup.mjs, scripts/restore-backup.mjs) ----
  dump(now = Date.now()) { return { format: 'vibentry-backup', version: 1, createdAt: new Date(now).toISOString(), tables: Object.fromEntries(BACKUP_TABLES.map(t => [t, this.db.prepare(`SELECT * FROM ${t}`).all()])) }; }
  isEmpty() { return !this.db.prepare('SELECT 1 FROM users LIMIT 1').get() && !this.db.prepare('SELECT 1 FROM payments LIMIT 1').get(); }
  // Replaces everything with the backup. Used by the restore script on a server; wrap it in a transaction there.
  restore(backup) {
    if (backup?.format !== 'vibentry-backup' || typeof backup.tables !== 'object') throw new Error('This is not a Vibentry backup');
    for (const table of [...BACKUP_TABLES].reverse()) this.db.prepare(`DELETE FROM ${table}`).run();
    for (const table of BACKUP_TABLES) for (let row of backup.tables[table] || []) {
      if (table === 'favorites' && row.prompt_id) row = { user_id: row.user_id, kind: 'prompt', item_id: row.prompt_id, created_at: row.created_at }; // backup made before v1.1
      const columns = Object.keys(row).filter(c => /^[a-z_]+$/.test(c));
      this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(c => row[c]));
    }
  }
  lastBackupAt() { return Number(this.db.prepare("SELECT value FROM settings WHERE key='last_backup_at'").get()?.value) || 0; }
  setLastBackupAt(now) { this.db.prepare("INSERT INTO settings VALUES ('last_backup_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now)); }
  // ---- system check (admin «Проверка системы») ----
  markWebhookSeen(provider, now = Date.now()) { this.db.prepare("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('webhook_seen_' + provider, String(now)); }
  webhookSeen(provider) { return Number(this.db.prepare('SELECT value FROM settings WHERE key=?').get('webhook_seen_' + provider)?.value) || 0; }
  probeWrite(now = Date.now()) { this.db.prepare("INSERT INTO settings VALUES ('health_probe',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now)); return Number(this.db.prepare("SELECT value FROM settings WHERE key='health_probe'").get()?.value) === now; }
  lastPaidAt() { return this.db.prepare("SELECT MAX(paid_at) AS at FROM payments WHERE provider != 'manual' AND charge_id NOT IN (SELECT charge_id FROM refunds)").get()?.at || 0; }
  // ---- lesson exercises ----
  exerciseResults(userId) {
    const parse = v => { try { return JSON.parse(v); } catch { return null; } };
    return new Map(this.db.prepare('SELECT * FROM exercise_results WHERE user_id=?').all(userId).map(r => [r.exercise_id, { version: r.version, answer: parse(r.answer), result: parse(r.result), passed: !!r.passed, attempts: r.attempts, updatedAt: r.updated_at }]));
  }
  saveExerciseResult(userId, exerciseId, version, answer, result, now = Date.now()) {
    this.db.prepare(`INSERT INTO exercise_results (user_id, exercise_id, version, answer, result, passed, attempts, updated_at) VALUES (?,?,?,?,?,?,1,?)
      ON CONFLICT(user_id, exercise_id) DO UPDATE SET version=excluded.version, answer=excluded.answer, result=excluded.result, passed=MAX(passed, excluded.passed), attempts=attempts+1, updated_at=excluded.updated_at`).run(userId, exerciseId, version, JSON.stringify(answer), JSON.stringify(result), result.passed ? 1 : 0, now);
  }
  // ---- funnel events ----
  addEvent(userId, type, meta = null, now = Date.now()) {
    if (!EVENT_TYPES.includes(type) || !Number.isSafeInteger(userId)) return false;
    meta = meta == null ? null : String(meta).slice(0, 32);
    if (DAILY_EVENTS.includes(type) && this.db.prepare('SELECT 1 FROM events WHERE user_id=? AND type=? AND meta IS ? AND at > ? LIMIT 1').get(userId, type, meta, now - 86400000)) return false;
    this.db.prepare('INSERT INTO events (user_id, type, meta, at) VALUES (?,?,?,?)').run(userId, type, meta, now);
    return true;
  }
  // Unique people per step since `since` (ms). Administrators are left out: the owner tests the app all the time.
  funnel(since = 0, exclude = []) {
    const ids = exclude.filter(Number.isSafeInteger).join(',') || '0';
    const people = (type, meta) => this.db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE type=? ${meta == null ? '' : 'AND meta=?'} AND at>=? AND user_id NOT IN (${ids})`).get(...[type, meta, since].filter(v => v != null)).n;
    const steps = { app_open: people('app_open'), lesson1_open: people('lesson_open', '1'), lesson1_done: people('lesson_done', '1'), paywall_view: people('paywall_view'), checkout_start: people('checkout_start'), paid: people('paid') };
    const lessons = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, opened: 0, done: 0 }));
    for (const r of this.db.prepare(`SELECT meta, type, COUNT(DISTINCT user_id) AS n FROM events WHERE type IN ('lesson_open','lesson_done') AND at>=? AND user_id NOT IN (${ids}) GROUP BY meta, type`).all(since)) {
      const row = lessons[Number(r.meta) - 1]; if (row) row[r.type === 'lesson_open' ? 'opened' : 'done'] = r.n;
    }
    const paidSince = Math.floor(since / 1000); const active = 'y.charge_id NOT IN (SELECT charge_id FROM refunds)';
    const methods = this.db.prepare(`SELECT y.provider AS provider, y.currency AS currency, COUNT(*) AS n, ROUND(COALESCE(SUM(y.amount),0),2) AS total FROM payments y WHERE y.provider != 'manual' AND ${active} AND y.paid_at >= ? AND y.user_id NOT IN (${ids}) GROUP BY y.provider, y.currency ORDER BY n DESC`).all(paidSince).map(r => ({ ...r }));
    const applied = new Map(this.db.prepare(`SELECT meta, COUNT(DISTINCT user_id) AS n FROM events WHERE type='promo_applied' AND at>=? AND user_id NOT IN (${ids}) GROUP BY meta`).all(since).map(r => [r.meta, r.n]));
    const paidWith = new Map(this.db.prepare(`SELECT o.promo AS code, COUNT(*) AS n FROM payments y JOIN orders o ON o.id=y.order_id WHERE o.promo IS NOT NULL AND y.provider != 'manual' AND ${active} AND y.paid_at >= ? AND y.user_id NOT IN (${ids}) GROUP BY o.promo`).all(paidSince).map(r => [r.code, r.n]));
    const promos = [...new Set([...applied.keys(), ...paidWith.keys()])].sort().map(code => ({ code, applied: applied.get(code) || 0, paid: paidWith.get(code) || 0 }));
    return { steps, lessons, methods, promos };
  }
  // ---- automatic offers (server/offers.mjs) ----
  offerSettings() { try { return JSON.parse(this.db.prepare("SELECT value FROM settings WHERE key='auto_offers'").get()?.value || '{}'); } catch { return {}; } }
  saveOfferSettings(value) { this.db.prepare("INSERT INTO settings VALUES ('auto_offers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value)); }
  setOffers(userId, on) { this.db.prepare('UPDATE users SET offers_off=? WHERE id=?').run(on ? 0 : 1, userId); }
  offersOn(userId) { return !this.db.prepare('SELECT offers_off FROM users WHERE id=?').get(userId)?.offers_off; }
  offerCandidates() { return this.db.prepare(`SELECT id, first_seen, last_seen, offer_count, last_offer_at, after_free_at FROM users WHERE offers_off=0 AND id NOT IN (SELECT user_id FROM payments WHERE charge_id NOT IN (SELECT charge_id FROM refunds))`).all(); }
  addPersonalPromo(code, percent, expiresAt, userId, now = Date.now()) { this.db.prepare('INSERT INTO promo_codes (code,percent,max_uses,expires_at,active,created_at,user_id) VALUES (?,?,1,?,1,?,?)').run(code, percent, expiresAt, now, userId); }
  markOffered(userId, now) { this.db.prepare('UPDATE users SET offer_count = offer_count + 1, last_offer_at=? WHERE id=?').run(now, userId); }
  markAfterFree(userId, now) { this.db.prepare('UPDATE users SET after_free_at=? WHERE id=?').run(now, userId); }
  activePersonalPromo(userId, now = Date.now()) { return this.db.prepare('SELECT * FROM promo_codes WHERE user_id=? AND active=1 AND used=0 ORDER BY created_at DESC').all(userId).find(p => Date.parse(p.expires_at) > now) || null; }
  promosToNudge() { return this.db.prepare('SELECT * FROM promo_codes WHERE user_id IS NOT NULL AND active=1 AND used=0 AND nudged=0').all(); }
  markNudged(code) { this.db.prepare('UPDATE promo_codes SET nudged=1 WHERE code=?').run(code); }
  offerStats() { const r = this.db.prepare('SELECT COUNT(*) AS sent, COALESCE(SUM(used),0) AS used FROM promo_codes WHERE user_id IS NOT NULL').get(); return { sent: r.sent, used: r.used }; }
  // ---- «Практикум» launches of a free account ----
  practiceUsed(userId) { return this.db.prepare('SELECT practice_used FROM users WHERE id=?').get(userId)?.practice_used || 0; }
  usePractice(userId) { this.db.prepare('UPDATE users SET practice_used = practice_used + 1 WHERE id=?').run(userId); }
  // ---- favourite prompts and ticked checklist items in lessons ----
  marks(userId) {
    const favorites = this.db.prepare("SELECT item_id FROM favorites WHERE user_id=? AND kind='prompt' ORDER BY item_id").all(userId).map(r => r.item_id);
    const tasks = {};
    for (const r of this.db.prepare('SELECT lesson_id, item FROM task_checks WHERE user_id=? ORDER BY lesson_id, item').all(userId)) (tasks[r.lesson_id] ||= []).push(r.item);
    return { favorites, tasks };
  }
  favorites(userId) { return this.db.prepare('SELECT kind, item_id, created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC, item_id').all(userId); }
  // 'added' | 'exists' | 'limit'
  addFavorite(userId, kind, itemId, now = Date.now()) {
    if (this.db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND kind=? AND item_id=?').get(userId, kind, itemId)) return 'exists';
    if (this.db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=?').get(userId).n >= FAVORITES_LIMIT) return 'limit';
    this.db.prepare('INSERT OR IGNORE INTO favorites VALUES (?,?,?,?)').run(userId, kind, itemId, now);
    return 'added';
  }
  removeFavorite(userId, kind, itemId) { this.db.prepare('DELETE FROM favorites WHERE user_id=? AND kind=? AND item_id=?').run(userId, kind, itemId); }
  setFavorite(userId, promptId, on) { if (on) this.addFavorite(userId, 'prompt', promptId); else this.removeFavorite(userId, 'prompt', promptId); }
  setTask(userId, lessonId, item, on) { if (on) this.db.prepare('INSERT OR IGNORE INTO task_checks VALUES (?,?,?)').run(userId, lessonId, item); else this.db.prepare('DELETE FROM task_checks WHERE user_id=? AND lesson_id=? AND item=?').run(userId, lessonId, item); }
  refund(chargeId) { if (typeof chargeId === 'string') this.db.prepare('INSERT OR IGNORE INTO refunds VALUES (?,?)').run(chargeId, Date.now()); }
  settings() { try { return JSON.parse(this.db.prepare("SELECT value FROM settings WHERE key='offer'").get()?.value || '{}'); } catch { return {}; } }
  saveSettings(value) { this.db.prepare("INSERT INTO settings VALUES ('offer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value)); }
  // ---- participants ----
  upsertUser(user, now = Date.now()) {
    if (!user || !Number.isSafeInteger(user.id)) return;
    const clip = value => (typeof value === 'string' ? value.slice(0, 128) : null);
    this.db.prepare(`INSERT INTO users (id,first_name,last_name,username,language,first_seen,last_seen) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,username=excluded.username,language=excluded.language,last_seen=excluded.last_seen`)
      .run(user.id, clip(user.first_name), clip(user.last_name), clip(user.username), clip(user.language_code), now, now);
  }
  userRow(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) || null; }
  listUsers({ q = '', plan = 'all', limit = 25, offset = 0 } = {}) {
    const like = `%${String(q).trim().replace(/[%_\\]/g, '')}%`;
    const base = `SELECT u.*, (SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id) AS done,
      (SELECT COALESCE(SUM(stars),0) FROM payments y WHERE y.user_id=u.id AND y.charge_id NOT IN (SELECT charge_id FROM refunds)) AS stars,
      EXISTS(SELECT 1 FROM payments y WHERE y.user_id=u.id AND y.charge_id NOT IN (SELECT charge_id FROM refunds)) AS pro FROM users u
      WHERE (? = '%%' OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?)`;
    const filtered = `SELECT * FROM (${base}) WHERE (? = 'all' OR (? = 'pro' AND pro = 1) OR (? = 'free' AND pro = 0))`;
    const args = [like, like, like, like, like, plan, plan, plan];
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM (${filtered})`).get(...args).n;
    const items = this.db.prepare(`${filtered} ORDER BY last_seen DESC LIMIT ? OFFSET ?`).all(...args, Math.min(100, limit), Math.max(0, offset));
    return { total, items };
  }
  userPayments(userId) {
    return this.db.prepare('SELECT y.charge_id, y.stars, y.provider, y.amount, y.currency, y.paid_at, o.promo, (SELECT 1 FROM refunds r WHERE r.charge_id=y.charge_id) AS refunded FROM payments y JOIN orders o ON o.id=y.order_id WHERE y.user_id=? ORDER BY y.paid_at DESC').all(userId);
  }
  grantAccess(userId, now = Math.floor(Date.now() / 1000)) {
    if (this.entitlement(userId, now).active) return false;
    const order = this.createOrder(userId, 0, 'manual');
    this.db.prepare("INSERT INTO payments (charge_id,order_id,user_id,stars,expires_at,paid_at,provider) VALUES (?,?,?,0,NULL,?,'manual')").run(`manual-${randomUUID()}`, order.id, userId, now);
    return true;
  }
  revokeAccess(userId) {
    const rows = this.db.prepare('SELECT charge_id FROM payments WHERE user_id=? AND charge_id NOT IN (SELECT charge_id FROM refunds)').all(userId);
    for (const row of rows) this.refund(row.charge_id);
    return rows.length;
  }
  activeStarCharges(userId) { return this.db.prepare("SELECT charge_id FROM payments WHERE user_id=? AND provider='stars' AND charge_id NOT IN (SELECT charge_id FROM refunds)").all(userId).map(r => r.charge_id); }
  payment(chargeId) { return this.db.prepare('SELECT * FROM payments WHERE charge_id=?').get(chargeId) || null; }
  stats(now = Date.now()) {
    const one = (sql, ...a) => this.db.prepare(sql).get(...a);
    const active = "charge_id NOT IN (SELECT charge_id FROM refunds)";
    const day = 86400000; const since = now - 13 * day;
    const start = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() - 13 * day;
    const bucket = ms => Math.floor((ms - start) / day);
    const joined = Array(14).fill(0); const paid = Array(14).fill(0);
    for (const r of this.db.prepare('SELECT first_seen FROM users WHERE first_seen >= ?').all(start)) { const i = bucket(r.first_seen); if (i >= 0 && i < 14) joined[i]++; }
    for (const r of this.db.prepare(`SELECT paid_at FROM payments WHERE ${active} AND provider != 'manual' AND paid_at >= ?`).all(Math.floor(start / 1000))) { const i = bucket(r.paid_at * 1000); if (i >= 0 && i < 14) paid[i]++; }
    const users = one('SELECT COUNT(*) AS n FROM users').n;
    const pro = one(`SELECT COUNT(DISTINCT user_id) AS n FROM payments WHERE ${active}`).n;
    return { users, pro, free: Math.max(0, users - pro), revenue: one(`SELECT COALESCE(SUM(stars),0) AS n FROM payments WHERE ${active}`).n, revenueBy: this.db.prepare(`SELECT currency, ROUND(SUM(amount),2) AS total, COUNT(*) AS n FROM payments WHERE ${active} AND currency IS NOT NULL GROUP BY currency`).all().map(r => ({ currency: r.currency, total: r.total, n: r.n })), refunds: one('SELECT COUNT(*) AS n FROM refunds').n, new7: one('SELECT COUNT(*) AS n FROM users WHERE first_seen >= ?', now - 7 * day).n, conversion: users ? Math.round(pro / users * 1000) / 10 : 0, daily: { start, joined, paid } };
  }
  // ---- channels, promo codes, audit ----
  channels() { try { const v = JSON.parse(this.db.prepare("SELECT value FROM settings WHERE key='channels'").get()?.value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  saveChannels(list) { this.db.prepare("INSERT INTO settings VALUES ('channels',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(list)); }
  // General codes made in the admin panel; personal codes from automatic offers (user_id set) are listed separately.
  promos() { return this.db.prepare('SELECT * FROM promo_codes WHERE user_id IS NULL ORDER BY created_at DESC').all(); }
  promo(code) { return this.db.prepare('SELECT * FROM promo_codes WHERE code=?').get(String(code || '').trim().toUpperCase()) || null; }
  savePromo({ code, percent, maxUses = null, expiresAt = null, active = 1 }) {
    this.db.prepare(`INSERT INTO promo_codes (code,percent,max_uses,expires_at,active,created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(code) DO UPDATE SET percent=excluded.percent,max_uses=excluded.max_uses,expires_at=excluded.expires_at,active=excluded.active`)
      .run(code, percent, maxUses, expiresAt, active ? 1 : 0, Date.now());
  }
  deletePromo(code) { this.db.prepare('DELETE FROM promo_codes WHERE code=?').run(code); }
  log(adminId, action, detail = '') { this.db.prepare('INSERT INTO audit (admin_id,action,detail,at) VALUES (?,?,?,?)').run(adminId, action, String(detail).slice(0, 500), Date.now()); }
  auditLog(limit = 60) { return this.db.prepare('SELECT a.*, u.first_name, u.username FROM audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT ?').all(limit); }
  close() { this.db.close(); }
}
