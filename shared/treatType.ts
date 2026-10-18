import type { TreatType, VenuePurpose } from './types.js';

/**
 * Legacy drinks / dessert vocabulary, retained for migration, older API clients, remembered
 * filters and historical snapshots. Current forms and filtering only expose unified venue tags.
 *
 * - Migration 8 inferred initial types only from exact tags; migration 9 merges the saved type
 *   choices into tags. Live compatibility types are now derived from those tags (venueTags.ts).
 * - Stored plan snapshots keep their original values. No inference from names or addresses.
 */

export const TREAT_TYPES = ['milk_tea', 'coffee', 'tong_sui', 'ice_cream', 'cake', 'bakery', 'other'] as const satisfies readonly TreatType[];

export const TREAT_TYPE_LABEL: Record<TreatType, string> = {
  milk_tea: '奶茶',
  coffee: '咖啡',
  tong_sui: '糖水／甜品',
  ice_cream: '雪糕',
  cake: '蛋糕',
  bakery: '面包／烘焙',
  other: '其他',
};

/** Filter value for treat venues without any type. Not a storable type. */
export const UNCLASSIFIED_TREAT = 'unclassified';
export const UNCLASSIFIED_TREAT_LABEL = '未分类';

/** A filter criterion: one type, or 未分类. */
export type TreatTypeFilter = TreatType | typeof UNCLASSIFIED_TREAT;

export const isTreatType = (value: unknown): value is TreatType => TREAT_TYPES.includes(value as TreatType);

export const isTreatTypeFilter = (value: unknown): value is TreatTypeFilter => value === UNCLASSIFIED_TREAT || isTreatType(value);

/** Canonical list: known values only, de-duplicated, in TREAT_TYPES order. */
export function normalizeTreatTypes(list: readonly unknown[]): TreatType[] {
  return TREAT_TYPES.filter((t) => list.includes(t));
}

/** Stored types of any age or quality (missing column value, old snapshot, corrupt JSON) — never guessed. */
export function readStoredTreatTypes(raw: unknown): TreatType[] {
  return Array.isArray(raw) ? normalizeTreatTypes(raw) : [];
}

export const treatTypeLabel = (t: TreatTypeFilter) => (t === UNCLASSIFIED_TREAT ? UNCLASSIFIED_TREAT_LABEL : TREAT_TYPE_LABEL[t]);

export const treatTypesText = (types: readonly TreatType[]) => types.map((t) => TREAT_TYPE_LABEL[t]).join(' · ');

/**
 * Exact tags (compared trimmed, Latin letters case-insensitive) that name a type, including
 * simplified / traditional spellings. 其他 is never inferred.
 */
const KNOWN_TAGS: Record<Exclude<TreatType, 'other'>, readonly string[]> = {
  milk_tea: ['奶茶', '奶茶店', '珍珠奶茶', '珍奶', '波霸奶茶', 'milk tea', 'bubble tea', 'boba'],
  coffee: ['咖啡', '咖啡店', '咖啡馆', '咖啡館', '咖啡厅', '咖啡廳', 'coffee', 'cafe', 'café'],
  tong_sui: ['糖水／甜品', '糖水', '糖水铺', '糖水舖', '甜品', '甜品店', '甜点', '甜點', 'dessert', 'desserts'],
  ice_cream: ['雪糕', '冰淇淋', '冰激凌', '霜淇淋', 'ice cream', 'gelato'],
  cake: ['蛋糕', '蛋糕店', 'cake', 'cakes'],
  bakery: ['面包／烘焙', '面包', '麵包', '面包店', '麵包店', '面包房', '麵包房', '烘焙', '烘焙店', '西饼', '西餅', 'bakery'],
};

const TAG_TO_TYPE = new Map<string, TreatType>(
  Object.entries(KNOWN_TAGS).flatMap(([type, tags]) => tags.map((tag) => [tag.toLowerCase(), type as TreatType] as const)),
);

/** Types named exactly by `tags` (no substring matching: 奶茶拿铁 or 咖啡色 name nothing). */
export function inferTreatTypes(tags: readonly string[]): TreatType[] {
  return normalizeTreatTypes(tags.flatMap((tag) => TAG_TO_TYPE.get(tag.trim().toLowerCase()) ?? []));
}

const servesTreat = (venue: { purposes: readonly VenuePurpose[] }) => venue.purposes.includes('treat');

/**
 * The type criterion of a filter. Empty = no criterion. Otherwise only treat venues can match:
 * 'any' needs one wanted type (未分类 = no type at all), 'all' needs every wanted one.
 */
export function matchesTreatTypes(
  venue: { purposes: readonly VenuePurpose[]; treatTypes: readonly TreatType[] },
  wanted: readonly TreatTypeFilter[],
  mode: 'any' | 'all' = 'any',
): boolean {
  if (wanted.length === 0) return true;
  if (!servesTreat(venue)) return false;
  const has = (t: TreatTypeFilter) => (t === UNCLASSIFIED_TREAT ? venue.treatTypes.length === 0 : venue.treatTypes.includes(t));
  return mode === 'all' ? wanted.every(has) : wanted.some(has);
}

export interface TreatTypeChoice {
  value: TreatTypeFilter;
  label: string;
  count: number;
}

/**
 * Types in use among the treat venues of `venues` (the whole supplied catalog, never one page),
 * in TREAT_TYPES order, then 未分类 when some treat venue has no type.
 */
export function treatTypeChoices(venues: readonly { purposes: readonly VenuePurpose[]; treatTypes: readonly TreatType[] }[]): TreatTypeChoice[] {
  const treats = venues.filter(servesTreat);
  const typed = TREAT_TYPES.map((t) => ({ value: t as TreatTypeFilter, label: TREAT_TYPE_LABEL[t], count: treats.filter((v) => v.treatTypes.includes(t)).length }));
  const unclassified = treats.filter((v) => v.treatTypes.length === 0).length;
  return [
    ...typed.filter((c) => c.count > 0),
    ...(unclassified ? [{ value: UNCLASSIFIED_TREAT as TreatTypeFilter, label: UNCLASSIFIED_TREAT_LABEL, count: unclassified }] : []),
  ];
}
