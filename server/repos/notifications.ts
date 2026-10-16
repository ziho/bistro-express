import { randomUUID } from 'node:crypto';
import type { AdminNotification, NotificationStatus, NotificationSummary, PlanEvent } from '../../shared/types.js';
import type { DB } from '../db/connection.js';
import { aggregateDeliveries, countDeliveries } from '../notify/aggregate.js';
import type { Recipient } from '../notify/types.js';
import { createDeliveryRepo, type Delivery } from './deliveries.js';

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

export type RetryResult = 'ok' | 'missing' | 'not_retryable' | 'stale' | 'unconfigured' | 'nothing_to_retry';

const toSummary = (r: NotificationRow, deliveries: Delivery[] | undefined): NotificationSummary => ({
  id: r.id,
  event: r.event,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  planVersion: r.plan_version,
  updatedAt: r.updated_at,
  delivery: deliveries?.length ? countDeliveries(deliveries) : null,
});

const UNAVAILABLE_TARGET = '设备已停用或删除，不再发送这条通知';

export function createNotificationRepo(db: DB) {
  const deliveries = createDeliveryRepo(db);
  const getRow = (id: string) => db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow | undefined;

  /** Recompute the notification's aggregate state from its recipients. */
  function refresh(id: string, now: Date): void {
    const agg = aggregateDeliveries(deliveries.forNotification(id));
    db.prepare(
      `UPDATE notifications SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?,
       sent_at = COALESCE(?, sent_at), updated_at = ? WHERE id = ?`,
    ).run(agg.status, agg.attempts, agg.nextAttemptAt, agg.lastError, agg.sentAt, now.toISOString(), id);
  }

  function isLatestForPlan(id: string, planId: string): boolean {
    const row = db
      .prepare('SELECT id FROM notifications WHERE plan_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(planId) as { id: string } | undefined;
    return row?.id === id;
  }

  /**
   * Manual retry. Only targets that did not get the message are re-queued, so a device that
   * already accepted it is never sent the same message again. If nobody received it yet, the
   * target set is reconciled with the devices that are enabled now.
   */
  function retry(id: string, now: Date, recipients: Recipient[]): RetryResult {
    const row = getRow(id);
    if (!row) return 'missing';
    if (row.status !== 'failed' && row.status !== 'unconfigured') return 'not_retryable';
    if (!isLatestForPlan(id, row.plan_id)) return 'stale';
    return db.transaction((): RetryResult => {
      const targets = deliveries.forNotification(id).filter((d) => d.status !== 'superseded');
      const available = new Map(recipients.map((r) => [r.id, r]));
      const anySent = targets.some((d) => d.status === 'sent');
      let queued = 0;
      for (const target of targets) {
        if (target.status !== 'failed' && target.status !== 'skipped') continue;
        const recipient = available.get(target.targetId);
        if (recipient) {
          deliveries.reset(target, recipient.label, now);
          queued += 1;
        } else if (!anySent) {
          // Not delivered to anyone and this device is gone/disabled: drop it from the target set.
          deliveries.retire(target, UNAVAILABLE_TARGET, now);
        }
      }
      if (!anySent) {
        // Nobody has this message yet, so it can go to whichever devices are enabled now.
        const known = new Set(targets.map((d) => d.targetId));
        const fresh = recipients.filter((r) => !known.has(r.id));
        deliveries.add(id, fresh, now);
        queued += fresh.length;
      }
      if (queued === 0) return recipients.length === 0 ? 'unconfigured' : 'nothing_to_retry';
      refresh(id, now);
      return 'ok';
    })();
  }

  return {
    deliveries,
    refresh,
    isLatestForPlan,
    retry,

    /**
     * Must be called inside the same transaction as the plan write. Supersedes older unsent
     * revisions for the plan so only the newest state is ever delivered. The recipient list is
     * fixed now: devices added later never receive this event.
     */
    enqueue(
      rec: {
        planId: string;
        planVersion: number;
        event: PlanEvent;
        provider: string;
        recipients: Recipient[];
        title: string;
        body: string;
        url: string;
      },
      now: Date,
    ): string {
      const ts = now.toISOString();
      db.prepare(
        `UPDATE notification_deliveries SET status = 'superseded', next_attempt_at = NULL, updated_at = ?
         WHERE status = 'pending' AND notification_id IN
           (SELECT id FROM notifications WHERE plan_id = ? AND status IN ('pending', 'unconfigured', 'failed'))`,
      ).run(ts, rec.planId);
      db.prepare(
        `UPDATE notifications SET status = 'superseded', next_attempt_at = NULL, updated_at = ?
         WHERE plan_id = ? AND status IN ('pending', 'unconfigured', 'failed')`,
      ).run(ts, rec.planId);
      const id = randomUUID();
      const configured = rec.recipients.length > 0;
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
        configured ? 'pending' : 'unconfigured',
        configured ? ts : null,
        configured ? null : '通知渠道未配置',
        rec.title,
        rec.body,
        rec.url,
        ts,
        ts,
      );
      deliveries.add(id, rec.recipients, now);
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
      const latest = new Map<string, NotificationRow>();
      for (const row of rows) latest.set(row.plan_id, row);
      const byId = deliveries.forNotifications([...latest.values()].map((r) => r.id));
      for (const [planId, row] of latest) map.set(planId, toSummary(row, byId.get(row.id)));
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

    markFinal(id: string, status: 'failed' | 'unconfigured' | 'superseded', attempts: number, error: string | null, now: Date): void {
      db.prepare(
        `UPDATE notifications SET status = ?, attempts = ?, next_attempt_at = NULL, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).run(status, attempts, error, now.toISOString(), id);
    },

    /** A newer plan version exists: stop every recipient that has not received this one. */
    supersede(id: string, now: Date): void {
      db.transaction(() => {
        deliveries.supersedeWaiting(id, now);
        db.prepare(`UPDATE notifications SET status = 'superseded', next_attempt_at = NULL, updated_at = ? WHERE id = ?`).run(
          now.toISOString(),
          id,
        );
      })();
    },

    /** Recover rows left in 'sending' by a crash/restart. May re-send to the one in-flight device. */
    resetInFlight(now: Date): number {
      const ts = now.toISOString();
      return db.transaction(() => {
        deliveries.resetInFlight(now);
        return db
          .prepare(`UPDATE notifications SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE status = 'sending'`)
          .run(ts, ts).changes;
      })();
    },

    retryAllHeld(now: Date, recipients: Recipient[]): number {
      const ids = (
        db.prepare(`SELECT id FROM notifications WHERE status IN ('failed', 'unconfigured')`).all() as { id: string }[]
      ).map((r) => r.id);
      let count = 0;
      for (const id of ids) if (retry(id, now, recipients) === 'ok') count += 1;
      return count;
    },

    list(limit: number): AdminNotification[] {
      const rows = db
        .prepare(
          `SELECT n.*, p.short_id AS plan_short_id FROM notifications n JOIN plans p ON p.id = n.plan_id
           ORDER BY n.created_at DESC, n.rowid DESC LIMIT ?`,
        )
        .all(limit) as (NotificationRow & { plan_short_id: string })[];
      const byId = deliveries.forNotifications(rows.map((r) => r.id));
      return rows.map((r) => {
        const targets = byId.get(r.id) ?? [];
        return {
          ...toSummary(r, targets),
          planId: r.plan_id,
          planShortId: r.plan_short_id,
          provider: r.provider,
          title: r.title,
          body: r.body,
          nextAttemptAt: r.next_attempt_at,
          sentAt: r.sent_at,
          createdAt: r.created_at,
          deliveries: targets.map(({ notificationId: _ignored, ...d }) => d),
        };
      });
    },
  };
}

export type NotificationRepo = ReturnType<typeof createNotificationRepo>;
