import { NOTIFY_MAX_ATTEMPTS } from '../../shared/constants.js';
import type { Delivery } from '../repos/deliveries.js';
import type { NotificationRepo, OutboxMessage } from '../repos/notifications.js';
import { PUSH_GROUP } from './message.js';
import { ProviderError, type NotificationProvider, type PushMessage } from './types.js';

/** Delay before attempt n+1, after n failed attempts (5 attempts total per recipient). */
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

export interface WorkerDeps {
  repo: NotificationRepo;
  provider: NotificationProvider;
  clock: () => Date;
  pollMs?: number;
  log?: (msg: string) => void;
}

/**
 * Delivers outbox rows. Rows are written in the same DB transaction as the plan change, so a
 * crash never loses a notification. Every recipient device has its own delivery row, attempt
 * count and backoff: a device that accepted the message is never sent it again because another
 * device failed. Rows stuck in 'sending' are re-queued on start (which can duplicate a push to
 * the one in-flight device — each message carries the plan short id + version to make that visible).
 */
export class NotificationWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private started = false;

  constructor(private readonly deps: WorkerDeps) {}

  /**
   * Recovers rows a crash left in 'sending', then deletes expired history before the first
   * delivery pass, so a recovered record older than the retention window is never re-sent.
   */
  start(): void {
    this.started = true;
    const recovered = this.deps.repo.resetInFlight(this.deps.clock());
    if (recovered) this.deps.log?.(`notify: re-queued ${recovered} in-flight message(s)`);
    this.purgeExpired();
    this.timer = setInterval(() => this.kick(), this.deps.pollMs ?? 5000);
    this.timer.unref();
    this.kick();
  }

  stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.running ?? Promise.resolve();
  }

  /** Deletes notification history older than the retention window (startup and hourly maintenance). */
  purgeExpired(): number {
    const removed = this.deps.repo.purgeExpired(this.deps.clock());
    if (removed) this.deps.log?.(`notify: deleted ${removed} expired notification record(s)`);
    return removed;
  }

  /** Trigger a delivery pass soon (after a commit). Safe to call often; no-op until started. */
  kick(): void {
    if (!this.started) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = this.drain()
      .catch((err: unknown) => this.deps.log?.(`notify: worker error ${String(err)}`))
      .finally(() => {
        this.running = null;
        if (this.rerun) {
          this.rerun = false;
          this.kick();
        }
      });
  }

  /** Runs passes until nothing is due. Exposed for tests. */
  async drain(): Promise<void> {
    for (;;) {
      const batch = this.deps.repo.claimDue(this.deps.clock(), 10);
      if (batch.length === 0) return;
      for (const message of batch) await this.deliver(message);
    }
  }

  private async deliver(message: OutboxMessage): Promise<void> {
    const { repo, provider, clock } = this.deps;
    if (!repo.isLatestForPlan(message.id, message.planId)) {
      repo.supersede(message.id, clock());
      return;
    }
    if (repo.deliveries.forNotification(message.id).length === 0) {
      // Queued before multi-device support (or by an older version): fan out to current devices.
      const recipients = provider.listRecipients();
      if (recipients.length === 0) {
        repo.markFinal(message.id, 'unconfigured', message.attempts, '通知渠道未配置', clock());
        return;
      }
      repo.deliveries.add(message.id, recipients, clock());
    }
    const push: PushMessage = { title: message.title, body: message.body, url: message.url, group: PUSH_GROUP };
    for (const target of repo.deliveries.due(message.id, clock())) {
      // A newer plan version may have been saved while earlier devices were being sent to.
      if (!repo.isLatestForPlan(message.id, message.planId)) {
        repo.supersede(message.id, clock());
        return;
      }
      await this.deliverTo(target, push);
    }
    repo.refresh(message.id, clock());
  }

  private async deliverTo(target: Delivery, push: PushMessage): Promise<void> {
    const { repo, provider, clock } = this.deps;
    const unavailable = provider.unavailableReason(target.targetId);
    if (unavailable) {
      repo.deliveries.markFinal(target, 'skipped', target.attempts, unavailable, clock());
      return;
    }
    const attempts = target.attempts + 1;
    repo.deliveries.markSending(target, clock());
    try {
      await provider.send(target.targetId, push);
      repo.deliveries.markSent(target, attempts, clock());
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : '发送失败';
      if (!(err instanceof ProviderError)) this.deps.log?.(`notify: unexpected provider error ${String(err)}`);
      if (attempts >= NOTIFY_MAX_ATTEMPTS) {
        repo.deliveries.markFinal(target, 'failed', attempts, reason, clock());
      } else {
        const delay = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
        repo.deliveries.markRetry(target, attempts, new Date(clock().getTime() + delay), reason, clock());
      }
    }
  }
}
