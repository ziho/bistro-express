import type { VenuePurpose } from '../../../shared/types';
import { emptyVenueFilter, UNKNOWN_PLACE, parsePlaceScopeKey, type VenueFilter } from '../../../shared/venueFilter';

/**
 * The last applied picker filters (tags, tag mode, places) per purpose, on this device only.
 * Kept apart from meal drafts and never sent anywhere. Read back defensively: anything malformed
 * or from another version is ignored, and storage failures just mean nothing is remembered.
 */
export const FILTER_STORE_KEY = 'bx:venue-filter';
export const FILTER_STORE_VERSION = 1;
const MAX_ITEMS = 50;
// Place keys URI-encode up to 160 characters of location text; non-Latin paths can exceed 200.
const MAX_TEXT = 1600;

type Remembered = Pick<VenueFilter, 'tags' | 'tagMode' | 'places'>;

const isStrList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_TEXT);

export function parseRemembered(raw: string | null, purpose: VenuePurpose): Remembered | null {
  if (!raw || raw.length > 64 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== FILTER_STORE_VERSION) return null;
  const entry = v[purpose];
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (!isStrList(e.tags) || !isStrList(e.places) || (e.tagMode !== 'any' && e.tagMode !== 'all')) return null;
  const places = e.places.filter((k) => k === UNKNOWN_PLACE || parsePlaceScopeKey(k) !== null);
  return { tags: [...new Set(e.tags)], tagMode: e.tagMode, places: [...new Set(places)] };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Remembered filters, dropping tags and places that no longer exist in the catalog. */
export function loadVenueFilter(purpose: VenuePurpose, available: { tags: Set<string>; places: Set<string> }): VenueFilter {
  let remembered: Remembered | null = null;
  try {
    remembered = parseRemembered(storage()?.getItem(FILTER_STORE_KEY) ?? null, purpose);
  } catch {
    remembered = null;
  }
  const base = emptyVenueFilter(purpose);
  if (!remembered) return base;
  return {
    ...base,
    tags: remembered.tags.filter((t) => available.tags.has(t)),
    tagMode: remembered.tagMode,
    places: remembered.places.filter((p) => available.places.has(p)),
  };
}

export function saveVenueFilter(purpose: VenuePurpose, filter: VenueFilter): void {
  const s = storage();
  if (!s) return;
  try {
    let current: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(s.getItem(FILTER_STORE_KEY) ?? 'null');
      if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === FILTER_STORE_VERSION) {
        current = parsed as Record<string, unknown>;
      }
    } catch {
      current = {};
    }
    const entry: Remembered = { tags: filter.tags.slice(0, MAX_ITEMS), tagMode: filter.tagMode, places: filter.places.slice(0, MAX_ITEMS) };
    s.setItem(FILTER_STORE_KEY, JSON.stringify({ ...current, version: FILTER_STORE_VERSION, [purpose]: entry }));
  } catch {
    // Storage full or disabled: filters simply are not remembered.
  }
}
