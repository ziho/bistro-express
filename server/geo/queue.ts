/**
 * One process-wide serial queue for an external service with a strict rate limit: at most one
 * request in flight, and at least `minIntervalMs` between the starts of two requests, whichever
 * listener (public / admin) or page asked. Identical pending or running work (same key) is shared
 * instead of being sent twice. The queue is bounded; `reset` drops everything still waiting.
 */

export interface QueueClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realQueueClock: QueueClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class QueueFullError extends Error {}
export class QueueResetError extends Error {}

interface Job {
  key: string;
  task: () => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export class SerialRateQueue {
  private readonly waiting: Job[] = [];
  private readonly byKey = new Map<string, Job>();
  private lastStart = Number.NEGATIVE_INFINITY;
  private pumping = false;
  /** Number of requests actually started (for tests and diagnostics). */
  started = 0;

  constructor(
    private readonly opts: { minIntervalMs: number; maxPending: number; clock: QueueClock },
  ) {}

  get pending(): number {
    return this.waiting.length;
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.byKey.get(key);
    if (existing) return existing.promise as Promise<T>;
    if (this.waiting.length >= this.opts.maxPending) return Promise.reject(new QueueFullError('queue full'));
    let resolve!: (value: unknown) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job = { key, task, promise, resolve, reject };
    this.waiting.push(job);
    this.byKey.set(key, job);
    void this.pump();
    return promise as Promise<T>;
  }

  /** Rejects every job that has not started yet (a running request finishes on its own). */
  reset(): void {
    for (const job of this.waiting.splice(0)) {
      this.byKey.delete(job.key);
      job.reject(new QueueResetError('queue reset'));
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiting.length > 0) {
        const wait = this.lastStart + this.opts.minIntervalMs - this.opts.clock.now();
        if (wait > 0) await this.opts.clock.sleep(wait);
        const job = this.waiting.shift();
        if (!job) break; // reset while sleeping
        this.lastStart = this.opts.clock.now();
        this.started += 1;
        try {
          job.resolve(await job.task());
        } catch (err) {
          job.reject(err);
        } finally {
          this.byKey.delete(job.key);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}
