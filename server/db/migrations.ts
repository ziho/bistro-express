import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { legacySections } from '../../shared/dish.js';
import { legacyLink, splitTags } from '../../shared/restaurant.js';

interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Optional data step, run after `sql` inside the same transaction. */
  up?: (db: Database.Database) => void;
}

/** Label given to the device translated from the old single-key Bark settings. */
export const LEGACY_DEVICE_LABEL = '原设备（旧版单设备设置）';

/**
 * Moves a legacy `notify.bark.deviceKey` into `bark_devices` so nothing is silently lost, then
 * removes it from the settings JSON so there is a single source of truth. Invalid JSON is left
 * untouched (the app falls back to defaults for it, exactly as before).
 */
function migrateLegacyBarkKey(db: Database.Database): void {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'notify.bark'`).get() as { value: string } | undefined;
  if (!row) return;
  let stored: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    stored = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  const key = typeof stored.deviceKey === 'string' ? stored.deviceKey.trim() : '';
  const ts = new Date().toISOString();
  if (key) {
    db.prepare(
      `INSERT INTO bark_devices (id, label, device_key, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(randomUUID(), LEGACY_DEVICE_LABEL, key, ts, ts);
  }
  if ('deviceKey' in stored) {
    const rest = Object.fromEntries(Object.entries(stored).filter(([k]) => k !== 'deviceKey'));
    db.prepare(`UPDATE settings SET value = ?, updated_at = ? WHERE key = 'notify.bark'`).run(JSON.stringify(rest), ts);
  }
}

function parseTagArray(raw: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Adds review/link columns and merges each restaurant's legacy cuisine into its tags.
 * The cuisine column itself is kept (no table rewrite) but is no longer read by the app.
 * Safe to run more than once: columns are only added when missing and the merge never
 * duplicates a tag. Existing tags are all kept, even when that exceeds the tag limit.
 */
export function migrateRestaurantClassification(db: Database.Database): void {
  addColumnIfMissing(db, 'restaurants', 'review', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'restaurants', 'link_url', 'TEXT');
  addColumnIfMissing(db, 'restaurants', 'link_label', `TEXT NOT NULL DEFAULT ''`);

  const rows = db.prepare(`SELECT id, cuisine, tags FROM restaurants WHERE TRIM(cuisine) <> ''`).all() as {
    id: string;
    cuisine: string;
    tags: string;
  }[];
  const update = db.prepare('UPDATE restaurants SET tags = ? WHERE id = ?');
  for (const row of rows) {
    const existing = parseTagArray(row.tags);
    // Unreadable tags are left exactly as they are; the cuisine column still holds the value.
    if (!existing) continue;
    const missing = splitTags(row.cuisine).filter((t) => !existing.includes(t));
    if (missing.length) update.run(JSON.stringify([...missing, ...existing]), row.id);
  }
}

/**
 * Adds `links_json` (the restaurant's list of external links) and copies each legacy single
 * link_url/link_label into it as the first entry. The legacy columns are kept as they are (no
 * table rewrite); the catalog repo clears them whenever it writes `links_json`.
 * Safe to run more than once: only rows whose links are still empty and that still hold a legacy
 * URL are converted, so a link deleted through the app (which clears link_url) never comes back.
 */
export function migrateRestaurantLinks(db: Database.Database): void {
  addColumnIfMissing(db, 'restaurants', 'links_json', `TEXT NOT NULL DEFAULT '[]'`);
  const rows = db
    .prepare(`SELECT id, link_url, link_label FROM restaurants WHERE TRIM(COALESCE(link_url, '')) <> '' AND links_json = '[]'`)
    .all() as { id: string; link_url: string; link_label: string | null }[];
  const update = db.prepare('UPDATE restaurants SET links_json = ? WHERE id = ?');
  for (const row of rows) update.run(JSON.stringify(legacyLink(row.link_url, row.link_label)), row.id);
}

/**
 * Adds the home-cooked dish details (menu sections, main ingredients, times, serving, purchase
 * note) as additive columns with empty defaults, and copies each dish's non-blank legacy
 * category into `sections_json` as exactly one section (trimmed, never split or remapped).
 * The legacy `category` column is kept (no table rewrite); the catalog repo keeps it equal to the
 * first section on every write. Timestamps, tags, descriptions, photos, recipe links and stored
 * plan snapshots are not touched.
 * Safe to run more than once: only rows whose sections are still empty and whose category is
 * still non-blank are converted, and clearing sections in the app also blanks the category, so a
 * cleared section never comes back.
 */
export function migrateDishDetails(db: Database.Database): void {
  addColumnIfMissing(db, 'dishes', 'sections_json', `TEXT NOT NULL DEFAULT '[]'`);
  addColumnIfMissing(db, 'dishes', 'ingredients_json', `TEXT NOT NULL DEFAULT '[]'`);
  addColumnIfMissing(db, 'dishes', 'total_minutes', 'INTEGER');
  addColumnIfMissing(db, 'dishes', 'active_minutes', 'INTEGER');
  addColumnIfMissing(db, 'dishes', 'serving_text', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'dishes', 'shopping_note', `TEXT NOT NULL DEFAULT ''`);
  const rows = db
    .prepare(`SELECT id, category FROM dishes WHERE TRIM(category) <> '' AND sections_json = '[]'`)
    .all() as { id: string; category: string }[];
  const update = db.prepare('UPDATE dishes SET sections_json = ? WHERE id = ?');
  for (const row of rows) {
    const sections = legacySections(row.category);
    if (sections.length) update.run(JSON.stringify(sections), row.id);
  }
}

/**
 * Worldwide location and purpose of venues, purpose of plans, and the region lookup cache.
 * Additive only: no table is rebuilt (the plans.mode CHECK stays as it is), no timestamp, tag,
 * note or plan snapshot is touched. Existing venues become meal venues with an unknown location
 * (nothing is inferred from names, tags or addresses); existing plans are meals.
 * Safe to run more than once: columns are only added when missing.
 */
export function migrateVenueLocationPurpose(db: Database.Database): void {
  addColumnIfMissing(db, 'restaurants', 'country', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'restaurants', 'country_code', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'restaurants', 'region', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'restaurants', 'city', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'restaurants', 'location_source', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'restaurants', 'purposes_json', `TEXT NOT NULL DEFAULT '["meal"]'`);
  addColumnIfMissing(db, 'plans', 'purpose', `TEXT NOT NULL DEFAULT 'meal'`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS geo_cache (
      key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS geo_cache_expires ON geo_cache(expires_at);
  `);
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
  {
    version: 2,
    name: 'bark devices and per-recipient deliveries',
    sql: `
      CREATE TABLE bark_devices (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        device_key TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- One row per recipient of a notification. target_id is not a foreign key on purpose:
      -- deleting a device keeps its delivery history (with the label snapshot).
      CREATE TABLE notification_deliveries (
        notification_id TEXT NOT NULL REFERENCES notifications(id),
        target_id TEXT NOT NULL,
        target_label TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'superseded')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        PRIMARY KEY (notification_id, target_id)
      );
      CREATE INDEX notification_deliveries_status ON notification_deliveries(status, next_attempt_at);
    `,
    up: migrateLegacyBarkKey,
  },
  {
    version: 3,
    name: 'restaurant review, external link and cuisine merged into tags',
    sql: '',
    up: migrateRestaurantClassification,
  },
  {
    version: 4,
    name: 'restaurant multiple external links',
    sql: '',
    up: migrateRestaurantLinks,
  },
  {
    version: 5,
    name: 'home-cooked dish sections, main ingredients, times, serving and purchase notes',
    sql: '',
    up: migrateDishDetails,
  },
  {
    version: 6,
    name: 'shared shopping checklist per home meal',
    // Side table only: plans, their snapshots and timestamps are never touched. A plan without a
    // row simply has an all-pending list without manual items (derived on read, nothing written).
    sql: `
      CREATE TABLE IF NOT EXISTS plan_shopping (
        plan_id TEXT PRIMARY KEY REFERENCES plans(id),
        revision INTEGER NOT NULL,
        manual_json TEXT NOT NULL DEFAULT '[]',
        states_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 7,
    name: 'venue location, meal/treat purposes, plan purpose and region lookup cache',
    sql: '',
    up: migrateVenueLocationPurpose,
  },
];

/** `upTo` exists for migration tests (to build an older schema); production always runs all. */
export function runMigrations(db: Database.Database, upTo = Number.POSITIVE_INFINITY): number[] {
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
    if (applied.has(migration.version) || migration.version > upTo) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      migration.up?.(db);
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
