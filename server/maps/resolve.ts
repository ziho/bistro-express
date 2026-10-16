import type { FetchLike } from '../notify/bark.js';
import { classifyMapsUrl, hasPlaceData, isMapsGoogleHost, parseMapsUrl, type ParsedMapsLink } from './parse.js';

export const MAX_REDIRECT_HOPS = 5;
const TOTAL_TIMEOUT_MS = 8_000;
const MAX_LOCATION_LENGTH = 4096;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class MapLinkError extends Error {
  constructor(
    readonly code: 'map_link_invalid' | 'map_link_unresolved' | 'map_link_unreachable',
    message: string,
  ) {
    super(message);
  }
}

export interface ResolvedMapsLink {
  sourceUrl: string;
  finalUrl: URL;
  expanded: boolean;
  hops: number;
  parsed: ParsedMapsLink;
}

/** Finds the first http(s) link in pasted share text such as "店名\nhttps://maps.app.goo.gl/…". */
export function extractLink(text: string): string | null {
  const match = /https?:\/\/[^\s<>"'，。、）\]]+/i.exec(text);
  if (!match) return null;
  let link = match[0];
  // Preserve restaurant-name parentheses; remove only unmatched Markdown wrappers.
  while (link.endsWith(')') && [...link].filter((c) => c === ')').length > [...link].filter((c) => c === '(').length) {
    link = link.slice(0, -1);
  }
  return link;
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return '未知地址';
  }
}

/** Never fetch google.com pages themselves (consent/login walls) — only short links. */
function needsFetch(kind: 'short' | 'maps', url: URL, parsed: ParsedMapsLink): boolean {
  if (kind === 'short') return true;
  return isMapsGoogleHost(url.hostname) && !hasPlaceData(parsed);
}

async function fetchRedirect(url: URL, fetchImpl: FetchLike, signal: AbortSignal): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { accept: 'text/html', 'user-agent': 'BistroExpress/1.0 (map-link-import)' },
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new MapLinkError('map_link_unreachable', timeout ? '展开短链接超时，请稍后再试' : '暂时连不上 Google 短链接服务，请稍后再试');
  }
  // We never need the page body (Google serves a generic title), so don't download it.
  await res.body?.cancel().catch(() => undefined);
  if (!REDIRECT_STATUSES.has(res.status)) return null;
  const location = res.headers.get('location');
  if (!location || location.length > MAX_LOCATION_LENGTH) {
    throw new MapLinkError('map_link_unresolved', '短链接没有返回有效的跳转地址');
  }
  return location;
}

/**
 * Expands (if needed) and parses a Google Maps link. Every hop — including the first — must
 * pass the strict https Google Maps allowlist; redirects are followed manually and bounded.
 */
export async function resolveMapsLink(
  input: string,
  fetchImpl: FetchLike,
  opts: { maxHops?: number; timeoutMs?: number } = {},
): Promise<ResolvedMapsLink> {
  const sourceUrl = extractLink(input);
  if (!sourceUrl) throw new MapLinkError('map_link_invalid', '没有找到链接，请粘贴以 https:// 开头的 Google 地图分享链接');
  const maxHops = opts.maxHops ?? MAX_REDIRECT_HOPS;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? TOTAL_TIMEOUT_MS);
  let current = sourceUrl;
  let hops = 0;
  for (;;) {
    const classified = classifyMapsUrl(current);
    if (!classified.ok) {
      if (hops === 0) throw new MapLinkError('map_link_invalid', classified.reason);
      const host = hostOf(current);
      const consent = host === 'consent.google.com' || host.startsWith('accounts.google.');
      throw new MapLinkError(
        'map_link_unresolved',
        consent
          ? 'Google 要求登录或同意 Cookie，无法自动展开。请在浏览器打开链接，复制地址栏里的完整地址再试'
          : `短链接跳转到了不支持的地址（${host}），已停止`,
      );
    }
    const parsed = classified.kind === 'maps' ? parseMapsUrl(classified.url) : null;
    if (parsed && !needsFetch(classified.kind, classified.url, parsed)) {
      return { sourceUrl, finalUrl: classified.url, expanded: hops > 0, hops, parsed };
    }
    if (hops >= maxHops) throw new MapLinkError('map_link_unresolved', '跳转次数太多，已停止展开');
    const location = await fetchRedirect(classified.url, fetchImpl, signal);
    if (location === null) {
      if (parsed) return { sourceUrl, finalUrl: classified.url, expanded: hops > 0, hops, parsed };
      throw new MapLinkError('map_link_unresolved', '短链接没有跳转到地图地点，可能已失效');
    }
    try {
      current = new URL(location, classified.url).toString();
    } catch {
      throw new MapLinkError('map_link_unresolved', '短链接返回的跳转地址无效');
    }
    hops += 1;
  }
}
