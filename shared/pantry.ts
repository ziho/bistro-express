import { PANTRY_LIMITS } from './constants.js';
import { singleLineText } from './dish.js';
import { shoppingKey } from './shopping.js';
import type { DishIngredient, ShoppingStatus } from './types.js';

/**
 * 按现有食材找菜: what one device remembers as "already at home", and how dishes and shopping
 * groups compare against it. Everything here is pure; storage lives in the browser only.
 *
 * Matching rule: a name matches when it is equal after trimming, collapsing whitespace and
 * lower-casing English letters (the shopping key), or when both names sit in the same explicit,
 * unambiguous synonym group below. There is no substring, fuzzy or guessed matching: 嫩豆腐 ≠
 * 豆腐 ≠ 老豆腐, 牛肉 ≠ 肥牛, 辣椒 ≠ 小米辣. Aliases only decide whether something matches; they never
 * rename, merge or re-key shopping items, statuses or saved snapshots.
 */

/** Each group names exactly one ingredient. Keep it short and unambiguous; the first name is canonical. */
export const INGREDIENT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['番茄', '西红柿'],
  ['土豆', '马铃薯'],
  ['西兰花', '青花菜'],
  ['香菜', '芫荽'],
  ['卷心菜', '圆白菜', '包菜'],
  ['黄瓜', '青瓜'],
  ['荸荠', '马蹄'],
];

const ALIAS_CANONICAL: ReadonlyMap<string, string> = new Map(
  INGREDIENT_ALIAS_GROUPS.flatMap((group) => group.map((name) => [shoppingKey(name), shoppingKey(group[0] ?? name)] as const)),
);

/** Comparison key: the shopping key, mapped to its synonym group's canonical name when it has one. */
export function pantryMatchKey(name: string): string {
  const key = shoppingKey(name);
  return ALIAS_CANONICAL.get(key) ?? key;
}

/** True when two names count as the same ingredient for the pantry finder. */
export const sameIngredient = (a: string, b: string): boolean => {
  const key = pantryMatchKey(a);
  return key !== '' && key === pantryMatchKey(b);
};

// ---------- The remembered list ----------

export interface Pantry {
  /** Display names exactly as entered (normalized whitespace), in the order they were added. */
  names: string[];
  /** ISO time of the last change on this device; null for a list that was never saved. */
  updatedAt: string | null;
}

export const PANTRY_STORAGE_KEY = 'bx:pantry';
export const PANTRY_VERSION = 1;
export const EMPTY_PANTRY: Pantry = Object.freeze({ names: [], updatedAt: null }) as Pantry;

export type PantryRead = { status: 'empty' | 'ok'; pantry: Pantry } | { status: 'corrupt'; pantry: Pantry };

const isIsoTime = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Strictly validates a stored list. Anything unexpected is reported as corrupt (and shown as empty), never half-read. */
export function readPantry(raw: string | null): PantryRead {
  if (raw === null || raw === '') return { status: 'empty', pantry: EMPTY_PANTRY };
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { status: 'corrupt', pantry: EMPTY_PANTRY };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt', pantry: EMPTY_PANTRY };
  const doc = value as Record<string, unknown>;
  const names = doc.names;
  if (doc.v !== PANTRY_VERSION || !Array.isArray(names) || names.length > PANTRY_LIMITS.names || !isIsoTime(doc.updatedAt)) {
    return { status: 'corrupt', pantry: EMPTY_PANTRY };
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string') return { status: 'corrupt', pantry: EMPTY_PANTRY };
    const normalized = singleLineText(name);
    const key = shoppingKey(normalized);
    if (!key || normalized !== name || normalized.length > PANTRY_LIMITS.name || seen.has(key)) {
      return { status: 'corrupt', pantry: EMPTY_PANTRY };
    }
    seen.add(key);
  }
  return { status: 'ok', pantry: { names: [...(names as string[])], updatedAt: doc.updatedAt } };
}

export function serializePantry(pantry: Pantry): string {
  return JSON.stringify({ v: PANTRY_VERSION, names: pantry.names, updatedAt: pantry.updatedAt });
}

/** Comma, Chinese comma, 顿号, semicolons and line breaks separate names. */
const SEPARATORS = /[,，、;；\r\n]+/;

/** Non-blank, whitespace-normalized names of a typed or pasted text, in order. */
export function splitPantryInput(text: string): string[] {
  return text.split(SEPARATORS).map(singleLineText).filter(Boolean);
}

export type PantryProblemReason = 'too_long' | 'full' | 'paste_too_long';

export interface PantryProblem {
  value: string;
  reason: PantryProblemReason;
}

export interface PantryAddResult {
  pantry: Pantry;
  added: string[];
  /** Already on the list (same shopping key). */
  duplicates: string[];
  /** Refused, never truncated: the caller keeps them in the input. */
  rejected: PantryProblem[];
}

export const PANTRY_PROBLEM_TEXT: Readonly<Record<PantryProblemReason, string>> = {
  too_long: `超过 ${PANTRY_LIMITS.name} 个字`,
  full: `已经记了 ${PANTRY_LIMITS.names} 样，先删掉一些`,
  paste_too_long: `一次最多粘贴 ${PANTRY_LIMITS.pasteChars} 个字`,
};

/** Adds every acceptable name of `text`; over-long names and names beyond the limit are refused, not cut. */
export function addToPantry(pantry: Pantry, text: string, now: Date): PantryAddResult {
  if (text.length > PANTRY_LIMITS.pasteChars) {
    return { pantry, added: [], duplicates: [], rejected: [{ value: text, reason: 'paste_too_long' }] };
  }
  const seen = new Set(pantry.names.map(shoppingKey));
  const added: string[] = [];
  const duplicates: string[] = [];
  const rejected: PantryProblem[] = [];
  for (const value of splitPantryInput(text)) {
    const key = shoppingKey(value);
    if (value.length > PANTRY_LIMITS.name) rejected.push({ value, reason: 'too_long' });
    else if (seen.has(key)) duplicates.push(value);
    else if (pantry.names.length + added.length >= PANTRY_LIMITS.names) rejected.push({ value, reason: 'full' });
    else {
      seen.add(key);
      added.push(value);
    }
  }
  const next = added.length ? { names: [...pantry.names, ...added], updatedAt: now.toISOString() } : pantry;
  return { pantry: next, added, duplicates, rejected };
}

export function removeFromPantry(pantry: Pantry, name: string, now: Date): Pantry {
  const key = shoppingKey(name);
  const names = pantry.names.filter((n) => shoppingKey(n) !== key);
  return names.length === pantry.names.length ? pantry : { names, updatedAt: now.toISOString() };
}

export function clearPantry(now: Date): Pantry {
  return { names: [], updatedAt: now.toISOString() };
}

/** The match keys of a remembered list (aliases folded). */
export function pantryKeySet(names: readonly string[]): Set<string> {
  return new Set(names.map(pantryMatchKey).filter(Boolean));
}

/** Distinct ingredient names recorded in the catalog (first spelling wins), for input suggestions. */
export function catalogIngredientNames(dishes: readonly { ingredients: readonly DishIngredient[] }[]): string[] {
  const byKey = new Map<string, string>();
  for (const dish of dishes) {
    for (const row of dish.ingredients) {
      const key = shoppingKey(row.name);
      if (key && !byKey.has(key)) byKey.set(key, singleLineText(row.name));
    }
  }
  return [...byKey.values()];
}

/**
 * Suggestions for the name being typed (the text after the last separator). Substring matching is
 * fine here: it only offers catalog names to pick, it never decides whether a dish matches.
 */
export function pantrySuggestions(catalogNames: readonly string[], input: string, pantry: Pantry, max = 8): string[] {
  const segments = input.split(SEPARATORS);
  const needle = shoppingKey(segments[segments.length - 1] ?? '');
  if (!needle) return [];
  const have = new Set(pantry.names.map(shoppingKey));
  const hits = catalogNames.filter((name) => {
    const key = shoppingKey(name);
    return !have.has(key) && key.includes(needle);
  });
  const starts = hits.filter((name) => shoppingKey(name).startsWith(needle));
  return [...starts, ...hits.filter((name) => !starts.includes(name))].slice(0, max);
}

// ---------- Matching dishes ----------

/** One distinct main ingredient of a dish, with every original row (quantities and notes untouched). */
export interface IngredientKind {
  key: string;
  /** The first row's name as recorded. */
  name: string;
  rows: DishIngredient[];
}

export type PantryMatchState = 'ready' | 'missing' | 'unknown';

export interface PantryMatch {
  /** ready = every recorded main ingredient is on the list; unknown = the dish records none. */
  state: PantryMatchState;
  matched: IngredientKind[];
  missing: IngredientKind[];
}

/** Compares a dish's recorded main ingredients (by kind) with the remembered names. Quantities are never checked. */
export function matchDishIngredients(ingredients: readonly DishIngredient[], have: ReadonlySet<string>): PantryMatch {
  const kinds = new Map<string, IngredientKind>();
  for (const row of ingredients) {
    const key = pantryMatchKey(row.name);
    if (!key) continue;
    const kind = kinds.get(key);
    if (kind) kind.rows.push({ ...row });
    else kinds.set(key, { key, name: singleLineText(row.name), rows: [{ ...row }] });
  }
  const all = [...kinds.values()];
  const matched = all.filter((k) => have.has(k.key));
  const missing = all.filter((k) => !have.has(k.key));
  const state: PantryMatchState = all.length === 0 ? 'unknown' : missing.length === 0 ? 'ready' : 'missing';
  return { state, matched, missing };
}

export const PANTRY_FILTERS = ['all', 'ready', 'missing1', 'missing2', 'unknown'] as const;
export type PantryFilter = (typeof PANTRY_FILTERS)[number];

export const PANTRY_FILTER_LABELS: Readonly<Record<PantryFilter, string>> = {
  all: '全部',
  ready: '主料齐了',
  missing1: '还缺 1 种',
  missing2: '还缺 2 种',
  unknown: '暂时无法判断',
};

export function matchesPantryFilter(match: PantryMatch, filter: PantryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'ready':
      return match.state === 'ready';
    case 'missing1':
      return match.state === 'missing' && match.missing.length === 1;
    case 'missing2':
      return match.state === 'missing' && match.missing.length === 2;
    case 'unknown':
      return match.state === 'unknown';
  }
}

export function countPantryFilters(matches: readonly PantryMatch[]): Record<PantryFilter, number> {
  const counts = Object.fromEntries(PANTRY_FILTERS.map((f) => [f, 0])) as Record<PantryFilter, number>;
  for (const match of matches) for (const filter of PANTRY_FILTERS) if (matchesPantryFilter(match, filter)) counts[filter] += 1;
  return counts;
}

/** Recorded total time within `max` minutes. A dish without a recorded time never passes a time limit. */
export function withinTotalMinutes(totalMinutes: number | null, max: number | null): boolean {
  if (max === null) return true;
  return totalMinutes !== null && totalMinutes <= max;
}

function tier(match: PantryMatch): number {
  if (match.state === 'ready') return 0;
  if (match.state === 'unknown') return 3;
  return match.matched.length > 0 ? 1 : 2;
}

/**
 * Ready dishes first, then by fewest missing kinds and most matched kinds; dishes without any
 * hit come after those with hits, and dishes without recorded ingredients last. Ties keep the
 * catalog order.
 */
export function rankByPantryMatch<T>(items: readonly T[], matchOf: (item: T) => PantryMatch): T[] {
  return items
    .map((item, index) => ({ item, index, match: matchOf(item) }))
    .sort(
      (a, b) =>
        tier(a.match) - tier(b.match) ||
        a.match.missing.length - b.match.missing.length ||
        b.match.matched.length - a.match.matched.length ||
        a.index - b.index,
    )
    .map((entry) => entry.item);
}

// ---------- Shopping ----------

/** Splits shopping groups (keys unchanged) into "maybe at home" and "still to buy". Nothing is written. */
export function splitShoppingByPantry<G extends { key: string }>(groups: readonly G[], have: ReadonlySet<string>): { maybeHave: G[]; need: G[] } {
  const maybeHave = groups.filter((g) => have.has(pantryMatchKey(g.key)));
  return { maybeHave, need: groups.filter((g) => !maybeHave.includes(g)) };
}

/** Pending items of a saved list that the remembered names suggest might be at home. */
export function pantryCandidates<I extends { key: string; status: ShoppingStatus }>(items: readonly I[], have: ReadonlySet<string>): I[] {
  return items.filter((i) => i.status === 'pending' && have.has(pantryMatchKey(i.key)));
}
