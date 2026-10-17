import { z } from 'zod';
import { SHOPPING_LIMITS } from '../../shared/constants.js';
import { singleLineText } from '../../shared/dish.js';
import { SHOPPING_STATUSES } from '../../shared/shopping.js';

/** Every shopping write names the meal version and shopping revision it was made against. */
const expected = {
  expectedPlanVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};

/** Trimmed and whitespace-collapsed first; over-long values are then rejected, never truncated. */
const field = (max: number, label: string) =>
  z
    .string()
    .max(max * 4, `${label}太长了`)
    .transform(singleLineText)
    .pipe(z.string().max(max, `${label}不能超过 ${max} 个字`));

const manualFields = {
  name: field(SHOPPING_LIMITS.name, '名称').refine((v) => v.length > 0, '请填写要买的东西'),
  quantity: field(SHOPPING_LIMITS.quantity, '数量').default(''),
  note: field(SHOPPING_LIMITS.note, '备注').default(''),
};

export const shoppingStatusSchema = z.object({
  key: z.string().min(1).max(SHOPPING_LIMITS.groupKey),
  status: z.enum(SHOPPING_STATUSES),
  ...expected,
});

export const manualItemSchema = z.object({ ...manualFields, ...expected });

export const manualDeleteSchema = z.object(expected);

export type ShoppingStatusInput = z.output<typeof shoppingStatusSchema>;
export type ManualItemInput = z.output<typeof manualItemSchema>;
export type ShoppingExpected = z.output<typeof manualDeleteSchema>;
