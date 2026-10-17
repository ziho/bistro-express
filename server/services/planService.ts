import { randomUUID } from 'node:crypto';
import { isPastDate, isValidDateString, isValidTimeZone, resolveLocalDateTime, TIME_ERROR_MESSAGES } from '../../shared/time.js';
import { snapshotOfDish } from '../../shared/dish.js';
import type { DishSnapshot, Plan, PlanEvent, Restaurant, RestaurantSnapshot, VenuePurpose } from '../../shared/types.js';
import { PURPOSE_LABEL } from '../../shared/venue.js';
import type { DB } from '../db/connection.js';
import { shortCode } from '../lib/crypto.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import type { PlanInputParsed } from '../lib/validation.js';
import { buildPlanMessage } from '../notify/message.js';
import type { NotificationProvider } from '../notify/types.js';
import type { CatalogRepo } from '../repos/catalog.js';
import type { IdempotencyRepo, StoredResponse } from '../repos/misc.js';
import type { NotificationRepo } from '../repos/notifications.js';
import type { PlanRepo, PlanWrite, StoredPlan } from '../repos/plans.js';
import { runIdempotent, type IdempotentRequest } from './idempotent.js';

export interface PlanServiceDeps {
  db: DB;
  plans: PlanRepo;
  catalog: CatalogRepo;
  notifications: NotificationRepo;
  idempotency: IdempotencyRepo;
  provider: NotificationProvider;
  publicBaseUrl: string;
  clock: () => Date;
  /** Called after a committed write that queued a notification. */
  onCommitted: () => void;
  /** Runs inside the transaction of a successful plan update (shopping checklist reconciliation). */
  afterUpdate?: (plan: StoredPlan, now: Date) => void;
}

export type { IdempotentRequest } from './idempotent.js';

const unique = (ids: string[]) => [...new Set(ids)];

/** Frozen at save time, including where the venue is and what it is for. */
export function snapshotOfRestaurant(r: Restaurant): RestaurantSnapshot {
  return {
    id: r.id,
    name: r.name,
    imageAssetId: r.imageAssetId,
    review: r.review,
    tags: [...r.tags],
    budgetText: r.budgetText,
    address: r.address,
    mapUrl: r.mapUrl,
    links: r.links.map((l) => ({ ...l })),
    location: { ...r.location },
    purposes: [...r.purposes],
  };
}

/**
 * Home plans are always meals (an explicit 'treat' is rejected). A restaurant plan takes the
 * requested purpose; when an older client omits it, a new plan is a meal and an edited plan keeps
 * its saved purpose, so a treat outing never silently turns into a meal.
 */
export function resolvePurpose(input: PlanInputParsed, stored: { mode: string; purpose: VenuePurpose } | null): VenuePurpose {
  if (input.mode === 'home') {
    if (input.purpose === 'treat') {
      throw unprocessable('invalid_purpose', '在家吃只能是正餐；喝点、吃点甜的请选择「饮品甜品」', { field: 'purpose' });
    }
    return 'meal';
  }
  if (input.purpose) return input.purpose;
  return stored?.mode === 'restaurant' ? stored.purpose : 'meal';
}

export function createPlanService(deps: PlanServiceDeps) {
  const { db, plans, catalog, notifications, idempotency, clock } = deps;

  function withNotification(plan: StoredPlan): Plan {
    return { ...plan, notification: notifications.latestForPlans([plan.id]).get(plan.id) ?? null };
  }

  function resolveTiming(input: PlanInputParsed, now: Date) {
    if (!isValidDateString(input.date)) throw badRequest('日期格式不正确', { field: 'date' });
    if (!isValidTimeZone(input.timeZone)) throw badRequest(TIME_ERROR_MESSAGES.invalid_zone, { field: 'timeZone' });
    if (isPastDate(input.date, input.timeZone, now)) {
      throw unprocessable('past_date', '不能为已经过去的日期安排计划', { field: 'date' });
    }
    if (!input.localTime) return { localTime: null, instant: null };
    const resolved = resolveLocalDateTime(input.date, input.localTime, input.timeZone);
    if (!resolved.ok) {
      throw unprocessable(
        resolved.reason === 'nonexistent_time' ? 'nonexistent_time' : 'invalid_time',
        TIME_ERROR_MESSAGES[resolved.reason],
        { field: 'localTime' },
      );
    }
    return { localTime: input.localTime, instant: resolved.instant };
  }

  function resolveItems(input: PlanInputParsed, purpose: VenuePurpose): Pick<PlanWrite, 'dishes' | 'candidates' | 'selectedRestaurant'> {
    if (input.mode === 'home') {
      const ids = unique(input.dishIds);
      if (ids.length === 0) throw unprocessable('no_items', '请至少选一道菜', { field: 'dishIds' });
      const found = new Map(catalog.getDishes(ids).map((d) => [d.id, d]));
      const unavailable = ids.filter((id) => !found.get(id)?.active);
      if (unavailable.length) {
        throw unprocessable('unavailable_items', '有菜品已经下架，请移除后再提交', { dishIds: unavailable });
      }
      // Frozen at save time: later catalog edits never change this plan.
      const dishes: DishSnapshot[] = ids.map((id) => snapshotOfDish(found.get(id)!));
      return { dishes, candidates: [], selectedRestaurant: null };
    }
    const ids = unique(input.candidateIds);
    if (ids.length === 0) throw unprocessable('no_items', '请至少添加一家候选餐厅', { field: 'candidateIds' });
    const found = new Map(catalog.getRestaurants(ids).map((r) => [r.id, r]));
    const unavailable = ids.filter((id) => !found.get(id)?.active);
    if (unavailable.length) {
      throw unprocessable('unavailable_items', '有餐厅已经下架，请移除后再提交', { restaurantIds: unavailable });
    }
    const incompatible = ids.filter((id) => !found.get(id)!.purposes.includes(purpose));
    if (incompatible.length) {
      throw unprocessable('incompatible_purpose', `有店铺不适合「${PURPOSE_LABEL[purpose]}」，请移除后再提交`, {
        restaurantIds: incompatible,
        purpose,
      });
    }
    if (!input.selectedRestaurantId || !ids.includes(input.selectedRestaurantId)) {
      throw unprocessable('invalid_selection', '请先从候选中确定一家餐厅', { field: 'selectedRestaurantId' });
    }
    const candidates: RestaurantSnapshot[] = ids.map((id) => snapshotOfRestaurant(found.get(id)!));
    const selectedRestaurant = candidates.find((c) => c.id === input.selectedRestaurantId)!;
    return { dishes: [], candidates, selectedRestaurant };
  }

  function buildWrite(input: PlanInputParsed, now: Date, stored: StoredPlan | null): PlanWrite {
    const purpose = resolvePurpose(input, stored);
    return {
      date: input.date,
      mealLabel: input.mealLabel,
      timeZone: input.timeZone,
      mode: input.mode,
      purpose,
      note: input.note,
      ...resolveTiming(input, now),
      ...resolveItems(input, purpose),
    };
  }

  function enqueue(planId: string, event: PlanEvent, now: Date) {
    const plan = plans.get(planId)!;
    const msg = buildPlanMessage(plan, event, deps.publicBaseUrl);
    notifications.enqueue(
      {
        planId,
        planVersion: plan.version,
        event,
        provider: deps.provider.name,
        recipients: deps.provider.listRecipients(),
        ...msg,
      },
      now,
    );
  }

  /** Runs `fn` and stores its response under the idempotency key, all in one transaction. */
  function idempotent(req: IdempotentRequest, fn: (now: Date) => StoredResponse): StoredResponse {
    const result = runIdempotent({ db, idempotency }, req, clock(), fn);
    if (!result.replayed) deps.onCommitted();
    return result.response;
  }

  function nextShortId(): string {
    for (let i = 0; i < 20; i += 1) {
      const id = shortCode();
      if (!plans.shortIdExists(id)) return id;
    }
    throw new Error('could not allocate short id');
  }

  function loadEditable(id: string, expectedVersion: number, now: Date): StoredPlan {
    const current = plans.get(id);
    if (!current) throw notFound('这个计划不存在');
    if (current.status !== 'active' || current.version !== expectedVersion) {
      throw conflict('version_conflict', '这个计划已在别处被修改或取消', { current: withNotification(current) });
    }
    if (isPastDate(current.date, current.timeZone, now)) {
      throw unprocessable('plan_locked', '已经过去的计划只能查看，不能修改');
    }
    return current;
  }

  return {
    list(opts: { from?: string; to?: string }): Plan[] {
      const rows = plans.list({ ...opts, limit: 1000 });
      const latest = notifications.latestForPlans(rows.map((p) => p.id));
      return rows.map((p) => ({ ...p, notification: latest.get(p.id) ?? null }));
    },

    get(id: string): Plan {
      const plan = plans.get(id);
      if (!plan) throw notFound('这个计划不存在');
      return withNotification(plan);
    },

    create(input: PlanInputParsed, req: IdempotentRequest): StoredResponse {
      return idempotent(req, (now) => {
        const write = buildWrite(input, now, null);
        const sourcePlanId = input.sourcePlanId && plans.get(input.sourcePlanId) ? input.sourcePlanId : null;
        const id = randomUUID();
        plans.insert({ id, shortId: nextShortId(), sourcePlanId, ...write }, now);
        enqueue(id, 'created', now);
        return { status: 201, body: withNotification(plans.get(id)!) };
      });
    },

    update(id: string, input: PlanInputParsed, expectedVersion: number, req: IdempotentRequest): StoredResponse {
      return idempotent(req, (now) => {
        const current = loadEditable(id, expectedVersion, now);
        const write = buildWrite(input, now, current);
        if (!plans.update(id, expectedVersion, write, now)) {
          throw conflict('version_conflict', '这个计划已在别处被修改', { current: withNotification(plans.get(id)!) });
        }
        deps.afterUpdate?.(plans.get(id)!, now);
        enqueue(id, 'updated', now);
        return { status: 200, body: withNotification(plans.get(id)!) };
      });
    },

    cancel(id: string, expectedVersion: number, req: IdempotentRequest): StoredResponse {
      return idempotent(req, (now) => {
        loadEditable(id, expectedVersion, now);
        if (!plans.cancel(id, expectedVersion, now)) {
          throw conflict('version_conflict', '这个计划已在别处被修改', { current: withNotification(plans.get(id)!) });
        }
        enqueue(id, 'cancelled', now);
        return { status: 200, body: withNotification(plans.get(id)!) };
      });
    },
  };
}

export type PlanService = ReturnType<typeof createPlanService>;
