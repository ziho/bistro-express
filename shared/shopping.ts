import { SHOPPING_LIMITS } from './constants.js';
import { singleLineText } from './dish.js';
import type {
  DishIngredient,
  ShoppingDishNote,
  ShoppingItem,
  ShoppingManualItem,
  ShoppingSource,
  ShoppingStatus,
} from './types.js';

/**
 * Shared shopping checklist logic (采购清单), used by the editor preview, the saved list and the
 * server. Everything here is pure: no catalog lookups, no I/O.
 *
 * Grouping rule: two ingredient names are the same item only when they are equal after trimming,
 * collapsing whitespace and lower-casing English letters. Nothing else is merged — punctuation,
 * variants and synonyms stay separate (番茄 ≠ 西红柿, 嫩豆腐 ≠ 老豆腐). Free-text quantities are
 * never parsed, converted, summed or de-duplicated: each source keeps its own original value.
 */

export const SHOPPING_STATUSES = ['pending', 'have', 'bought'] as const satisfies readonly ShoppingStatus[];

export const SHOPPING_STATUS_LABELS: Readonly<Record<ShoppingStatus, string>> = {
  pending: '待采购',
  have: '家里已有',
  bought: '已买好',
};

export const isShoppingStatus = (v: unknown): v is ShoppingStatus =>
  typeof v === 'string' && (SHOPPING_STATUSES as readonly string[]).includes(v);

/** Group key of an ingredient name: trimmed, whitespace collapsed, English letters lower-cased. '' for blank. */
export function shoppingKey(name: string): string {
  return singleLineText(name).replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** The dish fields the checklist reads; a catalog dish and a frozen plan snapshot both fit. */
export interface ShoppingDishInput {
  id: string;
  name: string;
  ingredients: readonly DishIngredient[];
  shoppingNote: string;
}

export type ShoppingManualInput = Pick<ShoppingManualItem, 'id' | 'name' | 'quantity' | 'note'>;

/** A derived group before any saved status is applied. */
export interface ShoppingGroup {
  key: string;
  name: string;
  sources: ShoppingSource[];
  /**
   * Canonical, order-insensitive description of what this group requires: source identity
   * (dish id / manual id), free-text quantity, purchase note and the dish's overall shopping note.
   * Duplicate occurrences are kept. Display names and order are not part of it.
   */
  signature: string;
}

export interface ShoppingDerived {
  groups: ShoppingGroup[];
  dishNotes: ShoppingDishNote[];
  /** Names of dishes without any recorded main ingredient (including dishes that only have a note). */
  dishesWithoutIngredients: string[];
}

function sourceTuple(source: ShoppingSource, dishNotes: ReadonlyMap<string, string>): string {
  const tuple =
    source.kind === 'dish'
      ? ['dish', source.dishId, source.quantity, source.purchaseNote, dishNotes.get(source.dishId) ?? '']
      : ['manual', source.manualId, source.quantity, source.note];
  return JSON.stringify(tuple.map(singleLineText));
}

/** Order-insensitive requirement signature of one group's sources (see ShoppingGroup.signature). */
export function requirementSignature(sources: readonly ShoppingSource[], dishNotes: ReadonlyMap<string, string> = new Map()): string {
  return JSON.stringify(sources.map((s) => sourceTuple(s, dishNotes)).sort());
}

/**
 * Groups a meal's main ingredients and manual additions. Groups appear in order of first
 * appearance (dishes in meal order, rows in recipe order, then manual items in creation order);
 * within a group, recipe sources come first in the same order, then manual sources.
 */
export function deriveShopping(
  dishes: readonly ShoppingDishInput[],
  manual: readonly ShoppingManualInput[] = [],
): ShoppingDerived {
  const byKey = new Map<string, { key: string; name: string; sources: ShoppingSource[] }>();
  const add = (name: string, source: ShoppingSource) => {
    const key = shoppingKey(name);
    if (!key) return;
    const group = byKey.get(key);
    if (group) group.sources.push(source);
    else byKey.set(key, { key, name: singleLineText(name), sources: [source] });
  };

  const noteByDish = new Map<string, string>();
  const dishNotes: ShoppingDishNote[] = [];
  const dishesWithoutIngredients: string[] = [];
  for (const dish of dishes) {
    const note = dish.shoppingNote.trim();
    if (note) {
      noteByDish.set(dish.id, note);
      dishNotes.push({ dishId: dish.id, dishName: dish.name, note });
    }
    const rows = dish.ingredients.filter((row) => shoppingKey(row.name));
    if (rows.length === 0) dishesWithoutIngredients.push(dish.name);
    for (const row of rows) {
      add(row.name, {
        kind: 'dish',
        dishId: dish.id,
        dishName: dish.name,
        name: singleLineText(row.name),
        quantity: row.quantity.trim(),
        purchaseNote: row.purchaseNote.trim(),
      });
    }
  }
  for (const item of manual) {
    add(item.name, { kind: 'manual', manualId: item.id, name: singleLineText(item.name), quantity: item.quantity, note: item.note });
  }

  const groups = [...byKey.values()].map((g) => ({ ...g, signature: requirementSignature(g.sources, noteByDish) }));
  return { groups, dishNotes, dishesWithoutIngredients };
}

/** Saved status of one group, stored with the signature it was confirmed against. */
export interface ShoppingStateEntry {
  key: string;
  status: ShoppingStatus;
  signature: string;
  needsReview: boolean;
}

/**
 * Brings saved statuses in line with the current groups:
 * - a group that no longer exists loses its state (re-adding it later starts at pending);
 * - an unchanged signature keeps the state as is;
 * - a changed signature resets the group to pending, flagged needsReview when it had been
 *   marked have/bought (or was already waiting for review).
 * Pending entries without review carry no information and are dropped.
 */
export function reconcileShoppingStates(
  entries: readonly ShoppingStateEntry[],
  groups: readonly Pick<ShoppingGroup, 'key' | 'signature'>[],
): ShoppingStateEntry[] {
  const signatures = new Map(groups.map((g) => [g.key, g.signature]));
  const seen = new Set<string>();
  const result: ShoppingStateEntry[] = [];
  for (const entry of entries) {
    const signature = signatures.get(entry.key);
    if (signature === undefined || seen.has(entry.key)) continue;
    seen.add(entry.key);
    if (signature === entry.signature) {
      if (entry.status !== 'pending' || entry.needsReview) result.push({ ...entry });
    } else if (entry.status !== 'pending' || entry.needsReview) {
      result.push({ key: entry.key, status: 'pending', signature, needsReview: true });
    }
  }
  return result;
}

/** Explicitly sets one group's status (never a toggle); confirming also clears needsReview. */
export function withShoppingStatus(
  entries: readonly ShoppingStateEntry[],
  group: Pick<ShoppingGroup, 'key' | 'signature'>,
  status: ShoppingStatus,
): ShoppingStateEntry[] {
  const rest = entries.filter((e) => e.key !== group.key);
  return status === 'pending' ? rest : [...rest, { key: group.key, status, signature: group.signature, needsReview: false }];
}

/** Groups with their (already reconciled) saved status; groups without state are pending. */
export function applyShoppingStates(
  groups: readonly ShoppingGroup[],
  entries: readonly ShoppingStateEntry[],
): ShoppingItem[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return groups.map(({ key, name, sources }) => {
    const entry = byKey.get(key);
    return { key, name, sources, status: entry?.status ?? 'pending', needsReview: entry?.needsReview ?? false };
  });
}

/** Counts by distinct ingredient group. */
export function countShopping(items: readonly Pick<ShoppingItem, 'status'>[]): Record<ShoppingStatus, number> {
  const counts: Record<ShoppingStatus, number> = { pending: 0, have: 0, bought: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export type ManualField = 'name' | 'quantity' | 'note';

/** The manual-item form normalized the way the server stores it (trimmed, whitespace collapsed). */
export function normalizeManualFields(values: Record<ManualField, string>): Record<ManualField, string> {
  return { name: singleLineText(values.name), quantity: singleLineText(values.quantity), note: singleLineText(values.note) };
}

const MANUAL_FIELD_LABELS: Record<ManualField, string> = { name: '名称', quantity: '数量', note: '备注' };

/** Same rules as the server: name required, every field within its limit after normalizing; never truncated. */
export function manualItemErrors(values: Record<ManualField, string>): Partial<Record<ManualField, string>> {
  const v = normalizeManualFields(values);
  const errors: Partial<Record<ManualField, string>> = {};
  if (!v.name) errors.name = '请填写要买的东西';
  for (const field of ['name', 'quantity', 'note'] as const) {
    const max = SHOPPING_LIMITS[field];
    if (v[field].length > max) errors[field] = `${MANUAL_FIELD_LABELS[field]}不能超过 ${max} 个字`;
  }
  return errors;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Reads stored manual items of any quality; rows without an id or a name are skipped. */
export function readStoredManualItems(raw: unknown): ShoppingManualItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((entry): ShoppingManualItem[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const id = str(row.id);
    const name = singleLineText(str(row.name));
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        name,
        quantity: str(row.quantity),
        note: str(row.note),
        createdAt: str(row.createdAt),
        updatedAt: str(row.updatedAt),
      },
    ];
  });
}

/** Reads stored state entries of any quality; malformed entries are skipped. */
export function readStoredShoppingStates(raw: unknown): ShoppingStateEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): ShoppingStateEntry[] => {
    if (!entry || typeof entry !== 'object') return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== 'string' || !e.key || !isShoppingStatus(e.status) || typeof e.signature !== 'string') return [];
    return [{ key: e.key, status: e.status, signature: e.signature, needsReview: e.needsReview === true }];
  });
}
