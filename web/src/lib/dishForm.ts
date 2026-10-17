import { DISH_LIMITS } from '../../../shared/constants';
import { dishTimeError, normalizeSections, singleLineText } from '../../../shared/dish';
import type { DishDetails, DishIngredient } from '../../../shared/types';

/** One row of the main-ingredient editor. `key` is stable for the row's lifetime (React key, ids, focus). */
export interface IngredientRow {
  key: string;
  name: string;
  quantity: string;
  purchaseNote: string;
}

export type IngredientRowError = Partial<Record<'name' | 'quantity' | 'purchaseNote', string>>;

let nextKey = 0;

export function newIngredientRow(ingredient: DishIngredient = { name: '', quantity: '', purchaseNote: '' }): IngredientRow {
  nextKey += 1;
  return { key: `ingredient-${nextKey}`, ...ingredient };
}

/** Editor rows for a dish's main ingredients; one blank row when there are none. */
export function toIngredientRows(ingredients: readonly DishIngredient[]): IngredientRow[] {
  return ingredients.length ? ingredients.map((i) => newIngredientRow(i)) : [newIngredientRow()];
}

const tooLong = (value: string, max: number, label: string) => (value.length > max ? `${label}不能超过 ${max} 个字` : undefined);

/**
 * Validates the rows the way the server does. All-blank rows are unused and dropped; a quantity
 * or purchase note without a name, or an over-long value, is an error on that row. Nothing is
 * truncated or dropped silently.
 */
export function collectIngredients(rows: readonly IngredientRow[]): {
  ingredients: DishIngredient[];
  errors: Record<string, IngredientRowError>;
} {
  const ingredients: DishIngredient[] = [];
  const errors: Record<string, IngredientRowError> = {};
  for (const row of rows) {
    const name = singleLineText(row.name);
    const quantity = singleLineText(row.quantity);
    const purchaseNote = singleLineText(row.purchaseNote);
    if (!name && !quantity && !purchaseNote) continue;
    const error: IngredientRowError = {
      name: name ? tooLong(name, DISH_LIMITS.ingredientName, '主料名称') : '请填写主料名称，或清空这一行',
      quantity: tooLong(quantity, DISH_LIMITS.ingredientQuantity, '用量'),
      purchaseNote: tooLong(purchaseNote, DISH_LIMITS.purchaseNote, '采购提示'),
    };
    if (error.name || error.quantity || error.purchaseNote) {
      errors[row.key] = Object.fromEntries(Object.entries(error).filter(([, v]) => v));
    } else {
      ingredients.push({ name, quantity, purchaseNote });
    }
  }
  if (ingredients.length > DISH_LIMITS.ingredients) {
    const extra = rows.filter((r) => !errors[r.key])[DISH_LIMITS.ingredients];
    if (extra) errors[extra.key] = { name: `最多 ${DISH_LIMITS.ingredients} 种主料` };
  }
  return { ingredients, errors };
}

/** Full-width digits (from a Chinese IME) are accepted as normal digits. */
const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** Minutes field text → whole minutes. Blank = not recorded (null); "0" stays 0. */
export function parseMinutesInput(text: string, label: string): { value: number | null; error: string | null } {
  const value = toAsciiDigits(text).trim();
  if (!value) return { value: null, error: null };
  const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n > DISH_LIMITS.maxMinutes) {
    return { value: null, error: `${label}请填写 0 到 ${DISH_LIMITS.maxMinutes} 之间的整数（分钟）` };
  }
  return { value: n, error: null };
}

export const minutesText = (minutes: number | null): string => (minutes === null ? '' : String(minutes));

/** Raw form state of the dish-only fields. */
export interface DishFormState {
  sections: string[];
  ingredientRows: IngredientRow[];
  totalMinutes: string;
  activeMinutes: string;
  servingText: string;
  shoppingNote: string;
}

export function toDishFormState(d: DishDetails | null): DishFormState {
  return {
    sections: d ? [...d.sections] : [],
    ingredientRows: toIngredientRows(d?.ingredients ?? []),
    totalMinutes: minutesText(d?.totalMinutes ?? null),
    activeMinutes: minutesText(d?.activeMinutes ?? null),
    servingText: d?.servingText ?? '',
    shoppingNote: d?.shoppingNote ?? '',
  };
}

export type DishFieldErrors = Partial<Record<'sections' | 'totalMinutes' | 'activeMinutes' | 'servingText' | 'shoppingNote', string>>;

/**
 * Everything the admin form sends for the dish details. Every field is always sent, so an empty
 * value clears what was stored.
 */
export function collectDishDetails(state: DishFormState): {
  details: DishDetails;
  errors: DishFieldErrors;
  ingredientErrors: Record<string, IngredientRowError>;
} {
  const errors: DishFieldErrors = {};
  const sections = normalizeSections(state.sections);
  if (sections.length > DISH_LIMITS.sections) errors.sections = `最多 ${DISH_LIMITS.sections} 个菜单分区`;
  const long = sections.find((s) => s.length > DISH_LIMITS.section);
  if (long) errors.sections = `菜单分区「${long}」超过 ${DISH_LIMITS.section} 个字`;
  const total = parseMinutesInput(state.totalMinutes, '总耗时');
  const active = parseMinutesInput(state.activeMinutes, '动手时间');
  if (total.error) errors.totalMinutes = total.error;
  if (active.error) errors.activeMinutes = active.error;
  const crossError = total.error || active.error ? null : dishTimeError(total.value, active.value);
  if (crossError) errors.activeMinutes = crossError;
  const servingText = singleLineText(state.servingText);
  if (servingText.length > DISH_LIMITS.servingText) errors.servingText = `份量不能超过 ${DISH_LIMITS.servingText} 个字`;
  const shoppingNote = state.shoppingNote.trim();
  if (shoppingNote.length > DISH_LIMITS.shoppingNote) errors.shoppingNote = `采购提醒不能超过 ${DISH_LIMITS.shoppingNote} 个字`;
  const { ingredients, errors: ingredientErrors } = collectIngredients(state.ingredientRows);
  return {
    details: {
      sections,
      ingredients,
      totalMinutes: total.value,
      activeMinutes: active.value,
      servingText,
      shoppingNote,
    },
    errors,
    ingredientErrors,
  };
}
