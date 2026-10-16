import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Append-only list. Never edit a migration that has shipped — add a new one.
 * Each migration runs inside its own transaction at startup.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('guest', 'admin')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX sessions_expires ON sessions(expires_at);

      CREATE TABLE media (
        id TEXT PRIMARY KEY,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE dishes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image_asset_id TEXT REFERENCES media(id),
        category TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        recipe_url TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE restaurants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image_asset_id TEXT REFERENCES media(id),
        cuisine TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        budget_text TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        map_url TEXT,
        note TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
        version INTEGER NOT NULL,
        date TEXT NOT NULL,
        meal_label TEXT NOT NULL,
        local_time TEXT,
        time_zone TEXT NOT NULL,
        instant TEXT,
        mode TEXT NOT NULL CHECK (mode IN ('home', 'restaurant')),
        note TEXT NOT NULL DEFAULT '',
        dishes_json TEXT NOT NULL DEFAULT '[]',
        candidates_json TEXT NOT NULL DEFAULT '[]',
        selected_json TEXT,
        source_plan_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT
      );
      CREATE INDEX plans_date ON plans(date);

      -- Which catalog items a plan references (any version). Used to forbid hard deletes.
      CREATE TABLE plan_refs (
        plan_id TEXT NOT NULL REFERENCES plans(id),
        kind TEXT NOT NULL CHECK (kind IN ('dish', 'restaurant')),
        item_id TEXT NOT NULL,
        PRIMARY KEY (plan_id, kind, item_id)
      );
      CREATE INDEX plan_refs_item ON plan_refs(kind, item_id);

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        plan_version INTEGER NOT NULL,
        event TEXT NOT NULL CHECK (event IN ('created', 'updated', 'cancelled')),
        provider TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'superseded', 'unconfigured')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX notifications_due ON notifications(status, next_attempt_at);
      CREATE INDEX notifications_plan ON notifications(plan_id, created_at);

      CREATE TABLE idempotency_keys (
        key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        status INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: Database.Database): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  const newlyApplied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    })();
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}
