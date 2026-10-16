import path from 'node:path';
import type { AppConfig } from './config.js';
import { openDatabase, type DB } from './db/connection.js';
import { createAuthLimiter, type AuthLimiter } from './lib/rateLimit.js';
import { createBarkProvider } from './notify/bark.js';
import type { NotificationProvider } from './notify/types.js';
import { NotificationWorker } from './notify/worker.js';
import { createCatalogRepo } from './repos/catalog.js';
import { createIdempotencyRepo, createMediaRepo, createSettingsRepo } from './repos/misc.js';
import { createNotificationRepo } from './repos/notifications.js';
import { createPlanRepo } from './repos/plans.js';
import { createSessionRepo } from './repos/sessions.js';
import { createPlanService } from './services/planService.js';

export interface ContextOptions {
  clock?: () => Date;
  /** Override the notification provider (tests use a fake; never real pushes). */
  provider?: (settings: ReturnType<typeof createSettingsRepo>) => NotificationProvider;
  log?: (msg: string) => void;
}

export function createAppContext(config: AppConfig, opts: ContextOptions = {}) {
  const clock = opts.clock ?? (() => new Date());
  const log = opts.log ?? ((msg: string) => console.log(`[bistro] ${msg}`));
  const db: DB = openDatabase(config.dataDir);
  const repos = {
    sessions: createSessionRepo(db),
    catalog: createCatalogRepo(db),
    plans: createPlanRepo(db),
    notifications: createNotificationRepo(db),
    media: createMediaRepo(db),
    settings: createSettingsRepo(db),
    idempotency: createIdempotencyRepo(db),
  };
  const provider = opts.provider ? opts.provider(repos.settings) : createBarkProvider(repos.settings);
  const worker = new NotificationWorker({ repo: repos.notifications, provider, clock, log });
  const planService = createPlanService({
    db,
    plans: repos.plans,
    catalog: repos.catalog,
    notifications: repos.notifications,
    idempotency: repos.idempotency,
    provider,
    publicBaseUrl: config.publicBaseUrl,
    clock,
    onCommitted: () => worker.kick(),
  });
  const nowMs = () => clock().getTime();
  const limiters: { gate: AuthLimiter; admin: AuthLimiter } = {
    gate: createAuthLimiter({
      perClient: 8,
      perClientWindowMs: 15 * 60_000,
      global: 40,
      globalWindowMs: 60 * 60_000,
      now: nowMs,
    }),
    admin: createAuthLimiter({
      perClient: 5,
      perClientWindowMs: 15 * 60_000,
      global: 20,
      globalWindowMs: 60 * 60_000,
      now: nowMs,
    }),
  };
  return {
    config,
    db,
    clock,
    log,
    repos,
    provider,
    worker,
    planService,
    limiters,
    mediaDir: path.join(config.dataDir, 'media'),
  };
}

export type AppContext = ReturnType<typeof createAppContext>;
