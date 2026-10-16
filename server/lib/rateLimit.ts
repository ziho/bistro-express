interface Window {
  count: number;
  resetAt: number;
}

/** Small fixed-window counter. In-memory is enough for a single-container, two-person app. */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the key may try again, or 0 if it is currently allowed. */
  blockedFor(key: string): number {
    const window = this.current(key);
    if (!window || window.count < this.limit) return 0;
    return Math.max(1, Math.ceil((window.resetAt - this.now()) / 1000));
  }

  hit(key: string): void {
    const window = this.current(key);
    if (window) {
      this.windows.set(key, { count: window.count + 1, resetAt: window.resetAt });
    } else {
      this.windows.set(key, { count: 1, resetAt: this.now() + this.windowMs });
    }
    if (this.windows.size > 5000) this.sweep();
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private current(key: string): Window | undefined {
    const window = this.windows.get(key);
    if (window && window.resetAt <= this.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

export interface AuthLimiter {
  /** Seconds to wait (0 = allowed) considering both per-client and global failure budgets. */
  blockedFor(clientKey: string): number;
  fail(clientKey: string): void;
  succeed(clientKey: string): void;
}

/**
 * Per-client limit plus a global failure budget. The global budget caps brute force even if an
 * attacker rotates addresses or forwarded headers — the answer space of a date is small.
 */
export function createAuthLimiter(opts: {
  perClient: number;
  perClientWindowMs: number;
  global: number;
  globalWindowMs: number;
  now?: () => number;
}): AuthLimiter {
  const client = new RateLimiter(opts.perClient, opts.perClientWindowMs, opts.now);
  const global = new RateLimiter(opts.global, opts.globalWindowMs, opts.now);
  return {
    blockedFor: (key) => Math.max(client.blockedFor(key), global.blockedFor('*')),
    fail: (key) => {
      client.hit(key);
      global.hit('*');
    },
    succeed: (key) => client.reset(key),
  };
}
