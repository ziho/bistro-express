import { GEO } from '../../shared/constants.js';
import type { ParsedMapsLink } from '../../shared/mapsUrl.js';
import type { GeoOutcome, GeoSettingsView, LatLng } from '../../shared/types.js';
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from '../../shared/venue.js';
import type { FetchLike } from '../notify/bark.js';
import type { GeoCacheRepo } from '../repos/geoCache.js';
import type { SettingsRepo } from '../repos/misc.js';
import { fetchReverse, GeoLookupError, parseReverse, roundCoord, type ReverseAnswer } from './nominatim.js';
import { reliablePoint } from './point.js';
import { QueueFullError, QueueResetError, SerialRateQueue, type QueueClock } from './queue.js';

export interface GeoSettings {
  enabled: boolean;
  /** Nominatim-compatible base URL without trailing slash, e.g. https://nominatim.openstreetmap.org */
  baseUrl: string;
}

export const GEO_SETTINGS_KEY = 'geo.reverse';

export interface GeocoderDeps {
  settings: SettingsRepo;
  cache: GeoCacheRepo;
  /** Built-in default when nothing is saved; null = off (tests, or a config without the lookup). */
  defaults: GeoSettings | null;
  fetch: FetchLike;
  clock: () => Date;
  queueClock: QueueClock;
  userAgent: string;
  log: (msg: string) => void;
}

const DAY_MS = 24 * 60 * 60_000;

function readStored(raw: unknown): GeoSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const { enabled, baseUrl } = raw as Record<string, unknown>;
  if (typeof enabled !== 'boolean' || typeof baseUrl !== 'string' || !normalizeBaseUrl(baseUrl)) return null;
  return { enabled, baseUrl: normalizeBaseUrl(baseUrl)! };
}

/** http(s) origin + optional path, no credentials, query or fragment; trailing slashes removed. Null if invalid. */
export function normalizeBaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > GEO.baseUrlMax || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash || !url.hostname) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const MESSAGES = {
  disabled: '地区识别已关闭，可在「推送设置 → 地区识别」里打开，或直接手动填写。',
  notFound: '地区服务没有找到这个位置所属的国家、省/州或城市，请手动填写。',
  busy: '地区识别排队的请求太多，请稍后再试。',
  reset: '地区识别设置刚刚改过，请重新识别。',
} as const;

/**
 * Region suggestions for a venue's place point. Only user-triggered admin requests reach this;
 * nothing runs at startup or in the background. Answers are cached per provider + language +
 * rounded point, so switching providers never mixes their results.
 */
export function createGeocoder(deps: GeocoderDeps) {
  const queue = new SerialRateQueue({ minIntervalMs: GEO.minIntervalMs, maxPending: GEO.maxPending, clock: deps.queueClock });
  /** Bumped whenever the settings change, so late answers for the old provider are not handed out. */
  let generation = 0;

  function current(): { settings: GeoSettings; isDefault: boolean } {
    const stored = readStored(deps.settings.get<unknown>(GEO_SETTINGS_KEY));
    if (stored) return { settings: stored, isDefault: false };
    return { settings: deps.defaults ?? { enabled: false, baseUrl: GEO.defaultBaseUrl }, isDefault: true };
  }

  function view(): GeoSettingsView {
    const { settings, isDefault } = current();
    return {
      ...settings,
      defaultBaseUrl: GEO.defaultBaseUrl,
      isDefault,
      policyUrl: GEO.policyUrl,
      attribution: OSM_ATTRIBUTION,
      attributionUrl: OSM_COPYRIGHT_URL,
      minIntervalMs: GEO.minIntervalMs,
      cacheDays: GEO.cacheDays,
    };
  }

  const cacheKey = (baseUrl: string, point: LatLng) =>
    `${baseUrl}|${GEO.language}|z${GEO.zoom}|${roundCoord(point.lat)},${roundCoord(point.lng)}`;

  function toOutcome(answer: ReverseAnswer, cached: boolean): GeoOutcome {
    return answer.kind === 'found'
      ? { status: 'suggested', suggestion: answer.suggestion, cached }
      : { status: 'not_found', message: MESSAGES.notFound };
  }

  function readCached(key: string): ReverseAnswer | null {
    const raw = deps.cache.get(key, deps.clock());
    if (!raw) return null;
    try {
      return raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'not_found'
        ? { kind: 'not_found' }
        : parseReverse((raw as { json?: unknown }).json);
    } catch {
      return null;
    }
  }

  async function lookup(point: LatLng): Promise<GeoOutcome> {
    const { settings } = current();
    if (!settings.enabled) return { status: 'disabled', message: MESSAGES.disabled };
    const key = cacheKey(settings.baseUrl, point);
    const hit = readCached(key);
    if (hit) return toOutcome(hit, true);
    const startedIn = generation;
    try {
      const answer = await queue.run(key, async () => {
        // Settings may have changed (or another caller filled the cache) while this waited.
        if (startedIn !== generation) throw new QueueResetError('settings changed');
        const again = readCached(key);
        if (again) return { answer: again, cached: true };
        const fresh = await fetchReverse({ baseUrl: settings.baseUrl, point, userAgent: deps.userAgent, fetch: deps.fetch });
        // The raw provider document is not stored; only the parsed, bounded answer is.
        const stored = fresh.kind === 'found' ? { kind: 'found', json: suggestionDocument(fresh) } : { kind: 'not_found' };
        deps.cache.put(key, settings.baseUrl, stored, deps.clock(), GEO.cacheDays * DAY_MS);
        return { answer: fresh, cached: false };
      });
      if (startedIn !== generation) return { status: 'unavailable', message: MESSAGES.reset };
      return toOutcome(answer.answer, answer.cached);
    } catch (err) {
      if (err instanceof QueueFullError) return { status: 'unavailable', message: MESSAGES.busy };
      if (err instanceof QueueResetError) return { status: 'unavailable', message: MESSAGES.reset };
      if (err instanceof GeoLookupError) {
        deps.log(`region lookup failed: ${err.message}`);
        return { status: 'unavailable', message: `${err.message}，可以稍后重试或手动填写。` };
      }
      deps.log(`region lookup error: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 'unavailable', message: '地区识别出错了，可以稍后重试或手动填写。' };
    }
  }

  return {
    view,
    enabled: () => current().settings.enabled,
    save(next: GeoSettings, now: Date): GeoSettingsView {
      const before = current().settings;
      deps.settings.set(GEO_SETTINGS_KEY, next, now);
      if (before.enabled !== next.enabled || before.baseUrl !== next.baseUrl) {
        generation += 1;
        queue.reset();
      }
      return view();
    },
    lookup,
    /** Region suggestion for a parsed link; only its reliable place point is ever looked up. */
    async suggestForLink(parsed: ParsedMapsLink): Promise<GeoOutcome> {
      const choice = reliablePoint(parsed);
      if (!choice.ok) return { status: 'no_point', message: choice.message };
      return lookup(choice.point);
    },
    /** Exposed for tests and diagnostics. */
    queue,
  };
}

/** Stores a found answer as a minimal GeocodeJSON document so it is re-validated by parseReverse on read. */
function suggestionDocument(answer: Extract<ReverseAnswer, { kind: 'found' }>) {
  const s = answer.suggestion;
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          geocoding: { country: s.providerCountry, country_code: s.countryCode.toLowerCase(), state: s.region, city: s.city },
        },
      },
    ],
  };
}

export type Geocoder = ReturnType<typeof createGeocoder>;
