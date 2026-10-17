import { LIMITS } from '../../shared/constants.js';
import { findLinkDuplicates, placeKeys, urlKey } from '../../shared/mapsKeys.js';
import type { MapLinkPreview, Restaurant } from '../../shared/types.js';
import { classifyMapsUrl } from './parse.js';
import type { ResolvedMapsLink } from './resolve.js';

export { storedLinkKeys } from '../../shared/mapsKeys.js';

function resolvedKeys(resolved: ResolvedMapsLink): Set<string> {
  const keys = new Set([`url:${urlKey(new URL(resolved.parsed.cleanUrl), 'maps')}`]);
  const source = classifyMapsUrl(resolved.sourceUrl);
  if (source.ok) keys.add(`url:${urlKey(source.url, source.kind)}`);
  for (const [kind, value] of placeKeys(resolved.parsed)) keys.add(`${kind}:${value}`);
  return keys;
}

export function findDuplicates(resolved: ResolvedMapsLink, restaurants: Restaurant[]): MapLinkPreview['duplicates'] {
  return findLinkDuplicates(resolvedKeys(resolved), restaurants);
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
  notes.push('地址、标签和预算可在下方补充，照片可自行上传。');
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
