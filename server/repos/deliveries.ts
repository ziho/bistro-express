import type { AdminDelivery, DeliveryStatus } from '../../shared/types.js';
import type { DB } from '../db/connection.js';
import type { Recipient } from '../notify/types.js';

interface DeliveryRow {
  notification_id: string;
  target_id: string;
  target_label: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface Delivery extends AdminDelivery {
  notificationId: string;
}

const toDelivery = (r: DeliveryRow): Delivery => ({
  notificationId: r.notification_id,
  targetId: r.target_id,
  label: r.target_label,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  nextAttemptAt: r.next_attempt_at,
  sentAt: r.sent_at,
  updatedAt: r.updated_at,
});

/** Per-recipient rows of the outbox. Each recipient has its own attempts and schedule. */
export function createDeliveryRepo(db: DB) {
  const setState = db.prepare(
    `UPDATE notification_deliveries SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
     WHERE notification_id = ? AND target_id = ?`,
  );

  return {
    /** Adds recipients that are not already targets of this notification. */
    add(notificationId: string, recipients: Recipient[], now: Date): void {
      const ts = now.toISOString();
      const insert = db.prepare(
        `INSERT INTO notification_deliveries
         (notification_id, target_id, target_label, status, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
         ON CONFLICT(notification_id, target_id) DO UPDATE SET
           target_label = excluded.target_label, status = 'pending', attempts = 0,
           next_attempt_at = excluded.next_attempt_at, last_error = NULL,
           updated_at = excluded.updated_at, sent_at = NULL
         WHERE notification_deliveries.status = 'superseded'`,
      );
      for (const r of recipients) insert.run(notificationId, r.id, r.label, ts, ts, ts);
    },

    forNotification(notificationId: string): Delivery[] {
      return (
        db
          .prepare('SELECT * FROM notification_deliveries WHERE notification_id = ? ORDER BY created_at ASC, rowid ASC')
          .all(notificationId) as DeliveryRow[]
      ).map(toDelivery);
    },

    forNotifications(ids: string[]): Map<string, Delivery[]> {
      const map = new Map<string, Delivery[]>();
      if (ids.length === 0) return map;
      const rows = db
        .prepare(
          `SELECT * FROM notification_deliveries WHERE notification_id IN (${ids.map(() => '?').join(',')})
           ORDER BY created_at ASC, rowid ASC`,
        )
        .all(...ids) as DeliveryRow[];
      for (const row of rows) {
        const d = toDelivery(row);
        map.set(d.notificationId, [...(map.get(d.notificationId) ?? []), d]);
      }
      return map;
    },

    due(notificationId: string, now: Date): Delivery[] {
      return (
        db
          .prepare(
            `SELECT * FROM notification_deliveries WHERE notification_id = ? AND status = 'pending' AND next_attempt_at <= ?
             ORDER BY created_at ASC, rowid ASC`,
          )
          .all(notificationId, now.toISOString()) as DeliveryRow[]
      ).map(toDelivery);
    },

    markSending(d: Delivery, now: Date): void {
      setState.run('sending', d.attempts, null, d.lastError, now.toISOString(), d.notificationId, d.targetId);
    },

    markSent(d: Delivery, attempts: number, now: Date): void {
      const ts = now.toISOString();
      db.prepare(
        `UPDATE notification_deliveries SET status = 'sent', attempts = ?, next_attempt_at = NULL, last_error = NULL,
         sent_at = ?, updated_at = ? WHERE notification_id = ? AND target_id = ?`,
      ).run(attempts, ts, ts, d.notificationId, d.targetId);
    },

    markRetry(d: Delivery, attempts: number, nextAt: Date, error: string, now: Date): void {
      setState.run('pending', attempts, nextAt.toISOString(), error, now.toISOString(), d.notificationId, d.targetId);
    },

    markFinal(d: Delivery, status: 'failed' | 'skipped', attempts: number, error: string, now: Date): void {
      setState.run(status, attempts, null, error, now.toISOString(), d.notificationId, d.targetId);
    },

    /** Manual retry of one target: fresh attempt budget, label refreshed from the device. */
    reset(d: Delivery, label: string, now: Date): void {
      const ts = now.toISOString();
      db.prepare(
        `UPDATE notification_deliveries SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL,
         target_label = ?, updated_at = ? WHERE notification_id = ? AND target_id = ?`,
      ).run(ts, label, ts, d.notificationId, d.targetId);
    },

    /** Removes one undelivered target from the active set (kept as history, excluded from counts). */
    retire(d: Delivery, reason: string, now: Date): void {
      setState.run('superseded', d.attempts, null, reason, now.toISOString(), d.notificationId, d.targetId);
    },

    /** Targets that have not been delivered stop when a newer plan version supersedes the message. */
    supersedeWaiting(notificationId: string, now: Date): void {
      db.prepare(
        `UPDATE notification_deliveries SET status = 'superseded', next_attempt_at = NULL, updated_at = ?
         WHERE notification_id = ? AND status IN ('pending', 'sending')`,
      ).run(now.toISOString(), notificationId);
    },

    resetInFlight(now: Date): number {
      const ts = now.toISOString();
      return db
        .prepare(`UPDATE notification_deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE status = 'sending'`)
        .run(ts, ts).changes;
    },
  };
}

export type DeliveryRepo = ReturnType<typeof createDeliveryRepo>;
