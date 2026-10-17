import type { Restaurant, VenueLocation, VenuePurpose } from './types.js';
import { formatLocation, PURPOSE_LABEL } from './venue.js';

/**
 * Pure venue filtering, shared by the guest picker and the admin list. All criteria combine with
 * AND; inside the tag criterion the mode decides ANY (default: 日料 OR 烧烤) or ALL (日料 AND 约会);
 * selected places combine with OR, and a parent place includes everything below it.
 * Choices (tags, places) are derived only from the stored catalog — no online lookup.
 */

export type TagMode = 'any' | 'all';

export interface VenueFilter {
  q: string;
  tags: string[];
  tagMode: TagMode;
  /** Place scope keys (see placeScopeKey) or UNKNOWN_PLACE. */
  places: string[];
  /** null = every purpose (admin list); the guest picker always passes the plan's purpose. */
  purpose: VenuePurpose | null;
  onlySelected: boolean;
}

export const emptyVenueFilter = (purpose: VenuePurpose | null = null): VenueFilter => ({
  q: '',
  tags: [],
  tagMode: 'any',
  places: [],
  purpose,
  onlySelected: false,
});

/** Scope of venues with no country, region or city at all. */
export const UNKNOWN_PLACE = 'unknown';

export type PlaceLevel = 'country' | 'region' | 'city';

export interface PlaceScope {
  level: PlaceLevel;
  country: string;
  region: string;
  city: string;
}

/** Comparison form of one place name: whitespace collapsed, case-insensitive. */
export const placePart = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The key spells out the whole path down to the scope's level, so Richmond in British Columbia
 * and Richmond in Virginia are different scopes. Parts are URI-encoded, so '/' cannot collide.
 */
export function placeScopeKey(scope: PlaceScope): string {
  const parts = [scope.country];
  if (scope.level !== 'country') parts.push(scope.region);
  if (scope.level === 'city') parts.push(scope.city);
  return `${scope.level}:${parts.map((p) => encodeURIComponent(placePart(p))).join('/')}`;
}

export function parsePlaceScopeKey(key: string): PlaceScope | null {
  const m = /^(country|region|city):(.*)$/.exec(key);
  if (!m) return null;
  const level = m[1] as PlaceLevel;
  const parts = m[2]!.split('/');
  const expected = level === 'country' ? 1 : level === 'region' ? 2 : 3;
  if (parts.length !== expected) return null;
  try {
    const [country = '', region = '', city = ''] = parts.map((p) => decodeURIComponent(p));
    return { level, country, region, city };
  } catch {
    return null;
  }
}

const isUnknown = (l: VenueLocation) => !l.country && !l.region && !l.city;

export function matchesPlace(location: VenueLocation, key: string): boolean {
  if (key === UNKNOWN_PLACE) return isUnknown(location);
  const scope = parsePlaceScopeKey(key);
  if (!scope || isUnknown(location)) return false;
  if (placePart(location.country) !== scope.country) return false;
  if (scope.level === 'country') return true;
  if (placePart(location.region) !== scope.region) return false;
  return scope.level === 'region' || placePart(location.city) === scope.city;
}

export function matchesTags(tags: readonly string[], wanted: readonly string[], mode: TagMode): boolean {
  if (wanted.length === 0) return true;
  return mode === 'all' ? wanted.every((t) => tags.includes(t)) : wanted.some((t) => tags.includes(t));
}

/** Everything the search box looks at: name, review, address, note, budget, tags, location. */
export function venueSearchFields(r: Restaurant): string[] {
  const l = r.location ?? null;
  return [r.name, r.review, r.address, r.note, r.budgetText, ...r.tags, ...(l ? [l.country, l.countryCode, l.region, l.city] : [])];
}

export function matchesQuery(q: string, fields: readonly (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export function venueMatches(r: Restaurant, f: VenueFilter, selected: ReadonlySet<string>): boolean {
  return (
    (f.purpose === null || r.purposes.includes(f.purpose)) &&
    (!f.onlySelected || selected.has(r.id)) &&
    (f.places.length === 0 || f.places.some((key) => matchesPlace(r.location, key))) &&
    matchesTags(r.tags, f.tags, f.tagMode) &&
    matchesQuery(f.q, venueSearchFields(r))
  );
}

export function filterVenues<T extends Restaurant>(venues: readonly T[], f: VenueFilter, selected: ReadonlySet<string> = new Set()): T[] {
  return venues.filter((r) => venueMatches(r, f, selected));
}

/** How many criteria (besides the search text and the fixed purpose) are active. */
export const activeFilterCount = (f: VenueFilter) => f.tags.length + f.places.length + (f.onlySelected ? 1 : 0);

// ---------- Choices derived from the catalog ----------

export interface TagChoice {
  tag: string;
  count: number;
}

export function tagChoices(venues: readonly Restaurant[]): TagChoice[] {
  const counts = new Map<string, number>();
  for (const r of venues) for (const t of new Set(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, 'zh'));
}

export interface PlaceNode {
  key: string;
  level: PlaceLevel;
  /** Display text (the first spelling seen); '' for a missing level. */
  label: string;
  count: number;
  children: PlaceNode[];
}

/** Display text of a tree level whose value was left blank. */
export const BLANK_PLACE_LABEL: Record<PlaceLevel, string> = { country: '未填国家', region: '未填省/州', city: '未填城市' };

function addNode(list: PlaceNode[], key: string, level: PlaceLevel, label: string): PlaceNode {
  let node = list.find((n) => n.key === key);
  if (!node) {
    node = { key, level, label, count: 0, children: [] };
    list.push(node);
  }
  node.count += 1;
  return node;
}

const sortNodes = (nodes: PlaceNode[]): PlaceNode[] =>
  nodes
    .map((n) => ({ ...n, children: sortNodes(n.children) }))
    .sort((a, b) => (a.label === '' ? 1 : b.label === '' ? -1 : a.label.localeCompare(b.label, 'zh')));

/**
 * Country → region → city tree with venue counts. A venue without a region still appears under its
 * country (region node with a blank label) so its city stays selectable; city-states need no region.
 */
export function placeTree(venues: readonly Restaurant[]): { nodes: PlaceNode[]; unknown: number } {
  const roots: PlaceNode[] = [];
  let unknown = 0;
  for (const { location: l } of venues) {
    if (isUnknown(l)) {
      unknown += 1;
      continue;
    }
    const country = addNode(roots, placeScopeKey({ level: 'country', country: l.country, region: '', city: '' }), 'country', l.country);
    const region = addNode(country.children, placeScopeKey({ level: 'region', country: l.country, region: l.region, city: '' }), 'region', l.region);
    if (l.city) addNode(region.children, placeScopeKey({ level: 'city', country: l.country, region: l.region, city: l.city }), 'city', l.city);
  }
  return { nodes: sortNodes(roots), unknown };
}

/** Human label of a place key for the active-filter chips, e.g. 「加拿大 · British Columbia · Burnaby」. */
export function placeKeyLabel(key: string, tree: PlaceNode[]): string {
  if (key === UNKNOWN_PLACE) return '未填地区';
  const path: string[] = [];
  const walk = (nodes: PlaceNode[]): boolean => {
    for (const n of nodes) {
      if (n.key === key || walk(n.children)) {
        // A blank middle level (no region recorded) is left out of a city's label.
        if (n.label || n.key === key) path.unshift(n.label || BLANK_PLACE_LABEL[n.level]);
        return true;
      }
    }
    return false;
  };
  if (walk(tree)) return path.join(' · ');
  const scope = parsePlaceScopeKey(key);
  return scope ? formatLocation({ country: scope.country, countryCode: '', region: scope.region, city: scope.city, source: '' }) : key;
}

export function purposeFilterLabel(purpose: VenuePurpose | null): string {
  return purpose ? PURPOSE_LABEL[purpose] : '全部用途';
}
