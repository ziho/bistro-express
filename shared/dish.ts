import { DISH_LIMITS, SUGGESTED_MENU_SECTIONS } from './constants.js';
import { isSafeExternalUrl } from './restaurant.js';
import type { Dish, DishDetails, DishIngredient, DishSnapshot } from './types.js';

/** Single-line label: trimmed, with line breaks and runs of spaces collapsed to one space. */
export const singleLineText = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Trimmed, de-duplicated, non-blank sections in their original order. */
export function normalizeSections(list: readonly string[]): string[] {
  return [...new Set(list.map(singleLineText).filter(Boolean))];
}

/** A legacy single category as sections: exactly one preserved section, or none when blank. Never split. */
export function legacySections(category: unknown): string[] {
  return typeof category === 'string' ? normalizeSections([category]) : [];
}

/** Reads stored sections (column JSON or snapshot) of any quality; non-strings are skipped. */
export function readStoredSections(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return normalizeSections(raw.filter((s): s is string => typeof s === 'string'));
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Reads stored ingredient rows of any quality: rows without a string name are skipped. */
export function readStoredIngredients(raw: unknown): DishIngredient[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): DishIngredient[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const name = str(row.name).trim();
    return name ? [{ name, quantity: str(row.quantity).trim(), purchaseNote: str(row.purchaseNote).trim() }] : [];
  });
}

export const isValidMinutes = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= DISH_LIMITS.maxMinutes;

/** A stored minute value, or null when missing or invalid. Zero stays zero. */
export function readMinutes(raw: unknown): number | null {
  return isValidMinutes(raw) ? raw : null;
}

/** Cross-field rule for 总耗时 / 动手时间; either may be missing. */
export function dishTimeError(totalMinutes: number | null, activeMinutes: number | null): string | null {
  if (totalMinutes !== null && activeMinutes !== null && activeMinutes > totalMinutes) return '动手时间不能超过总耗时';
  return null;
}

export const EMPTY_DISH_DETAILS: Readonly<DishDetails> = Object.freeze({
  sections: [],
  ingredients: [],
  totalMinutes: null,
  activeMinutes: null,
  servingText: '',
  shoppingNote: '',
});

/**
 * Reads a stored dish snapshot of any age without touching the stored JSON or the current
 * catalog. Snapshots saved before the dish details existed have no `sections`: their old
 * category (if any) becomes the one section. An explicit `sections` array — even an empty one —
 * is used as is, so a cleared section never comes back from a stale category.
 */
export function readDishSnapshot(raw: unknown): DishSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const sections = Array.isArray(s.sections) ? readStoredSections(s.sections) : legacySections(s.category);
  return {
    id: str(s.id),
    name: str(s.name),
    category: sections[0] ?? '',
    sections,
    imageAssetId: typeof s.imageAssetId === 'string' && s.imageAssetId ? s.imageAssetId : null,
    tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
    description: str(s.description),
    recipeUrl: typeof s.recipeUrl === 'string' && s.recipeUrl ? s.recipeUrl : null,
    ingredients: readStoredIngredients(s.ingredients),
    totalMinutes: readMinutes(s.totalMinutes),
    activeMinutes: readMinutes(s.activeMinutes),
    servingText: str(s.servingText),
    shoppingNote: str(s.shoppingNote),
  };
}

export function readDishSnapshots(raw: unknown): DishSnapshot[] {
  return Array.isArray(raw) ? raw.map(readDishSnapshot).filter((s): s is DishSnapshot => s !== null) : [];
}

/** Deep copy of the dish fields frozen into a plan when it is saved. */
export function snapshotOfDish(d: Dish): DishSnapshot {
  return {
    id: d.id,
    name: d.name,
    category: d.sections[0] ?? '',
    sections: [...d.sections],
    imageAssetId: d.imageAssetId,
    tags: [...d.tags],
    description: d.description,
    recipeUrl: d.recipeUrl,
    ingredients: d.ingredients.map((i) => ({ ...i })),
    totalMinutes: d.totalMinutes,
    activeMinutes: d.activeMinutes,
    servingText: d.servingText,
    shoppingNote: d.shoppingNote,
  };
}

/** 90 → "1 小时 30 分钟"; 0 → "0 分钟". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

/** Compact time text for cards, e.g. "共 40 分钟 · 动手 15 分钟"; '' when neither is recorded. */
export function dishTimeText(d: Pick<DishDetails, 'totalMinutes' | 'activeMinutes'>): string {
  const parts: string[] = [];
  if (d.totalMinutes !== null) parts.push(`共 ${formatMinutes(d.totalMinutes)}`);
  if (d.activeMinutes !== null) parts.push(`动手 ${formatMinutes(d.activeMinutes)}`);
  return parts.join(' · ');
}

/** Time and serving on one line; '' when neither is recorded. */
export function dishFactsText(d: Pick<DishDetails, 'totalMinutes' | 'activeMinutes' | 'servingText'>): string {
  return [dishTimeText(d), d.servingText].filter(Boolean).join(' · ');
}

/** Short main-ingredient line for cards: "鸡腿、土豆、青椒 等 5 样"; '' without ingredients. */
export function dishIngredientLine(ingredients: readonly DishIngredient[], max = 4): string {
  if (ingredients.length === 0) return '';
  const names = ingredients.slice(0, max).map((i) => i.name).join('、');
  return ingredients.length > max ? `${names} 等 ${ingredients.length} 样` : names;
}

/** The recipe link only when it is safe to render as an anchor. */
export function safeRecipeUrl(url: string | null): string | null {
  return url && isSafeExternalUrl(url) ? url : null;
}

/**
 * True when a dish has details beyond its one-line summary (name, sections, ingredient names,
 * time, serving): ingredient quantities/notes, purchase note, description, recipe link or tags.
 */
export function hasDishExtras(
  d: Pick<DishDetails, 'ingredients' | 'shoppingNote'> & { description: string; recipeUrl: string | null; tags: string[] },
): boolean {
  return (
    d.ingredients.length > 0 ||
    Boolean(d.shoppingNote || d.description || safeRecipeUrl(d.recipeUrl)) ||
    d.tags.length > 0
  );
}

/** Every dish field that search matches against: name, sections, tags, description and recorded ingredients. */
export function dishSearchFields(d: Pick<Dish, 'name' | 'sections' | 'tags' | 'description' | 'ingredients'>): string[] {
  return [d.name, d.description, ...d.sections, ...d.tags, ...d.ingredients.flatMap((i) => [i.name, i.purchaseNote])];
}

const SUGGESTED: readonly string[] = SUGGESTED_MENU_SECTIONS;

/** Suggested sections first (in their fixed order), then any other section sorted for Chinese. */
export function orderSections(sections: Iterable<string>): string[] {
  const unique = normalizeSections([...sections]);
  const suggested = SUGGESTED.filter((s) => unique.includes(s));
  const others = unique.filter((s) => !SUGGESTED.includes(s)).sort((a, b) => a.localeCompare(b, 'zh'));
  return [...suggested, ...others];
}
