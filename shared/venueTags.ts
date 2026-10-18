import { inferTreatTypes, normalizeTreatTypes, TREAT_TYPE_LABEL } from './treatType.js';
import type { TreatType } from './types.js';

/** One classification list. Legacy types are translated once; custom tags are never renamed. */
export function mergeLegacyVenueTags(tags: readonly string[], types: readonly TreatType[]): string[] {
  const result = [...new Set(tags)];
  const represented = new Set(inferTreatTypes(result));
  for (const type of normalizeTreatTypes(types)) {
    const label = TREAT_TYPE_LABEL[type];
    if (!represented.has(type) && !result.includes(label)) result.push(label);
  }
  return result;
}

/** Compatibility field for older clients; always derived from the single tag list. */
export function venueTagTypes(tags: readonly string[]): TreatType[] {
  return normalizeTreatTypes([...inferTreatTypes(tags), ...(tags.includes('其他') ? ['other'] : [])]);
}

export const SUGGESTED_VENUE_TAGS = ['粤菜', '日料', '火锅', '烧烤', '奶茶', '咖啡', '糖水', '雪糕', '蛋糕', '面包', '约会', '聚餐', '外带'] as const;
