import { classifyMapsUrl, parseMapsUrl, type MapsLinkKind, type ParsedMapsLink } from './mapsUrl.js';
import type { RestaurantDuplicate } from './types.js';

/**
 * Offline identity keys of Google Maps links, shared by the server (preview + import recheck)
 * and the admin bulk importer (queue duplicates). Computing them never makes a request:
 * short links are compared as links, they are not expanded here.
 */

export const MATCH_LABEL = {
  url: '相同链接',
  pid: 'Place ID',
  ftid: 'FTID',
  cid: 'CID',
  kg: '地点编号',
  pt: '同名且同一坐标',
} as const;
export type MatchKind = keyof typeof MATCH_LABEL;

export function urlKey(url: URL, kind: MapsLinkKind): string {
  const path = url.pathname.replace(/\/+$/, '');
  if (kind === 'short') return `${url.hostname.toLowerCase()}${path}`;
  return `${url.hostname.toLowerCase().replace(/^www\./, '')}${path}${url.search}`;
}

/**
 * Identifiers of one specific place (branch). Deliberately never the name alone, so two
 * branches of the same brand do not count as duplicates.
 */
export function placeKeys(parsed: ParsedMapsLink): [MatchKind, string][] {
  const keys: [MatchKind, string][] = [];
  if (parsed.placeId) keys.push(['pid', parsed.placeId]);
  if (parsed.ftid) keys.push(['ftid', parsed.ftid]);
  if (parsed.cid) keys.push(['cid', parsed.cid]);
  if (parsed.kgId) keys.push(['kg', parsed.kgId]);
  if (parsed.name && parsed.place) {
    keys.push(['pt', `${parsed.name.toLowerCase()}@${parsed.place.lat.toFixed(4)},${parsed.place.lng.toFixed(4)}`]);
  }
  return keys;
}

/** Keys (`kind:value`) for one map link; empty when it is not a strict Google Maps link. */
export function storedLinkKeys(mapUrl: string): Set<string> {
  const keys = new Set<string>();
  const c = classifyMapsUrl(mapUrl);
  if (!c.ok) return keys;
  keys.add(`url:${urlKey(c.url, c.kind)}`);
  if (c.kind === 'maps') {
    const parsed = parseMapsUrl(c.url);
    keys.add(`url:${urlKey(new URL(parsed.cleanUrl), 'maps')}`);
    for (const [kind, value] of placeKeys(parsed)) keys.add(`${kind}:${value}`);
  }
  return keys;
}

/** Union of the keys of several links (e.g. a row's source link and its canonical map link). */
export function linkKeys(urls: (string | null | undefined)[]): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) {
    if (url) for (const key of storedLinkKeys(url)) keys.add(key);
  }
  return keys;
}

/** Human labels of the keys two sets share, e.g. ['相同链接', 'CID']; empty when they share none. */
export function matchedLabels(wanted: Iterable<string>, stored: Set<string>): string[] {
  const labels = new Set<string>();
  for (const key of wanted) {
    if (!stored.has(key)) continue;
    const kind = key.slice(0, key.indexOf(':')) as MatchKind;
    if (kind in MATCH_LABEL) labels.add(MATCH_LABEL[kind]);
  }
  return [...labels];
}

/** Restaurants (active or not) whose saved map link shares a key with `wanted`. */
export function findLinkDuplicates(
  wanted: Set<string>,
  restaurants: { id: string; name: string; active: boolean; mapUrl: string | null }[],
): RestaurantDuplicate[] {
  if (wanted.size === 0) return [];
  const out: RestaurantDuplicate[] = [];
  for (const r of restaurants) {
    if (!r.mapUrl) continue;
    const matchedBy = matchedLabels(wanted, storedLinkKeys(r.mapUrl));
    if (matchedBy.length) out.push({ id: r.id, name: r.name, active: r.active, matchedBy });
  }
  return out;
}
