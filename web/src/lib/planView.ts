import { isPastDate, toViewerTime } from '../../../shared/time';
import type { Catalog, Plan } from '../../../shared/types';
import { outingKind } from '../../../shared/venue';
import { emptyDraft, newDraftKey, viewerTimeZone, type Draft } from './drafts';

export function planDisplay(plan: Plan) {
  return toViewerTime(plan, viewerTimeZone());
}

export function isEditable(plan: Plan): boolean {
  return plan.status === 'active' && !isPastDate(plan.date, plan.timeZone);
}

export function planItemsText(plan: Plan): string {
  if (plan.mode === 'home') return plan.dishes.map((d) => d.name).join('、') || '还没选菜';
  return plan.selectedRestaurant?.name ?? (outingKind(plan) === 'treat' ? '还没定去哪家' : '还没定餐厅');
}

/**
 * "再来一顿": clone into a fresh local draft (same outing, incl. a treat), dropping items that are no
 * longer available or no longer serve that purpose.
 */
export function cloneToDraft(plan: Plan, catalog: Catalog, date: string): { draft: Draft; dropped: string[] } {
  const purpose = outingKind(plan) === 'treat' ? 'treat' : 'meal';
  const activeDishes = new Set(catalog.dishes.map((d) => d.id));
  const activeRestaurants = new Set(catalog.restaurants.filter((r) => r.purposes.includes(purpose)).map((r) => r.id));
  const dropped: string[] = [];
  const dishIds = plan.dishes.filter((d) => activeDishes.has(d.id) || (dropped.push(d.name), false)).map((d) => d.id);
  const candidateIds = plan.candidates
    .filter((c) => activeRestaurants.has(c.id) || (dropped.push(c.name), false))
    .map((c) => c.id);
  const draft: Draft = {
    ...emptyDraft(newDraftKey(), date),
    mealLabel: plan.mealLabel,
    localTime: plan.localTime ?? '',
    mode: plan.mode,
    purpose,
    note: plan.note,
    dishIds,
    candidateIds,
    selectedRestaurantId: null,
    sourcePlanId: plan.id,
  };
  return { draft, dropped };
}
