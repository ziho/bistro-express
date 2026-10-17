import type { DB } from '../db/connection.js';

/** Persistent cache of reverse lookups, so the same point is never looked up again after a restart. */
export function createGeoCacheRepo(db: DB) {
  return {
    get(key: string, now: Date): unknown {
      const row = db.prepare('SELECT result_json FROM geo_cache WHERE key = ? AND expires_at > ?').get(key, now.toISOString()) as
        | { result_json: string }
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.result_json) as unknown;
      } catch {
        return null;
      }
    },
    put(key: string, provider: string, result: unknown, now: Date, ttlMs: number): void {
      db.prepare(
        `INSERT INTO geo_cache (key, provider, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET provider = excluded.provider, result_json = excluded.result_json,
         created_at = excluded.created_at, expires_at = excluded.expires_at`,
      ).run(key, provider, JSON.stringify(result), now.toISOString(), new Date(now.getTime() + ttlMs).toISOString());
    },
    purgeExpired(now: Date): void {
      db.prepare('DELETE FROM geo_cache WHERE expires_at <= ?').run(now.toISOString());
    },
  };
}

export type GeoCacheRepo = ReturnType<typeof createGeoCacheRepo>;
