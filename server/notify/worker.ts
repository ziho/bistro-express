import { NOTIFY_MAX_ATTEMPTS } from '../../shared/constants.js';
import type { NotificationRepo, OutboxMessage } from '../repos/notifications.js';
import { PUSH_GROUP } from './message.js';
import { ProviderError, type NotificationProvider } from './types.js';

/** Delay before attempt n+1, after n failed attempts (5 attempts total). */
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
 * crash never loses a notification; rows stuck in 'sending' are re-queued on start (which can
 * duplicate a push — each message carries the plan short id + version to make that visible).
 */
export class NotificationWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private started = false;

  constructor(private readonly deps: WorkerDeps) {}

  start(): void {
    this.started = true;
    const recovered = this.deps.repo.resetInFlight(this.deps.clock());
    if (recovered) this.deps.log?.(`notify: re-queued ${recovered} in-flight message(s)`);
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
      repo.markFinal(message.id, 'superseded', message.attempts, null, clock());
      return;
    }
    if (!provider.isConfigured()) {
      repo.markFinal(message.id, 'unconfigured', message.attempts, '通知渠道未配置', clock());
      return;
    }
    const attempts = message.attempts + 1;
    try {
      await provider.send({ title: message.title, body: message.body, url: message.url, group: PUSH_GROUP });
      repo.markSent(message.id, attempts, clock());
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : '发送失败';
      if (!(err instanceof ProviderError)) this.deps.log?.(`notify: unexpected provider error ${String(err)}`);
      if (attempts >= NOTIFY_MAX_ATTEMPTS) {
        repo.markFinal(message.id, 'failed', attempts, reason, clock());
      } else {
        const delay = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
        repo.markRetry(message.id, attempts, new Date(clock().getTime() + delay), reason, clock());
      }
    }
  }
}
