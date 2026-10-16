import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export type SessionKind = 'guest' | 'admin';

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  expiresAt: string;
}

export function createSessionRepo(db: DB) {
  const insert = db.prepare(
    'INSERT INTO sessions (id, token_hash, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byHash = db.prepare(
    'SELECT id, kind, expires_at FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
  );
  const revokeByHash = db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL');

  return {
    /** Returns the opaque token; only its hash is stored. */
    create(kind: SessionKind, ttlSeconds: number, now: Date): { token: string; expiresAt: string } {
      const token = randomToken();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
      insert.run(randomUUID(), sha256(token), kind, now.toISOString(), expiresAt);
      return { token, expiresAt };
    },

    find(token: string, kind: SessionKind, now: Date): SessionRecord | null {
      if (!token || token.length > 200) return null;
      const row = byHash.get(sha256(token), now.toISOString()) as
        | { id: string; kind: SessionKind; expires_at: string }
        | undefined;
      if (!row || row.kind !== kind) return null;
      return { id: row.id, kind: row.kind, expiresAt: row.expires_at };
    },

    revoke(token: string, now: Date): void {
      if (token) revokeByHash.run(now.toISOString(), sha256(token));
    },

    purgeExpired(now: Date): void {
      purge.run(now.toISOString());
    },
  };
}

export type SessionRepo = ReturnType<typeof createSessionRepo>;
