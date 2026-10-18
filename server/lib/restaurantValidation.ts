import { inferTreatTypes, isTreatType, normalizeTreatTypes, TREAT_TYPES } from '../../shared/treatType.js';
import { LIMITS } from '../../shared/constants.js';
import { mergeLegacyVenueTags, venueTagTypes } from '../../shared/venueTags.js';
import type { Restaurant, TreatType, VenueLocation, VenuePurpose } from '../../shared/types.js';
import {
  countryNameZh,
  emptyLocation,
  hasUnsafeText,
  isCountryCode,
  LOCATION_LIMITS,
  normalizeLocationText,
  normalizePurposes,
  VENUE_PURPOSES,
} from '../../shared/venue.js';
import { badRequest } from './errors.js';
import { parseWith, restaurantInputSchema, type RestaurantInput } from './validation.js';

/** Everything the catalog repo writes for a venue (店铺). */
export interface RestaurantWrite extends RestaurantInput {
  location: VenueLocation;
  purposes: VenuePurpose[];
  treatTypes: TreatType[];
}

const TEXT_FIELDS = ['country', 'region', 'city'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const FIELD_LABEL: Record<TextField, string> = { country: '国家/地区', region: '省/州', city: '城市' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readText(raw: Record<string, unknown>, field: TextField): string {
  const value = raw[field];
  if (value === null) return '';
  if (typeof value !== 'string') throw badRequest(`${FIELD_LABEL[field]}必须是文字`, { field: `location.${field}` });
  const text = normalizeLocationText(value);
  if (hasUnsafeText(text)) throw badRequest(`${FIELD_LABEL[field]}包含不支持的字符`, { field: `location.${field}` });
  const max = LOCATION_LIMITS[field];
  if (text.length > max) throw badRequest(`${FIELD_LABEL[field]}不能超过 ${max} 个字`, { field: `location.${field}` });
  return text;
}

function readCode(value: unknown): string {
  if (value === null || value === '') return '';
  if (typeof value !== 'string' || !isCountryCode(value.trim()) || !countryNameZh(value.trim())) {
    throw badRequest('国家代码无效（应为两位 ISO 代码，如 CA）', { field: 'location.countryCode' });
  }
  return value.trim().toUpperCase();
}

/**
 * Location of a create or an update. Omitted (`undefined`) keeps `stored` (or nothing for a new
 * venue); `null` clears it. Inside the object a missing key keeps its stored value and `''` clears
 * it. The country code only travels with its country: a changed country without a code drops the
 * old code, and a code without a country fills in the Chinese country name.
 */
export function parseLocation(raw: unknown, stored: VenueLocation | null): VenueLocation {
  const base = stored ?? emptyLocation();
  if (raw === undefined) return { ...base };
  if (raw === null) return emptyLocation();
  if (!isObject(raw)) throw badRequest('地区格式无效', { field: 'location' });
  const next: Record<TextField, string> = { country: base.country, region: base.region, city: base.city };
  for (const field of TEXT_FIELDS) if (field in raw) next[field] = readText(raw, field);
  let countryCode = 'countryCode' in raw ? readCode(raw.countryCode) : next.country === base.country ? base.countryCode : '';
  if (countryCode && !next.country) next.country = countryNameZh(countryCode) ?? '';
  if (!next.country) countryCode = '';
  const changed = TEXT_FIELDS.some((f) => next[f] !== base[f]) || countryCode !== base.countryCode;
  const requested = raw.source;
  let source: VenueLocation['source'] =
    requested === 'osm' || requested === 'manual' ? requested : changed ? 'manual' : base.source;
  if (!next.country && !next.region && !next.city) source = '';
  else if (!source) source = 'manual';
  return { ...next, countryCode, source };
}

/** Omitted keeps `stored` (['meal'] for a new venue); an explicit empty list is rejected. */
export function parsePurposes(raw: unknown, stored: readonly VenuePurpose[] | null): VenuePurpose[] {
  if (raw === undefined) return stored ? [...stored] : ['meal'];
  if (!Array.isArray(raw) || raw.length > 8 || raw.some((p) => !VENUE_PURPOSES.includes(p as VenuePurpose))) {
    throw badRequest('前台入口只能选择「正餐」或「饮品甜品」', { field: 'purposes' });
  }
  const purposes = normalizePurposes(raw);
  if (purposes.length === 0) throw badRequest('请至少选择一个前台入口', { field: 'purposes' });
  return purposes;
}

/**
 * Drinks / dessert types. An explicit list is validated (unknown values are rejected, never
 * dropped) and `[]` means 未分类. Omitted keeps `stored` on an update; for a new venue it is
 * inferred from exact known tags, but only when the venue serves 'treat'.
 */
export function parseTreatTypes(
  raw: unknown,
  stored: readonly TreatType[] | null,
  fresh: { purposes: readonly VenuePurpose[]; tags: readonly string[] },
): TreatType[] {
  if (raw === undefined) {
    if (stored) return [...stored];
    return fresh.purposes.includes('treat') ? inferTreatTypes(fresh.tags) : [];
  }
  if (!Array.isArray(raw) || raw.length > TREAT_TYPES.length * 2 || !raw.every(isTreatType)) {
    throw badRequest('饮品甜品类型无效', { field: 'treatTypes' });
  }
  return normalizeTreatTypes(raw);
}

const field = (raw: unknown, key: string): unknown => (isObject(raw) ? raw[key] : undefined);

/** Older pages may still submit types. Treat them as additive tags, never a second authority. */
function unifiedTags(raw: unknown, tags: string[]): string[] {
  const legacy = field(raw, 'treatTypes');
  const merged = legacy === undefined ? tags : mergeLegacyVenueTags(tags, parseTreatTypes(legacy, null, { purposes: [], tags: [] }));
  if (merged.length > LIMITS.restaurantTags) throw badRequest(`最多 ${LIMITS.restaurantTags} 个标签`, { field: 'tags' });
  return merged;
}

/** New venue: only the name is required; location defaults to unknown and purposes to ['meal']. */
export function parseRestaurantCreate(raw: unknown): RestaurantWrite {
  const base = parseWith(restaurantInputSchema, raw);
  const purposes = parsePurposes(field(raw, 'purposes'), null);
  const tags = unifiedTags(raw, base.tags);
  return {
    ...base,
    tags,
    location: parseLocation(field(raw, 'location'), null),
    purposes,
    treatTypes: venueTagTypes(tags),
  };
}

/**
 * Edit: tags, entry and location keep their saved values when omitted. Explicit tags replace the
 * classification list; legacy types can only add their equivalent labels. The compatibility
 * field is derived afresh, so removed tags cannot reappear from stale stored types.
 */
export function parseRestaurantUpdate(raw: unknown, stored: Restaurant): RestaurantWrite {
  const base = parseWith(restaurantInputSchema, raw);
  const purposes = parsePurposes(field(raw, 'purposes'), stored.purposes);
  const tags = unifiedTags(raw, field(raw, 'tags') === undefined ? stored.tags : base.tags);
  return {
    ...base,
    tags,
    location: parseLocation(field(raw, 'location'), stored.location),
    purposes,
    treatTypes: venueTagTypes(tags),
  };
}
