import {
  countPantryFilters,
  matchDishIngredients,
  matchesPantryFilter,
  rankByPantryMatch,
  withinTotalMinutes,
  type PantryFilter,
  type PantryMatch,
} from '../../../shared/pantry';
import type { Dish } from '../../../shared/types';

/** Recorded total-time limits offered next to the pantry filters (minutes). */
export const TOTAL_TIME_OPTIONS = [30, 60, 90] as const;

export interface PantryFinderResult {
  /** Dishes passing the pantry and time filters, ranked by how well they match. */
  visible: Dish[];
  matches: ReadonlyMap<string, PantryMatch>;
  /** Per pantry filter, among the dishes that pass the time filter. */
  counts: Record<PantryFilter, number>;
}

/**
 * Applied after the normal search / section / tag / selected filters, so those keep working.
 * Only used while the finder is open and the pantry has names: an empty pantry never claims a
 * dish is ready and never hides anything.
 */
export function applyPantryFinder(
  dishes: readonly Dish[],
  have: ReadonlySet<string>,
  filter: PantryFilter,
  maxMinutes: number | null,
): PantryFinderResult {
  const matches = new Map(dishes.map((d) => [d.id, matchDishIngredients(d.ingredients, have)]));
  const matchOf = (d: Dish) => matches.get(d.id)!;
  const timed = dishes.filter((d) => withinTotalMinutes(d.totalMinutes, maxMinutes));
  const visible = rankByPantryMatch(
    timed.filter((d) => matchesPantryFilter(matchOf(d), filter)),
    matchOf,
  );
  return { visible, matches, counts: countPantryFilters(timed.map(matchOf)) };
}

/** Short status text of a match, e.g. 主料齐了 / 还缺 2 种 / 暂时无法判断. */
export function pantryMatchLabel(match: PantryMatch): string {
  if (match.state === 'ready') return '主料齐了';
  if (match.state === 'unknown') return '暂时无法判断';
  return `还缺 ${match.missing.length} 种`;
}

/** "上次更新 10月17日 18:05" style text in the viewer's locale; '' when never saved. */
export function pantryUpdatedText(updatedAt: string | null): string {
  if (!updatedAt) return '';
  const time = new Date(updatedAt);
  if (Number.isNaN(time.getTime())) return '';
  return time.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
