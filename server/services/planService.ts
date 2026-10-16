import { randomUUID } from 'node:crypto';
import { isPastDate, isValidDateString, isValidTimeZone, resolveLocalDateTime, TIME_ERROR_MESSAGES } from '../../shared/time.js';
import type { DishSnapshot, Plan, PlanEvent, RestaurantSnapshot } from '../../shared/types.js';
import type { DB } from '../db/connection.js';
import { sha256, shortCode } from '../lib/crypto.js';
import { badRequest, conflict, HttpError, notFound, unprocessable } from '../lib/errors.js';
import type { PlanInputParsed } from '../lib/validation.js';
import { buildPlanMessage } from '../notify/message.js';
import type { NotificationProvider } from '../notify/types.js';
import type { CatalogRepo } from '../repos/catalog.js';
import type { IdempotencyRepo, StoredResponse } from '../repos/misc.js';
import type { NotificationRepo } from '../repos/notifications.js';
import type { PlanRepo, PlanWrite, StoredPlan } from '../repos/plans.js';

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
}

export interface IdempotentRequest {
  key: string;
  /** method + path + body, hashed to detect key reuse for a different request. */
  fingerprintSource: string;
}

const unique = (ids: string[]) => [...new Set(ids)];

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

  function resolveItems(input: PlanInputParsed): Pick<PlanWrite, 'dishes' | 'candidates' | 'selectedRestaurant'> {
    if (input.mode === 'home') {
      const ids = unique(input.dishIds);
      if (ids.length === 0) throw unprocessable('no_items', '请至少选一道菜', { field: 'dishIds' });
      const found = new Map(catalog.getDishes(ids).map((d) => [d.id, d]));
      const unavailable = ids.filter((id) => !found.get(id)?.active);
      if (unavailable.length) {
        throw unprocessable('unavailable_items', '有菜品已经下架，请移除后再提交', { dishIds: unavailable });
      }
      const dishes: DishSnapshot[] = ids.map((id) => {
        const d = found.get(id)!;
        return { id: d.id, name: d.name, category: d.category, imageAssetId: d.imageAssetId };
      });
      return { dishes, candidates: [], selectedRestaurant: null };
    }
    const ids = unique(input.candidateIds);
    if (ids.length === 0) throw unprocessable('no_items', '请至少添加一家候选餐厅', { field: 'candidateIds' });
    const found = new Map(catalog.getRestaurants(ids).map((r) => [r.id, r]));
    const unavailable = ids.filter((id) => !found.get(id)?.active);
    if (unavailable.length) {
      throw unprocessable('unavailable_items', '有餐厅已经下架，请移除后再提交', { restaurantIds: unavailable });
    }
    if (!input.selectedRestaurantId || !ids.includes(input.selectedRestaurantId)) {
      throw unprocessable('invalid_selection', '请先从候选中确定一家餐厅', { field: 'selectedRestaurantId' });
    }
    const candidates: RestaurantSnapshot[] = ids.map((id) => {
      const r = found.get(id)!;
      return {
        id: r.id,
        name: r.name,
        imageAssetId: r.imageAssetId,
        review: r.review,
        tags: [...r.tags],
        budgetText: r.budgetText,
        address: r.address,
        mapUrl: r.mapUrl,
        linkUrl: r.linkUrl,
        linkLabel: r.linkLabel,
      };
    });
    const selectedRestaurant = candidates.find((c) => c.id === input.selectedRestaurantId)!;
    return { dishes: [], candidates, selectedRestaurant };
  }

  function buildWrite(input: PlanInputParsed, now: Date): PlanWrite {
    return {
      date: input.date,
      mealLabel: input.mealLabel,
      timeZone: input.timeZone,
      mode: input.mode,
      note: input.note,
      ...resolveTiming(input, now),
      ...resolveItems(input),
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
    const now = clock();
    const fingerprint = sha256(req.fingerprintSource);
    const result = db.transaction(() => {
      const previous = idempotency.lookup(req.key, fingerprint);
      if (previous === 'mismatch') {
        throw new HttpError(422, 'idempotency_mismatch', '重复的请求编号，请刷新后重试');
      }
      if (previous) return { replayed: true, response: previous };
      const response = fn(now);
      idempotency.store(req.key, fingerprint, response, now);
      return { replayed: false, response };
    })();
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
        const write = buildWrite(input, now);
        const sourcePlanId = input.sourcePlanId && plans.get(input.sourcePlanId) ? input.sourcePlanId : null;
        const id = randomUUID();
        plans.insert({ id, shortId: nextShortId(), sourcePlanId, ...write }, now);
        enqueue(id, 'created', now);
        return { status: 201, body: withNotification(plans.get(id)!) };
      });
    },

    update(id: string, input: PlanInputParsed, expectedVersion: number, req: IdempotentRequest): StoredResponse {
      return idempotent(req, (now) => {
        loadEditable(id, expectedVersion, now);
        const write = buildWrite(input, now);
        if (!plans.update(id, expectedVersion, write, now)) {
          throw conflict('version_conflict', '这个计划已在别处被修改', { current: withNotification(plans.get(id)!) });
        }
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
