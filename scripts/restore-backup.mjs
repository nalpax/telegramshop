// Restores a Vibentry backup (the JSON file the bot sends to admins) into a SQLite database on a server.
//   node scripts/restore-backup.mjs vibentry-backup-2026-11-01.json [./var/vibentry.sqlite] [--force]
// Refuses to overwrite a database that already has participants or payments unless --force is given.
import { readFileSync } from 'node:fs';
import { Store } from '../server/store.mjs';
const args = process.argv.slice(2); const force = args.includes('--force'); const [file, dbPath] = args.filter(a => a !== '--force');
if (!file) { console.error('Usage: node scripts/restore-backup.mjs <backup.json> [database path] [--force]'); process.exit(1); }
const backup = JSON.parse(readFileSync(file, 'utf8'));
const store = new Store(dbPath || process.env.DATABASE_PATH || './var/vibentry.sqlite');
if (!store.isEmpty() && !force) { console.error('The database is not empty. Stop the server, make a copy of it and run again with --force.'); process.exit(2); }
store.db.exec('BEGIN');
try { store.restore(backup); store.db.exec('COMMIT'); } catch (error) { store.db.exec('ROLLBACK'); console.error('Restore failed: ' + error.message); process.exit(3); }
console.log(`Restored backup from ${backup.createdAt}: ${backup.tables.users.length} participants, ${backup.tables.payments.length} payments.`);
store.close();
