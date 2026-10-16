import type { DeliveryCounts, DeliveryStatus } from '../../shared/types.js';

export interface DeliveryState {
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
}

export interface Aggregate {
  status: 'pending' | 'sent' | 'failed' | 'unconfigured';
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
}

const isWaiting = (s: DeliveryStatus) => s === 'pending' || s === 'sending';

export function countDeliveries(states: { status: DeliveryStatus }[]): DeliveryCounts {
  const counts: DeliveryCounts = { total: 0, sent: 0, failed: 0, pending: 0, skipped: 0 };
  for (const { status } of states) {
    if (status === 'superseded') continue;
    counts.total += 1;
    if (status === 'sent') counts.sent += 1;
    else if (status === 'failed') counts.failed += 1;
    else if (status === 'skipped') counts.skipped += 1;
    else counts.pending += 1;
  }
  return counts;
}

function errorSummary(active: DeliveryState[]): string | null {
  const problems = active.filter((d) => d.status !== 'sent' && d.lastError);
  if (problems.length === 0) return null;
  const first = problems[0]!.lastError!;
  // Single-recipient wording stays exactly as before multi-device support.
  if (active.length === 1) return first;
  return `${active.length} 台设备中 ${problems.length} 台未送达：${first}`;
}

/**
 * Overall notification state from its recipients:
 * - any recipient still waiting  → 'pending' (due at the earliest recipient retry)
 * - else any failed              → 'failed' (manually retryable; only failed targets re-send)
 * - else any skipped             → 'unconfigured' (held: a device was disabled/removed/channel off)
 * - else everyone accepted       → 'sent'
 * So 'sent' is never reported while any recipient did not get the message.
 */
export function aggregateDeliveries(states: DeliveryState[]): Aggregate {
  const active = states.filter((d) => d.status !== 'superseded');
  const attempts = active.reduce((max, d) => Math.max(max, d.attempts), 0);
  const lastError = errorSummary(active);
  if (active.length === 0) {
    return { status: 'unconfigured', attempts, nextAttemptAt: null, lastError: '没有可用的接收设备', sentAt: null };
  }
  const waiting = active.filter((d) => isWaiting(d.status));
  if (waiting.length) {
    const nextAttemptAt = waiting
      .map((d) => d.nextAttemptAt)
      .filter((v): v is string => Boolean(v))
      .sort()[0] ?? null;
    return { status: 'pending', attempts, nextAttemptAt, lastError, sentAt: null };
  }
  if (active.some((d) => d.status === 'failed')) {
    return { status: 'failed', attempts, nextAttemptAt: null, lastError, sentAt: null };
  }
  if (active.some((d) => d.status === 'skipped')) {
    return { status: 'unconfigured', attempts, nextAttemptAt: null, lastError, sentAt: null };
  }
  const sentAt = active
    .map((d) => d.sentAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null;
  return { status: 'sent', attempts, nextAttemptAt: null, lastError: null, sentAt };
}
