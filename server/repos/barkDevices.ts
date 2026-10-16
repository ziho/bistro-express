import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.js';

interface DeviceRow {
  id: string;
  label: string;
  device_key: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Server-side only: contains the raw device key. Convert with `deviceView` before responding. */
export interface BarkDevice {
  id: string;
  label: string;
  deviceKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const toDevice = (r: DeviceRow): BarkDevice => ({
  id: r.id,
  label: r.label,
  deviceKey: r.device_key,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createBarkDeviceRepo(db: DB) {
  return {
    list(): BarkDevice[] {
      return (db.prepare('SELECT * FROM bark_devices ORDER BY created_at ASC, rowid ASC').all() as DeviceRow[]).map(toDevice);
    },

    get(id: string): BarkDevice | null {
      const row = db.prepare('SELECT * FROM bark_devices WHERE id = ?').get(id) as DeviceRow | undefined;
      return row ? toDevice(row) : null;
    },

    findByKey(deviceKey: string): BarkDevice | null {
      const row = db.prepare('SELECT * FROM bark_devices WHERE device_key = ?').get(deviceKey) as DeviceRow | undefined;
      return row ? toDevice(row) : null;
    },

    count(): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM bark_devices').get() as { n: number }).n;
    },

    insert(rec: { label: string; deviceKey: string; enabled: boolean }, now: Date): BarkDevice {
      const id = randomUUID();
      const ts = now.toISOString();
      db.prepare(
        'INSERT INTO bark_devices (id, label, device_key, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, rec.label, rec.deviceKey, rec.enabled ? 1 : 0, ts, ts);
      return this.get(id)!;
    },

    update(id: string, rec: { label: string; deviceKey: string; enabled: boolean }, now: Date): BarkDevice | null {
      const result = db
        .prepare('UPDATE bark_devices SET label = ?, device_key = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(rec.label, rec.deviceKey, rec.enabled ? 1 : 0, now.toISOString(), id);
      return result.changes ? this.get(id) : null;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM bark_devices WHERE id = ?').run(id).changes === 1;
    },
  };
}

export type BarkDeviceRepo = ReturnType<typeof createBarkDeviceRepo>;
