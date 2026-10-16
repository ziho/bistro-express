import { randomUUID } from 'node:crypto';
import type { AdminNotification, NotificationStatus, NotificationSummary, PlanEvent } from '../../shared/types.js';
import type { DB } from '../db/connection.js';

interface NotificationRow {
  id: string;
  plan_id: string;
  plan_version: number;
  event: PlanEvent;
  provider: string;
  status: NotificationStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  title: string;
  body: string;
  url: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface OutboxMessage {
  id: string;
  planId: string;
  planVersion: number;
  attempts: number;
  title: string;
  body: string;
  url: string;
}

const toSummary = (r: NotificationRow): NotificationSummary => ({
  id: r.id,
  event: r.event,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  planVersion: r.plan_version,
  updatedAt: r.updated_at,
});

export function createNotificationRepo(db: DB) {
  return {
    /**
     * Must be called inside the same transaction as the plan write. Supersedes older unsent
     * revisions for the plan so only the newest state is ever delivered.
     */
    enqueue(
      rec: {
        planId: string;
        planVersion: number;
        event: PlanEvent;
        provider: string;
        configured: boolean;
        title: string;
        body: string;
        url: string;
      },
      now: Date,
    ): string {
      const ts = now.toISOString();
      db.prepare(
        `UPDATE notifications SET status = 'superseded', next_attempt_at = NULL, updated_at = ?
         WHERE plan_id = ? AND status IN ('pending', 'unconfigured', 'failed')`,
      ).run(ts, rec.planId);
      const id = randomUUID();
      db.prepare(
        `INSERT INTO notifications (id, plan_id, plan_version, event, provider, status, attempts, next_attempt_at,
         last_error, title, body, url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        rec.planId,
        rec.planVersion,
        rec.event,
        rec.provider,
        rec.configured ? 'pending' : 'unconfigured',
        rec.configured ? ts : null,
        rec.configured ? null : '通知渠道未配置',
        rec.title,
        rec.body,
        rec.url,
        ts,
        ts,
      );
      return id;
    },

    latestForPlans(planIds: string[]): Map<string, NotificationSummary> {
      const map = new Map<string, NotificationSummary>();
      if (planIds.length === 0) return map;
      const rows = db
        .prepare(
          `SELECT * FROM notifications WHERE plan_id IN (${planIds.map(() => '?').join(',')})
           ORDER BY created_at ASC, rowid ASC`,
        )
        .all(...planIds) as NotificationRow[];
      for (const row of rows) map.set(row.plan_id, toSummary(row));
      return map;
    },

    claimDue(now: Date, limit: number): OutboxMessage[] {
      const ts = now.toISOString();
      return db.transaction(() => {
        const rows = db
          .prepare(
            `SELECT * FROM notifications WHERE status = 'pending' AND next_attempt_at <= ?
             ORDER BY next_attempt_at ASC LIMIT ?`,
          )
          .all(ts, limit) as NotificationRow[];
        const mark = db.prepare(`UPDATE notifications SET status = 'sending', updated_at = ? WHERE id = ?`);
        for (const row of rows) mark.run(ts, row.id);
        return rows.map((r) => ({
          id: r.id,
          planId: r.plan_id,
          planVersion: r.plan_version,
          attempts: r.attempts,
          title: r.title,
          body: r.body,
          url: r.url,
        }));
      })();
    },

    markSent(id: string, attempts: number, now: Date): void {
      const ts = now.toISOString();
      db.prepare(
        `UPDATE notifications SET status = 'sent', attempts = ?, sent_at = ?, last_error = NULL,
         next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
      ).run(attempts, ts, ts, id);
    },

    markRetry(id: string, attempts: number, nextAt: Date, error: string, now: Date): void {
      db.prepare(
        `UPDATE notifications SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).run(attempts, nextAt.toISOString(), error, now.toISOString(), id);
    },

    markFinal(id: string, status: 'failed' | 'unconfigured' | 'superseded', attempts: number, error: string | null, now: Date): void {
      db.prepare(
        `UPDATE notifications SET status = ?, attempts = ?, next_attempt_at = NULL, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).run(status, attempts, error, now.toISOString(), id);
    },

    isLatestForPlan(id: string, planId: string): boolean {
      const row = db
        .prepare('SELECT id FROM notifications WHERE plan_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
        .get(planId) as { id: string } | undefined;
      return row?.id === id;
    },

    /** Recover rows left in 'sending' by a crash/restart. May cause a duplicate push (documented). */
    resetInFlight(now: Date): number {
      return db
        .prepare(`UPDATE notifications SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE status = 'sending'`)
        .run(now.toISOString(), now.toISOString()).changes;
    },

    /** Manual retry of a final failure (or a message held because the channel was not configured). */
    retry(id: string, now: Date): 'ok' | 'missing' | 'not_retryable' | 'stale' {
      const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow | undefined;
      if (!row) return 'missing';
      if (row.status !== 'failed' && row.status !== 'unconfigured') return 'not_retryable';
      if (!this.isLatestForPlan(id, row.plan_id)) return 'stale';
      const ts = now.toISOString();
      db.prepare(
        `UPDATE notifications SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(ts, ts, id);
      return 'ok';
    },

    retryAllHeld(now: Date): number {
      const ids = (
        db.prepare(`SELECT id FROM notifications WHERE status IN ('failed', 'unconfigured')`).all() as { id: string }[]
      ).map((r) => r.id);
      let count = 0;
      for (const id of ids) if (this.retry(id, now) === 'ok') count += 1;
      return count;
    },

    list(limit: number): AdminNotification[] {
      const rows = db
        .prepare(
          `SELECT n.*, p.short_id AS plan_short_id FROM notifications n JOIN plans p ON p.id = n.plan_id
           ORDER BY n.created_at DESC, n.rowid DESC LIMIT ?`,
        )
        .all(limit) as (NotificationRow & { plan_short_id: string })[];
      return rows.map((r) => ({
        ...toSummary(r),
        planId: r.plan_id,
        planShortId: r.plan_short_id,
        provider: r.provider,
        title: r.title,
        body: r.body,
        nextAttemptAt: r.next_attempt_at,
        sentAt: r.sent_at,
        createdAt: r.created_at,
      }));
    },
  };
}

export type NotificationRepo = ReturnType<typeof createNotificationRepo>;
