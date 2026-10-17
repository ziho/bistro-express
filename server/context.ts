import path from 'node:path';
import { MAP_LINK_RATE_LIMIT } from '../shared/constants.js';
import type { AppConfig } from './config.js';
import { openDatabase, type DB } from './db/connection.js';
import { createAuthLimiter, RateLimiter, type AuthLimiter } from './lib/rateLimit.js';
import { createBarkProvider, type FetchLike } from './notify/bark.js';
import type { NotificationProvider } from './notify/types.js';
import { NotificationWorker } from './notify/worker.js';
import { createBarkDeviceRepo } from './repos/barkDevices.js';
import { createCatalogRepo } from './repos/catalog.js';
import { createIdempotencyRepo, createMediaRepo, createSettingsRepo } from './repos/misc.js';
import { createNotificationRepo } from './repos/notifications.js';
import { createPlanRepo } from './repos/plans.js';
import { createSessionRepo } from './repos/sessions.js';
import { createShoppingRepo } from './repos/shopping.js';
import { createPlanService } from './services/planService.js';
import { createRestaurantImporter } from './services/restaurantImport.js';
import { createShoppingService } from './services/shoppingService.js';
import { syncShoppingAfterPlanWrite } from './services/shoppingState.js';

export interface ContextOptions {
  clock?: () => Date;
  /** Override the notification provider (tests use a fake; never real pushes). */
  provider?: (settings: ReturnType<typeof createSettingsRepo>) => NotificationProvider;
  /**
   * Outbound HTTP used by Bark pushes, admin test pushes and Google Maps link expansion.
   * Tests inject a fake so nothing ever leaves the machine.
   */
  fetch?: FetchLike;
  log?: (msg: string) => void;
}

export function createAppContext(config: AppConfig, opts: ContextOptions = {}) {
  const clock = opts.clock ?? (() => new Date());
  const log = opts.log ?? ((msg: string) => console.log(`[bistro] ${msg}`));
  const outboundFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const db: DB = openDatabase(config.dataDir);
  const repos = {
    sessions: createSessionRepo(db),
    catalog: createCatalogRepo(db),
    plans: createPlanRepo(db),
    notifications: createNotificationRepo(db),
    media: createMediaRepo(db),
    settings: createSettingsRepo(db),
    idempotency: createIdempotencyRepo(db),
    barkDevices: createBarkDeviceRepo(db),
    shopping: createShoppingRepo(db),
  };
  const provider = opts.provider
    ? opts.provider(repos.settings)
    : createBarkProvider(repos.settings, repos.barkDevices, outboundFetch);
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
    afterUpdate: (plan, now) => syncShoppingAfterPlanWrite(repos.shopping, plan, now),
  });
  const shoppingService = createShoppingService({
    db,
    plans: repos.plans,
    shopping: repos.shopping,
    idempotency: repos.idempotency,
    clock,
  });
  const restaurantImporter = createRestaurantImporter({ db, catalog: repos.catalog, idempotency: repos.idempotency, clock });
  const nowMs = () => clock().getTime();
  const limiters: { gate: AuthLimiter; mapLink: RateLimiter } = {
    gate: createAuthLimiter({
      perClient: 8,
      perClientWindowMs: 15 * 60_000,
      global: 40,
      globalWindowMs: 60 * 60_000,
      now: nowMs,
    }),
    /**
     * Outbound link expansion (admin-only) — keeps accidental loops from hammering Google while
     * leaving room for one 100-row bulk import plus retries.
     */
    mapLink: new RateLimiter(MAP_LINK_RATE_LIMIT, 10 * 60_000, nowMs),
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
    shoppingService,
    restaurantImporter,
    limiters,
    outboundFetch,
    mediaDir: path.join(config.dataDir, 'media'),
  };
}

export type AppContext = ReturnType<typeof createAppContext>;
