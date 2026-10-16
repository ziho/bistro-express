import { LIMITS } from '../../shared/constants.js';
import type { MapLinkPreview, Restaurant } from '../../shared/types.js';
import { classifyMapsUrl, parseMapsUrl, type ParsedMapsLink } from './parse.js';
import type { ResolvedMapsLink } from './resolve.js';

const MATCH_LABEL = {
  url: '相同链接',
  pid: 'Place ID',
  ftid: 'FTID',
  cid: 'CID',
  kg: '地点编号',
  pt: '同名且同一坐标',
} as const;
type MatchKind = keyof typeof MATCH_LABEL;

function urlKey(url: URL, kind: 'short' | 'maps'): string {
  const path = url.pathname.replace(/\/+$/, '');
  if (kind === 'short') return `${url.hostname.toLowerCase()}${path}`;
  return `${url.hostname.toLowerCase().replace(/^www\./, '')}${path}${url.search}`;
}

/**
 * Identifiers of one specific place (branch). Deliberately never the name alone, so two
 * branches of the same brand do not count as duplicates.
 */
function placeKeys(parsed: ParsedMapsLink): [MatchKind, string][] {
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

/** Keys for a stored map link, computed offline (stored short links are not expanded). */
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

function resolvedKeys(resolved: ResolvedMapsLink): [MatchKind, string][] {
  const keys: [MatchKind, string][] = [['url', urlKey(new URL(resolved.parsed.cleanUrl), 'maps')]];
  const source = classifyMapsUrl(resolved.sourceUrl);
  if (source.ok) keys.push(['url', urlKey(source.url, source.kind)]);
  return [...keys, ...placeKeys(resolved.parsed)];
}

export function findDuplicates(resolved: ResolvedMapsLink, restaurants: Restaurant[]): MapLinkPreview['duplicates'] {
  const wanted = resolvedKeys(resolved);
  const out: MapLinkPreview['duplicates'] = [];
  for (const r of restaurants) {
    if (!r.mapUrl) continue;
    const stored = storedLinkKeys(r.mapUrl);
    const matched = [...new Set(wanted.filter(([kind, value]) => stored.has(`${kind}:${value}`)).map(([kind]) => MATCH_LABEL[kind]))];
    if (matched.length) out.push({ id: r.id, name: r.name, active: r.active, matchedBy: matched });
  }
  return out;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  return chars.length <= max ? { text, truncated: false } : { text: chars.slice(0, max).join(''), truncated: true };
}

function suggestedMapUrl(resolved: ResolvedMapsLink): string | null {
  if (resolved.parsed.cleanUrl.length <= LIMITS.url) return resolved.parsed.cleanUrl;
  if (resolved.sourceUrl.length <= LIMITS.url) return resolved.sourceUrl;
  return null;
}

export function buildPreview(resolved: ResolvedMapsLink, restaurants: Restaurant[]): MapLinkPreview {
  const p = resolved.parsed;
  const name = p.name ? truncate(p.name, LIMITS.name) : null;
  const mapUrl = suggestedMapUrl(resolved);
  const notes: string[] = [];
  if (!p.name) notes.push('链接里没有店名，请手动填写。');
  else if (p.nameSource === 'query') notes.push('店名来自搜索词，不一定是店铺的正式名称，请核对。');
  if (name?.truncated) notes.push(`店名超过 ${LIMITS.name} 个字，已截断。`);
  if (!p.place && p.camera) notes.push('链接只带有地图视角中心（@坐标），那不是店铺的准确位置。');
  if (!mapUrl) notes.push('链接太长，无法保存为地图链接，请手动填写。');
  notes.push('地址、菜系和预算可在下方补充，照片可自行上传。');
  return {
    sourceUrl: resolved.sourceUrl,
    resolvedUrl: p.cleanUrl,
    mapUrl,
    expanded: resolved.expanded,
    name: name?.text ?? null,
    nameSource: p.nameSource,
    nameTruncated: name?.truncated ?? false,
    place: p.place,
    camera: p.camera,
    identifiers: { placeId: p.placeId, ftid: p.ftid, cid: p.cid, cidDerived: p.cidDerived, kgId: p.kgId },
    duplicates: findDuplicates(resolved, restaurants),
    notes,
  };
}
