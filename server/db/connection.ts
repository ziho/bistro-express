import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';

export type DB = Database.Database;

export function openDatabase(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.accessSync(dataDir, fs.constants.W_OK);
  const db = new Database(path.join(dataDir, 'bistro.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return db;
}
