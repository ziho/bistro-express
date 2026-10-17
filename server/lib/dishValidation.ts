import { z } from 'zod';
import { DISH_LIMITS, LIMITS } from '../../shared/constants.js';
import { dishTimeError, isValidMinutes, legacySections, normalizeSections, singleLineText } from '../../shared/dish.js';
import type { Dish, DishDetails, DishIngredient } from '../../shared/types.js';
import { badRequest } from './errors.js';
import { assetId, optionalUrl, parseWith, singleLine, tags, text } from './validation.js';

/** Everything the catalog repo writes for a dish. */
export interface DishWrite extends DishDetails {
  name: string;
  imageAssetId: string | null;
  tags: string[];
  description: string;
  recipeUrl: string | null;
  active: boolean;
}

const section = z.string().trim().max(DISH_LIMITS.section, `每个菜单分区不能超过 ${DISH_LIMITS.section} 个字`);

/** `null` and `[]` clear; blanks and duplicates are dropped. */
const sections = z
  .array(section)
  .max(DISH_LIMITS.sections, `最多 ${DISH_LIMITS.sections} 个菜单分区`)
  .nullable()
  .default(null)
  .transform((list) => normalizeSections(list ?? []));

const rowText = (max: number, message: string) => z.string().trim().max(max, message).default('').transform(singleLineText);

/** One editor row. All-blank rows are unused and dropped; quantity or note without a name is an error. */
const ingredientRow = z
  .object({
    name: rowText(DISH_LIMITS.ingredientName, `主料名称不能超过 ${DISH_LIMITS.ingredientName} 个字`),
    quantity: rowText(DISH_LIMITS.ingredientQuantity, `用量不能超过 ${DISH_LIMITS.ingredientQuantity} 个字`),
    purchaseNote: rowText(DISH_LIMITS.purchaseNote, `采购提示不能超过 ${DISH_LIMITS.purchaseNote} 个字`),
  })
  .superRefine((row, ctx) => {
    if (!row.name && (row.quantity || row.purchaseNote)) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: '请填写主料名称，或清空这一行' });
    }
  });

const ingredients = z
  .array(ingredientRow)
  .max(DISH_LIMITS.ingredients, `最多 ${DISH_LIMITS.ingredients} 种主料`)
  .nullable()
  .default(null)
  .transform((rows): DishIngredient[] => (rows ?? []).filter((r) => r.name));

/** Whole minutes 0..1440. `null`, `''` and omission mean "not recorded"; 0 is kept as 0. */
const minutes = (label: string) =>
  z.unknown().optional().transform((value, ctx): number | null => {
    if (value === undefined || value === null || value === '') return null;
    if (isValidMinutes(value)) return value;
    ctx.addIssue({ code: 'custom', message: `${label}需要是 0 到 ${DISH_LIMITS.maxMinutes} 之间的整数（分钟）` });
    return z.NEVER;
  });

const optionalText = <T extends z.ZodType<string>>(schema: T) =>
  schema
    .nullable()
    .default(null)
    .transform((v) => v ?? '');

const dishSchema = z.object({
  name: text(LIMITS.name).min(1, '请填写菜名'),
  imageAssetId: assetId,
  /** Legacy single category from older clients; only used when `sections` is absent. */
  category: text(LIMITS.shortText).default(''),
  sections,
  tags,
  description: text(LIMITS.description).default(''),
  recipeUrl: optionalUrl,
  ingredients,
  totalMinutes: minutes('总耗时'),
  activeMinutes: minutes('动手时间'),
  servingText: optionalText(singleLine(DISH_LIMITS.servingText)),
  shoppingNote: optionalText(text(DISH_LIMITS.shoppingNote)),
  active: z.boolean().default(true),
});
type ParsedDish = z.output<typeof dishSchema>;

/** Keys present in the request body, so "omitted" can be told apart from "explicitly cleared". */
function presentKeys(raw: unknown): Set<string> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? new Set(Object.keys(raw)) : new Set();
}

/**
 * An older client sent only its single `category` for a dish that may have several sections.
 * A blank category or one the dish already has keeps every stored section; a new category
 * replaces only the first section (what that client displayed), keeping the others.
 */
export function mergeLegacyCategory(stored: readonly string[], category: string): string[] {
  const [legacy] = legacySections(category);
  if (!legacy || stored.includes(legacy)) return [...stored];
  return normalizeSections([legacy, ...stored.slice(1)]);
}

function finish(v: ParsedDish, details: DishDetails): DishWrite {
  const timeError = dishTimeError(details.totalMinutes, details.activeMinutes);
  if (timeError) throw badRequest(timeError, { field: 'activeMinutes' });
  return {
    name: v.name,
    imageAssetId: v.imageAssetId,
    tags: v.tags,
    description: v.description,
    recipeUrl: v.recipeUrl,
    active: v.active,
    ...details,
  };
}

/**
 * New dish: only the name is required. Without `sections`, an older client's `category` becomes
 * one section; an explicit `sections` (even `[]`) always wins.
 */
export function parseDishCreate(raw: unknown): DishWrite {
  const v = parseWith(dishSchema, raw);
  const has = presentKeys(raw);
  return finish(v, {
    sections: has.has('sections') ? v.sections : legacySections(v.category),
    ingredients: v.ingredients,
    totalMinutes: v.totalMinutes,
    activeMinutes: v.activeMinutes,
    servingText: v.servingText,
    shoppingNote: v.shoppingNote,
  });
}

/**
 * Edit: the original fields are replaced as before. The dish-detail fields are only changed when
 * present in the body (explicit `[]` / `null` / `''` clear them); fields an older client does not
 * know about keep their stored values. See mergeLegacyCategory for an older client's category.
 */
export function parseDishUpdate(raw: unknown, stored: Dish): DishWrite {
  const v = parseWith(dishSchema, raw);
  const has = presentKeys(raw);
  const pick = <K extends Exclude<keyof DishDetails, 'sections'>>(key: K): DishDetails[K] => (has.has(key) ? v[key] : stored[key]);
  const nextSections = has.has('sections')
    ? v.sections
    : has.has('category')
      ? mergeLegacyCategory(stored.sections, v.category)
      : [...stored.sections];
  return finish(v, {
    sections: nextSections,
    ingredients: has.has('ingredients') ? v.ingredients : stored.ingredients.map((i) => ({ ...i })),
    totalMinutes: pick('totalMinutes'),
    activeMinutes: pick('activeMinutes'),
    servingText: pick('servingText'),
    shoppingNote: pick('shoppingNote'),
  });
}
