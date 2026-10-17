import type { PlanMode, VenueLocation, VenuePurpose } from './types.js';

/**
 * Worldwide venue location and outing purpose, shared by the server (validation, snapshots,
 * notifications) and the browser (forms, filters, labels).
 *
 * - Every location field is optional free text. Nothing assumes an administrative hierarchy: a
 *   city-state has no region, and a city (Burnaby) is never folded into a nearby one (Vancouver).
 * - `purposes` says what a venue is for: 'meal' (去吃饭) and/or 'treat' (饮品 / 甜品). It is
 *   structural; tags (奶茶, 咖啡, 火锅…) stay free-form and user-defined.
 */

export const VENUE_PURPOSES = ['meal', 'treat'] as const satisfies readonly VenuePurpose[];

export const LOCATION_LIMITS = {
  country: 40,
  region: 60,
  city: 60,
} as const;

export const PURPOSE_LABEL: Record<VenuePurpose, string> = {
  meal: '吃饭',
  treat: '饮品甜品',
};

/** One saved outing as people talk about it: cooked at home, a restaurant meal, or a drinks/dessert stop. */
export type OutingKind = 'home' | 'restaurant' | 'treat';

export const OUTING_LABEL: Record<OutingKind, string> = {
  home: '屋企煮',
  restaurant: '出街食',
  treat: '饮番杯',
};

/** The three choices of the editor. */
export const OUTING_CHOICE_LABEL: Record<OutingKind, string> = {
  home: '屋企煮',
  restaurant: '出街食',
  treat: '饮番杯',
};

/** Treat outings get this name only when the label is still empty (a custom label is never replaced). */
export const TREAT_DEFAULT_LABEL = '下午茶';
export const TREAT_SUGGESTIONS = ['下午茶', '咖啡', '奶茶', '甜品', '宵夜糖水'] as const;

export function outingKind(plan: { mode: PlanMode; purpose?: VenuePurpose | null }): OutingKind {
  if (plan.mode === 'home') return 'home';
  return plan.purpose === 'treat' ? 'treat' : 'restaurant';
}

export function outingFromKind(kind: OutingKind): { mode: PlanMode; purpose: VenuePurpose } {
  if (kind === 'home') return { mode: 'home', purpose: 'meal' };
  return { mode: 'restaurant', purpose: kind === 'treat' ? 'treat' : 'meal' };
}

export const emptyLocation = (): VenueLocation => ({ country: '', countryCode: '', region: '', city: '', source: '' });

/** Line breaks and runs of whitespace collapse to one space; ends are trimmed. */
export function normalizeLocationText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** C0/C1 controls, zero-width and bidi override characters — never valid in a place name. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

export function hasUnsafeText(value: string): boolean {
  return UNSAFE_TEXT.test(value);
}

/** Removes unsafe characters (for text coming from an external provider, which is never rejected wholesale). */
export function stripUnsafeText(value: string): string {
  return normalizeLocationText(value.replace(new RegExp(UNSAFE_TEXT.source, 'g'), ''));
}

const COUNTRY_CODE_RE = /^[A-Za-z]{2}$/;

export function isCountryCode(value: string): boolean {
  return COUNTRY_CODE_RE.test(value);
}

let zhRegions: Intl.DisplayNames | null | undefined;

/** Chinese name of an ISO 3166-1 alpha-2 region (加拿大 for CA), or null when the runtime does not know it. */
export function countryNameZh(code: string): string | null {
  if (!isCountryCode(code)) return null;
  if (zhRegions === undefined) {
    try {
      zhRegions = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    } catch {
      zhRegions = null;
    }
  }
  if (!zhRegions) return null;
  const upper = code.toUpperCase();
  try {
    const name = zhRegions.of(upper);
    return name && name !== upper && name !== '未知地区' ? name : null;
  } catch {
    return null;
  }
}

export const hasLocation = (l: VenueLocation) => Boolean(l.country || l.region || l.city);

/** Concise display, largest to smallest: 「加拿大 · British Columbia · Burnaby」. '' when nothing is recorded. */
export function formatLocation(l: VenueLocation | null | undefined): string {
  if (!l) return '';
  return [l.country, l.region, l.city].filter(Boolean).join(' · ');
}

/** Canonical purpose list: known values only, de-duplicated, in VENUE_PURPOSES order. */
export function normalizePurposes(list: readonly unknown[]): VenuePurpose[] {
  return VENUE_PURPOSES.filter((p) => list.includes(p));
}

/** Purposes stored before migration 7, or unreadable ones, mean an ordinary meal venue. */
export function readStoredPurposes(raw: unknown): VenuePurpose[] {
  const list = Array.isArray(raw) ? normalizePurposes(raw) : [];
  return list.length ? list : ['meal'];
}

const readText = (v: unknown, max: number) => (typeof v === 'string' ? stripUnsafeText(v).slice(0, max * 2) : '');

/** Reads a stored location (columns or a snapshot) of any age; missing means unknown, never guessed. */
export function readStoredLocation(raw: unknown): VenueLocation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLocation();
  const l = raw as Record<string, unknown>;
  const code = typeof l.countryCode === 'string' && isCountryCode(l.countryCode) ? l.countryCode.toUpperCase() : '';
  return {
    country: readText(l.country, LOCATION_LIMITS.country),
    countryCode: code,
    region: readText(l.region, LOCATION_LIMITS.region),
    city: readText(l.city, LOCATION_LIMITS.city),
    source: l.source === 'osm' || l.source === 'manual' ? l.source : '',
  };
}

export function supportsPurpose(venue: { purposes: readonly VenuePurpose[] }, purpose: VenuePurpose): boolean {
  return venue.purposes.includes(purpose);
}

export function purposesText(purposes: readonly VenuePurpose[]): string {
  return purposes.map((p) => PURPOSE_LABEL[p]).join(' · ');
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
