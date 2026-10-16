import type { DB } from '../db/connection.js';

export function createMediaRepo(db: DB) {
  return {
    insert(rec: { id: string; width: number; height: number; sourceType: string; bytes: number }, now: Date) {
      db.prepare('INSERT INTO media (id, width, height, source_type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        rec.id,
        rec.width,
        rec.height,
        rec.sourceType,
        rec.bytes,
        now.toISOString(),
      );
    },
    exists(id: string): boolean {
      return Boolean(db.prepare('SELECT 1 FROM media WHERE id = ?').get(id));
    },
  };
}

export function createSettingsRepo(db: DB) {
  return {
    get<T>(key: string): T | null {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return null;
      }
    },
    set(key: string, value: unknown, now: Date): void {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, JSON.stringify(value), now.toISOString());
    },
  };
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function createIdempotencyRepo(db: DB) {
  return {
    /** Returns the stored response, 'mismatch' if the key was used for a different request, or null. */
    lookup(key: string, fingerprint: string): StoredResponse | 'mismatch' | null {
      const row = db.prepare('SELECT fingerprint, status, body FROM idempotency_keys WHERE key = ?').get(key) as
        | { fingerprint: string; status: number; body: string }
        | undefined;
      if (!row) return null;
      if (row.fingerprint !== fingerprint) return 'mismatch';
      return { status: row.status, body: JSON.parse(row.body) as unknown };
    },
    store(key: string, fingerprint: string, response: StoredResponse, now: Date): void {
      db.prepare('INSERT INTO idempotency_keys (key, fingerprint, status, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
        key,
        fingerprint,
        response.status,
        JSON.stringify(response.body),
        now.toISOString(),
      );
    },
    purgeOlderThan(cutoff: Date): void {
      db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff.toISOString());
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
export type IdempotencyRepo = ReturnType<typeof createIdempotencyRepo>;
