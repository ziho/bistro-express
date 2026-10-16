import { z } from 'zod';
import { BARK_LIMITS, LIMITS, MAP_LINK_INPUT_MAX } from '../../shared/constants.js';
import { isSafeExternalUrl } from '../../shared/restaurant.js';
import { badRequest } from './errors.js';

export const ASSET_ID_RE = /^[a-f0-9]{32}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const text = (max: number) => z.string().trim().max(max, `不能超过 ${max} 个字`);

const optionalUrl = z
  .union([z.string().trim().max(LIMITS.url), z.null()])
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isHttpUrl(v), '链接必须以 http:// 或 https:// 开头');

/** Nullable link that is rendered as a guest-facing anchor: strict http(s), no credentials. */
const optionalExternalUrl = z
  .union([z.string().trim().max(LIMITS.url, `链接不能超过 ${LIMITS.url} 个字符`), z.null()])
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isSafeExternalUrl(v), '链接必须是以 http:// 或 https:// 开头的完整网址');

/** Single-line text: line breaks and runs of spaces collapse to one space. */
const singleLine = (max: number) => text(max).transform((v) => v.replace(/\s+/g, ' '));

const tags = z
  .array(z.string().trim().min(1).max(LIMITS.tag, `标签不能超过 ${LIMITS.tag} 个字`))
  .max(LIMITS.tags, `最多 ${LIMITS.tags} 个标签`)
  .default([])
  .transform((list) => [...new Set(list)]);

const assetId = z
  .union([z.string().regex(ASSET_ID_RE, '图片编号无效'), z.null()])
  .optional()
  .transform((v) => v ?? null);

export const dishInputSchema = z.object({
  name: text(LIMITS.name).min(1, '请填写菜名'),
  imageAssetId: assetId,
  category: text(LIMITS.shortText).default(''),
  tags,
  description: text(LIMITS.description).default(''),
  recipeUrl: optionalUrl,
  active: z.boolean().default(true),
});
export type DishInput = z.infer<typeof dishInputSchema>;

export const restaurantInputSchema = z.object({
  name: text(LIMITS.name).min(1, '请填写餐厅名'),
  imageAssetId: assetId,
  review: singleLine(LIMITS.review).default(''),
  tags,
  budgetText: text(LIMITS.shortText).default(''),
  address: text(LIMITS.address).default(''),
  mapUrl: optionalUrl,
  linkUrl: optionalExternalUrl,
  linkLabel: singleLine(LIMITS.linkLabel).default(''),
  note: text(LIMITS.description).default(''),
  active: z.boolean().default(true),
});
export type RestaurantInput = z.infer<typeof restaurantInputSchema>;

const idList = (max: number) => z.array(z.string().min(1).max(64)).max(max).default([]);

export const planInputSchema = z.object({
  date: z.string(),
  mealLabel: text(LIMITS.mealLabel).min(1, '请填写这一餐的名字'),
  localTime: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  timeZone: z.string().min(1).max(64),
  mode: z.enum(['home', 'restaurant']),
  note: text(LIMITS.note).default(''),
  dishIds: idList(LIMITS.maxDishesPerMeal),
  candidateIds: idList(LIMITS.maxCandidates),
  selectedRestaurantId: z
    .union([z.string().max(64), z.null()])
    .optional()
    .transform((v) => v ?? null),
  sourcePlanId: z
    .union([z.string().max(64), z.null()])
    .optional()
    .transform((v) => v ?? null),
});
export type PlanInputParsed = z.infer<typeof planInputSchema>;

export const planUpdateSchema = planInputSchema.extend({ expectedVersion: z.number().int().positive() });
export const planCancelSchema = z.object({ expectedVersion: z.number().int().positive() });

export const barkSettingsSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z
    .string()
    .trim()
    .max(LIMITS.url)
    .refine(isHttpUrl, 'Bark 服务器地址必须以 http:// 或 https:// 开头'),
  /**
   * Legacy single-key field, kept for older clients: a non-empty key is added as a device
   * (no-op if already present). Omitted / null / empty never removes devices — use the device API.
   */
  deviceKey: z
    .union([z.string().trim().max(300), z.null()])
    .optional(),
});

const deviceLabel = text(BARK_LIMITS.label).min(1, '请填写设备名称');

export const barkDeviceCreateSchema = z.object({
  label: deviceLabel,
  deviceKey: z.string().trim().min(1, '请填写设备 Key').max(300, '设备 Key 太长'),
  enabled: z.boolean().default(true),
});

export const barkDeviceUpdateSchema = z.object({
  label: deviceLabel.optional(),
  /** Omit or null keeps the stored key. */
  deviceKey: z.union([z.string().trim().min(1, '设备 Key 不能为空').max(300, '设备 Key 太长'), z.null()]).optional(),
  enabled: z.boolean().optional(),
});

export const mapLinkSchema = z.object({
  url: z.string().trim().min(1, '请先粘贴 Google 地图链接').max(MAP_LINK_INPUT_MAX, '链接太长了'),
});

export function parseWith<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') || undefined;
    throw badRequest(first?.message ?? '请求内容无效', field ? { field } : undefined);
  }
  return result.data;
}
