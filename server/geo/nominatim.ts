import { GEO } from '../../shared/constants.js';
import type { LatLng, LocationSuggestion } from '../../shared/types.js';
import { countryNameZh, isCountryCode, LOCATION_LIMITS, OSM_ATTRIBUTION, OSM_COPYRIGHT_URL, stripUnsafeText } from '../../shared/venue.js';
import type { FetchLike } from '../notify/bark.js';

/**
 * Reverse lookup against a Nominatim-compatible /reverse endpoint, GeocodeJSON format
 * (stable country / state / city fields), English names, address layer, city-level zoom.
 * Responses are untrusted: bounded in size, parsed defensively, and only fields the provider
 * actually returned are used — a county or district is never promoted to a city.
 */

export class GeoLookupError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type ReverseAnswer = { kind: 'found'; suggestion: LocationSuggestion } | { kind: 'not_found' };

/** Canonical cache coordinates (5 decimals ≈ 1 m); also what is sent to the provider. */
export const roundCoord = (value: number) => Number(value.toFixed(5));

export function reverseUrl(baseUrl: string, point: LatLng): string {
  const params = new URLSearchParams({
    format: 'geocodejson',
    lat: String(roundCoord(point.lat)),
    lon: String(roundCoord(point.lng)),
    zoom: String(GEO.zoom),
    layer: 'address',
    addressdetails: '1',
    'accept-language': GEO.language,
  });
  return `${baseUrl}/reverse?${params.toString()}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A provider string, cleaned and bounded; anything else (or an over-long value) counts as missing. */
function text(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length > max * 4) return '';
  const cleaned = stripUnsafeText(v);
  return cleaned.length <= max ? cleaned : '';
}

/** Feature types that are a settlement in their own right (when the answer is the city itself). */
const SETTLEMENT_TYPES = new Set(['city', 'town', 'village']);

/** Parses a GeocodeJSON reverse answer. Throws only on a structurally invalid document. */
export function parseReverse(json: unknown): ReverseAnswer {
  if (!isObj(json)) throw new GeoLookupError('地区服务返回的内容无法识别');
  if ('error' in json && !('features' in json)) return { kind: 'not_found' };
  const features = json.features;
  if (!Array.isArray(features)) throw new GeoLookupError('地区服务返回的内容无法识别');
  const first: unknown = features[0];
  if (first === undefined) return { kind: 'not_found' };
  const props = isObj(first) && isObj(first.properties) ? first.properties : null;
  const g = props && isObj(props.geocoding) ? props.geocoding : null;
  if (!g) throw new GeoLookupError('地区服务返回的内容无法识别');

  const rawCode = typeof g.country_code === 'string' ? g.country_code.trim() : '';
  const countryCode = isCountryCode(rawCode) ? rawCode.toUpperCase() : '';
  const providerCountry = text(g.country, LOCATION_LIMITS.country);
  const country = (countryCode && countryNameZh(countryCode)) || providerCountry;
  const region = text(g.state, LOCATION_LIMITS.region);
  let city = text(g.city, LOCATION_LIMITS.city);
  if (!city && typeof g.type === 'string' && SETTLEMENT_TYPES.has(g.type)) city = text(g.name, LOCATION_LIMITS.city);
  if (!country && !region && !city) return { kind: 'not_found' };
  return {
    kind: 'found',
    suggestion: {
      country,
      countryCode: country ? countryCode : '',
      region,
      city,
      providerCountry,
      attribution: OSM_ATTRIBUTION,
      attributionUrl: OSM_COPYRIGHT_URL,
    },
  };
}

/** Reads at most `max` bytes of the body; larger answers are refused rather than truncated. */
async function readBounded(res: Response, max: number): Promise<string> {
  const length = Number(res.headers.get('content-length') ?? '0');
  if (length > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new GeoLookupError('地区服务返回的内容太大');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new GeoLookupError('地区服务返回的内容太大');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface ReverseRequest {
  baseUrl: string;
  point: LatLng;
  userAgent: string;
  fetch: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

/** One request. Redirects are never followed (a redirect to an unknown URL is an error). */
export async function fetchReverse(req: ReverseRequest): Promise<ReverseAnswer> {
  const signal = AbortSignal.timeout(req.timeoutMs ?? GEO.timeoutMs);
  let res: Response;
  try {
    res = await req.fetch(reverseUrl(req.baseUrl, req.point), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { accept: 'application/json', 'user-agent': req.userAgent },
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new GeoLookupError(timeout ? '地区服务响应超时' : '暂时连不上地区服务');
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    throw new GeoLookupError('地区服务返回了跳转，已停止');
  }
  if (res.status === 429) {
    await res.body?.cancel().catch(() => undefined);
    throw new GeoLookupError('地区服务繁忙（请求太频繁），请稍后再试');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new GeoLookupError(`地区服务暂时不可用（${res.status}）`);
  }
  let body: string;
  try {
    body = await readBounded(res, req.maxBytes ?? GEO.maxResponseBytes);
  } catch (err) {
    if (err instanceof GeoLookupError) throw err;
    throw new GeoLookupError('读取地区服务的答复失败');
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new GeoLookupError('地区服务返回的内容无法识别');
  }
  return parseReverse(json);
}
