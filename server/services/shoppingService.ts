import { randomUUID } from 'node:crypto';
import { SHOPPING_LIMITS } from '../../shared/constants.js';
import { applyShoppingStates, countShopping, reconcileShoppingStates, withShoppingStatus } from '../../shared/shopping.js';
import { isPastDate } from '../../shared/time.js';
import type { ShoppingList, ShoppingLockReason, ShoppingManualItem } from '../../shared/types.js';
import type { DB } from '../db/connection.js';
import { conflict, HttpError, notFound, unprocessable } from '../lib/errors.js';
import type { ManualItemInput, ShoppingExpected, ShoppingHaveBatchInput, ShoppingStatusInput } from '../lib/shoppingValidation.js';
import type { IdempotencyRepo, StoredResponse } from '../repos/misc.js';
import type { PlanRepo, StoredPlan } from '../repos/plans.js';
import type { ShoppingRepo, StoredShopping, ShoppingWrite } from '../repos/shopping.js';
import { runIdempotent, type IdempotentRequest } from './idempotent.js';
import { deriveForPlan } from './shoppingState.js';

export interface ShoppingServiceDeps {
  db: DB;
  plans: PlanRepo;
  shopping: ShoppingRepo;
  idempotency: IdempotencyRepo;
  clock: () => Date;
}

const LOCK_MESSAGES: Record<ShoppingLockReason, string> = {
  cancelled: '这一餐已经取消，采购清单只能查看',
  past: '这一餐已经过去，采购清单只能查看',
  restaurant: '去餐厅的计划没有采购清单',
};

function lockReason(plan: StoredPlan, now: Date): ShoppingLockReason | null {
  if (plan.mode !== 'home') return 'restaurant';
  if (plan.status !== 'active') return 'cancelled';
  if (isPastDate(plan.date, plan.timeZone, now)) return 'past';
  return null;
}

/**
 * Shared shopping checklist of a home meal. Reads never write: a plan without a stored row is
 * shown as all pending. Writes are explicit (never toggles), compare-and-set on both the meal
 * version and the independent shopping revision, never touch the plan row (version/updatedAt)
 * and never queue a notification.
 */
export function createShoppingService(deps: ShoppingServiceDeps) {
  const { db, plans, shopping, idempotency, clock } = deps;

  function view(plan: StoredPlan, stored: StoredShopping | null, now: Date): ShoppingList {
    const manual = plan.mode === 'home' ? (stored?.manual ?? []) : [];
    const derived = deriveForPlan(plan, manual);
    // Same rule as a plan update, applied in memory only: a stale state can never show as current.
    const states = reconcileShoppingStates(stored?.states ?? [], derived.groups);
    const items = applyShoppingStates(derived.groups, states);
    const reason = lockReason(plan, now);
    return {
      planId: plan.id,
      planVersion: plan.version,
      revision: stored?.revision ?? 0,
      writable: reason === null,
      lockReason: reason,
      items,
      manual,
      dishNotes: derived.dishNotes,
      dishesWithoutIngredients: plan.mode === 'home' ? derived.dishesWithoutIngredients : [],
      counts: countShopping(items),
      updatedAt: stored?.updatedAt ?? null,
    };
  }

  function loadPlan(planId: string): StoredPlan {
    const plan = plans.get(planId);
    if (!plan) throw notFound('这个计划不存在');
    return plan;
  }

  /** Locks, then meal version, then shopping revision; every refusal carries the current list. */
  function loadWritable(planId: string, expected: ShoppingExpected, now: Date) {
    const plan = loadPlan(planId);
    const stored = shopping.get(planId);
    const current = () => view(plan, stored, now);
    const reason = lockReason(plan, now);
    if (reason) throw unprocessable('shopping_locked', LOCK_MESSAGES[reason], { reason, current: current() });
    if (plan.version !== expected.expectedPlanVersion) {
      throw conflict('plan_changed', '这一餐刚在别处被修改，清单已刷新，请再确认一次', { current: current() });
    }
    if ((stored?.revision ?? 0) !== expected.expectedRevision) {
      throw conflict('shopping_conflict', '清单刚在别处更新，已刷新到最新内容，请再确认一次', { current: current() });
    }
    return { plan, stored };
  }

  /** Validated, revision-checked write of the next state, answered with the new list. */
  function write(
    planId: string,
    expected: ShoppingExpected,
    req: IdempotentRequest,
    status: 200 | 201,
    next: (plan: StoredPlan, stored: StoredShopping | null, now: Date) => ShoppingWrite,
  ): StoredResponse {
    return runIdempotent({ db, idempotency }, req, clock(), (now) => {
      const { plan, stored } = loadWritable(planId, expected, now);
      const w = next(plan, stored, now);
      // Every write re-reconciles against the groups it produces (e.g. a manual edit that changes a group).
      const states = reconcileShoppingStates(w.states, deriveForPlan(plan, w.manual).groups);
      if (!shopping.save(planId, expected.expectedRevision, { manual: w.manual, states }, now)) {
        throw conflict('shopping_conflict', '清单刚在别处更新，已刷新到最新内容，请再确认一次', {
          current: view(plan, shopping.get(planId), now),
        });
      }
      return { status, body: view(plan, shopping.get(planId), now) };
    }).response;
  }

  function findManual(stored: StoredShopping | null, manualId: string): ShoppingManualItem {
    const item = stored?.manual.find((m) => m.id === manualId);
    if (!item) throw new HttpError(404, 'manual_missing', '这条补充项已经不存在，清单已刷新');
    return item;
  }

  return {
    get(planId: string): ShoppingList {
      const plan = loadPlan(planId);
      return view(plan, shopping.get(planId), clock());
    },

    setStatus(planId: string, input: ShoppingStatusInput, req: IdempotentRequest): StoredResponse {
      return write(planId, input, req, 200, (plan, stored) => {
        const manual = stored?.manual ?? [];
        const { groups } = deriveForPlan(plan, manual);
        const group = groups.find((g) => g.key === input.key);
        if (!group) throw new HttpError(404, 'shopping_item_missing', '清单里没有这一项，清单已刷新');
        const states = reconcileShoppingStates(stored?.states ?? [], groups);
        return { manual, states: withShoppingStatus(states, group, input.status) };
      });
    },

    /**
     * Marks several pending groups 家里已有 in one revision. Every key must name a group that is
     * pending right now; one unknown or already-prepared key refuses the whole batch (with the
     * current list), so have/bought items are never overwritten and nothing is half-applied.
     */
    markHave(planId: string, input: ShoppingHaveBatchInput, req: IdempotentRequest): StoredResponse {
      return write(planId, input, req, 200, (plan, stored, now) => {
        const manual = stored?.manual ?? [];
        const { groups } = deriveForPlan(plan, manual);
        let states = reconcileShoppingStates(stored?.states ?? [], groups);
        const items = new Map(applyShoppingStates(groups, states).map((i) => [i.key, i]));
        const missingKeys = input.keys.filter((key) => !items.has(key));
        if (missingKeys.length) {
          throw new HttpError(404, 'shopping_item_missing', '有选中的食材已经不在清单里，清单已刷新，请重新核对', {
            missingKeys,
            current: view(plan, stored, now),
          });
        }
        const changedKeys = input.keys.filter((key) => items.get(key)?.status !== 'pending');
        if (changedKeys.length) {
          throw conflict('shopping_item_not_pending', '有选中的食材已经不是待采购，清单已刷新，请重新核对', {
            changedKeys,
            current: view(plan, stored, now),
          });
        }
        for (const key of input.keys) states = withShoppingStatus(states, groups.find((g) => g.key === key)!, 'have');
        return { manual, states };
      });
    },

    addManual(planId: string, input: ManualItemInput, req: IdempotentRequest): StoredResponse {
      return write(planId, input, req, 201, (_plan, stored, now) => {
        const manual = stored?.manual ?? [];
        if (manual.length >= SHOPPING_LIMITS.manualItems) {
          throw unprocessable('manual_limit', `每一餐最多补充 ${SHOPPING_LIMITS.manualItems} 项`);
        }
        const ts = now.toISOString();
        const item: ShoppingManualItem = {
          id: randomUUID(),
          name: input.name,
          quantity: input.quantity,
          note: input.note,
          createdAt: ts,
          updatedAt: ts,
        };
        return { manual: [...manual, item], states: stored?.states ?? [] };
      });
    },

    updateManual(planId: string, manualId: string, input: ManualItemInput, req: IdempotentRequest): StoredResponse {
      return write(planId, input, req, 200, (_plan, stored, now) => {
        const existing = findManual(stored, manualId);
        const updated = { ...existing, name: input.name, quantity: input.quantity, note: input.note, updatedAt: now.toISOString() };
        const manual = (stored?.manual ?? []).map((m) => (m.id === manualId ? updated : m));
        return { manual, states: stored?.states ?? [] };
      });
    },

    deleteManual(planId: string, manualId: string, input: ShoppingExpected, req: IdempotentRequest): StoredResponse {
      return write(planId, input, req, 200, (_plan, stored) => {
        findManual(stored, manualId);
        return { manual: (stored?.manual ?? []).filter((m) => m.id !== manualId), states: stored?.states ?? [] };
      });
    },
  };
}

export type ShoppingService = ReturnType<typeof createShoppingService>;
