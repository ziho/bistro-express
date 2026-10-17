import { deriveShopping, reconcileShoppingStates, type ShoppingDerived } from '../../shared/shopping.js';
import type { ShoppingManualItem } from '../../shared/types.js';
import { sha256 } from '../lib/crypto.js';
import type { StoredPlan } from '../repos/plans.js';
import type { ShoppingRepo } from '../repos/shopping.js';

const EMPTY: ShoppingDerived = { groups: [], dishNotes: [], dishesWithoutIngredients: [] };

/**
 * The checklist groups of a saved plan, read only from its frozen dish snapshots (never the
 * current catalog) plus the meal's manual items. Restaurant meals have no checklist. Signatures
 * are stored hashed so the side table stays small.
 */
export function deriveForPlan(plan: StoredPlan, manual: readonly ShoppingManualItem[]): ShoppingDerived {
  if (plan.mode !== 'home') return EMPTY;
  const derived = deriveShopping(plan.dishes, manual);
  return { ...derived, groups: derived.groups.map((g) => ({ ...g, signature: sha256(g.signature) })) };
}

/**
 * Runs in the same transaction as a plan update. Plans that never had a checklist write keep no
 * row (their list is all pending anyway). Otherwise statuses are reconciled against the new
 * snapshot: removed groups lose their state, changed requirements reset to pending, unchanged
 * ones are kept. Switching to a restaurant clears manual items and statuses for good.
 */
export function syncShoppingAfterPlanWrite(repo: ShoppingRepo, plan: StoredPlan, now: Date): void {
  const stored = repo.get(plan.id);
  if (!stored) return;
  const manual = plan.mode === 'home' ? stored.manual : [];
  const states = reconcileShoppingStates(stored.states, deriveForPlan(plan, manual).groups);
  if (!repo.save(plan.id, stored.revision, { manual, states }, now)) {
    throw new Error(`shopping list of plan ${plan.id} changed during a plan update`);
  }
}
