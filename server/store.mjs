import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { StoreCore } from './store-core.mjs';

function open(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  return db;
}
// Node host: one SQLite file shared by `npm start` and `npm run bot`.
export class Store extends StoreCore {
  constructor(filename = process.env.DATABASE_PATH || './var/vibentry.sqlite') { super(open(filename)); }
}
