import { afterEach, describe, expect, it } from 'vitest';
import { GEO } from '../shared/constants.js';
import { parseMapsUrl } from '../shared/mapsUrl.js';
import { fetchReverse, parseReverse, reverseUrl } from '../server/geo/nominatim.js';
import { reliablePoint } from '../server/geo/point.js';
import { QueueFullError, QueueResetError, SerialRateQueue, type QueueClock } from '../server/geo/queue.js';
import { createGeocoder } from '../server/geo/service.js';
import type { FetchLike } from '../server/notify/bark.js';
import { createTestEnv, type TestEnv } from './helpers.js';

/** A Burnaby place link: !3d/!4d is the shop, @… is only the camera. */
const BURNABY =
  'https://www.google.com/maps/place/Some+Cafe/@49.2,-123.1,13z/data=!4m6!3m5!1s0x5486000000000001:0x1234567890abcdef!8m2!3d49.22672!4d-122.99781';
const CAMERA_ONLY = 'https://www.google.com/maps/search/Some+Cafe/@49.2,-123.1,13z';
const ID_ONLY = 'https://www.google.com/maps/search/?api=1&query=Some+Cafe&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4';

function geocodeJson(g: Record<string, unknown>) {
  return {
    type: 'FeatureCollection',
    geocoding: { attribution: 'Data © OpenStreetMap contributors', licence: 'ODbL' },
    features: [{ type: 'Feature', properties: { geocoding: g } }],
  };
}

const BURNABY_ANSWER = geocodeJson({
  type: 'city',
  name: 'Burnaby',
  state: 'British Columbia',
  county: 'Metro Vancouver Regional District',
  country: 'Canada',
  country_code: 'ca',
});

/** Fake clock: sleeping advances time instantly, so the spacing can be asserted exactly. */
function fakeClock(): QueueClock & { t: number; sleeps: number[] } {
  const c = {
    t: 0,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> } | Error;

/** Fake provider that records each request (URL, headers, the fake time it started). */
function fakeGeo(reply: (url: URL) => Reply, clock?: { t: number }) {
  const calls: { url: URL; headers: Record<string, string>; redirect: RequestRedirect | undefined; at: number }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: new URL(url), headers: init.headers as Record<string, string>, redirect: init.redirect, at: clock?.t ?? 0 });
    const r = reply(new URL(url));
    if (r instanceof Error) throw r;
    const text = r.raw ?? JSON.stringify(r.body ?? BURNABY_ANSWER);
    return new Response(text, { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } });
  };
  return { fetch, calls };
}

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

describe('GeocodeJSON parsing (defensive)', () => {
  it('uses only returned fields: Chinese country from the ISO code, English region, the city itself', () => {
    expect(parseReverse(BURNABY_ANSWER)).toEqual({
      kind: 'found',
      suggestion: {
        country: '加拿大',
        countryCode: 'CA',
        region: 'British Columbia',
        city: 'Burnaby',
        providerCountry: 'Canada',
        attribution: '© OpenStreetMap contributors',
        attributionUrl: 'https://www.openstreetmap.org/copyright',
      },
    });
  });

  it('never promotes a county or district to a city, and allows a city-state without region', () => {
    const rural = parseReverse(geocodeJson({ type: 'county', name: 'Some County', county: 'Some County', state: 'Virginia', country: 'United States', country_code: 'us' }));
    expect(rural).toMatchObject({ kind: 'found', suggestion: { country: '美国', region: 'Virginia', city: '' } });
    const district = parseReverse(geocodeJson({ type: 'district', name: 'Kowloon City', district: 'Kowloon City', country: 'Hong Kong', country_code: 'hk' }));
    expect(district).toMatchObject({ suggestion: { city: '', region: '' } });
    const sg = parseReverse(geocodeJson({ type: 'city', name: 'Singapore', country: 'Singapore', country_code: 'sg' }));
    expect(sg).toMatchObject({ suggestion: { country: '新加坡', region: '', city: 'Singapore' } });
  });

  it('keeps the provider country when no ISO code is known, and treats empty/odd answers safely', () => {
    expect(parseReverse(geocodeJson({ country: 'Atlantis', state: 'North' }))).toMatchObject({ suggestion: { country: 'Atlantis', countryCode: '' } });
    expect(parseReverse({ error: 'Unable to geocode' })).toEqual({ kind: 'not_found' });
    expect(parseReverse({ type: 'FeatureCollection', features: [] })).toEqual({ kind: 'not_found' });
    expect(parseReverse(geocodeJson({ county: 'Only County' }))).toEqual({ kind: 'not_found' });
    expect(() => parseReverse('nope')).toThrow();
    expect(() => parseReverse({ features: [{ properties: 5 }] })).toThrow();
    // Bounded and cleaned: over-long values are dropped, control/bidi characters removed, non-strings ignored.
    const odd = parseReverse(
      geocodeJson({ city: 'x'.repeat(500), state: 'Brit‮ish\u0000 Columbia', country: 42, country_code: 'zz9' }),
    );
    expect(odd).toMatchObject({ kind: 'found', suggestion: { city: '', region: 'British Columbia', country: '', countryCode: '' } });
  });

  it('builds the documented reverse request (geocodejson, English, address layer, zoom 10, rounded point)', () => {
    const url = new URL(reverseUrl('https://geo.example/nominatim', { lat: 49.226721234, lng: -122.997812345 }));
    expect(url.origin + url.pathname).toBe('https://geo.example/nominatim/reverse');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'geocodejson',
      lat: '49.22672',
      lon: '-122.99781',
      zoom: '10',
      layer: 'address',
      addressdetails: '1',
      'accept-language': 'en',
    });
  });

  it('refuses redirects, oversized bodies, bad JSON and timeouts with a readable error', async () => {
    const req = (reply: Reply) => fetchReverse({ baseUrl: 'https://geo.example', point: { lat: 1, lng: 2 }, userAgent: 'UA', fetch: fakeGeo(() => reply).fetch });
    await expect(req({ status: 302, headers: { location: 'https://evil.example/' } })).rejects.toThrow('跳转');
    await expect(req({ raw: 'x'.repeat(GEO.maxResponseBytes + 10) })).rejects.toThrow('太大');
    await expect(req({ raw: '{', headers: {} })).rejects.toThrow('无法识别');
    await expect(req({ status: 429, body: {} })).rejects.toThrow('繁忙');
    await expect(req({ status: 503, body: {} })).rejects.toThrow('503');
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await expect(req(timeout)).rejects.toThrow('超时');
    const { fetch, calls } = fakeGeo(() => ({ body: BURNABY_ANSWER }));
    await fetchReverse({ baseUrl: 'https://geo.example', point: { lat: 1, lng: 2 }, userAgent: 'BistroExpress/1.0 (+x)', fetch });
    expect(calls[0]).toMatchObject({ redirect: 'manual', headers: { 'user-agent': 'BistroExpress/1.0 (+x)' } });
  });
});

describe('which coordinates may be looked up', () => {
  const choice = (url: string) => reliablePoint(parseMapsUrl(new URL(url)));
  it('uses the place point of a place link, never the camera, a search, or an ID without coordinates', () => {
    expect(choice(BURNABY)).toEqual({ ok: true, point: { lat: 49.22672, lng: -122.99781 } });
    expect(choice(CAMERA_ONLY)).toMatchObject({ ok: false, message: expect.stringContaining('视角') });
    expect(choice(ID_ONLY)).toMatchObject({ ok: false, message: expect.stringContaining('地点编号') });
    expect(choice('https://www.google.com/maps/search/Some+Cafe/data=!3d49.1!4d-123.1')).toMatchObject({ ok: false });
    expect(choice('https://www.google.com/maps?q=49.17,-123.12')).toEqual({ ok: true, point: { lat: 49.17, lng: -123.12 } });
  });
});

describe('one shared, spaced, bounded queue', () => {
  it('starts requests at least 1100 ms apart, one at a time, and coalesces identical work', async () => {
    const clock = fakeClock();
    const q = new SerialRateQueue({ minIntervalMs: 1100, maxPending: 5, clock });
    const starts: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (v: string) => async () => {
      starts.push(clock.t);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
      return v;
    };
    const a = q.run('a', task('A'));
    const b = q.run('b', task('B'));
    const a2 = q.run('a', task('A-again')); // same key while pending: shared, not sent twice
    const c = q.run('c', task('C'));
    expect(await Promise.all([a, b, a2, c])).toEqual(['A', 'B', 'A', 'C']);
    expect(starts).toEqual([0, 1100, 2200]);
    expect(maxRunning).toBe(1);
    expect(q.started).toBe(3);
  });

  it('refuses work beyond the bound and drops waiting work on reset', async () => {
    const clock = fakeClock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new SerialRateQueue({ minIntervalMs: 1100, maxPending: 1, clock });
    const first = q.run('1', async () => {
      await gate;
      return 1;
    });
    await Promise.resolve();
    const second = q.run('2', async () => 2);
    await expect(q.run('3', async () => 3)).rejects.toBeInstanceOf(QueueFullError);
    q.reset();
    await expect(second).rejects.toBeInstanceOf(QueueResetError);
    release();
    expect(await first).toBe(1); // a running request finishes on its own
  });
});

describe('region lookup through the admin API', () => {
  const resolve = (client: Awaited<ReturnType<TestEnv['admin']>>, url: string, geo = true) =>
    client.post('/bistro/api/admin/restaurants/resolve-map-link', geo ? { url, geo } : { url });

  it('is off without configuration and never fetches; old previews never ask for a region', async () => {
    const provider = fakeGeo(() => ({ body: BURNABY_ANSWER }));
    env = await createTestEnv(undefined, { geo: { fetch: provider.fetch, queueClock: fakeClock() } });
    const admin = await env.admin();
    const plain = await resolve(admin, BURNABY, false);
    expect(plain.status).toBe(200);
    expect(plain.body.data).not.toHaveProperty('geo');
    const off = await resolve(admin, BURNABY);
    expect(off.body.data.geo).toMatchObject({ status: 'disabled' });
    expect(off.body.data.name).toBe('Some Cafe'); // the link preview itself still works
    expect(provider.calls).toHaveLength(0);
  });

  it('suggests a region from the place point, caches it (also for a restarted service) and identifies itself', async () => {
    const clock = fakeClock();
    const provider = fakeGeo(() => ({ body: BURNABY_ANSWER }), clock);
    env = await createTestEnv(undefined, {
      geocoder: { enabled: true, baseUrl: 'https://geo.example' },
      geo: { fetch: provider.fetch, queueClock: clock },
    });
    const admin = await env.admin();
    const first = await resolve(admin, BURNABY);
    expect(first.body.data.geo).toMatchObject({
      status: 'suggested',
      cached: false,
      suggestion: { country: '加拿大', countryCode: 'CA', region: 'British Columbia', city: 'Burnaby' },
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.headers['user-agent']).toBe('BistroExpress/1.0 (+https://public.test/bistro)');
    expect(provider.calls[0]!.url.searchParams.get('lat')).toBe('49.22672');

    const again = await resolve(admin, BURNABY);
    expect(again.body.data.geo).toMatchObject({ status: 'suggested', cached: true });
    // A fresh service on the same database (as after a restart) still answers from the cache.
    const restarted = createGeocoder({
      settings: env.ctx.repos.settings,
      cache: env.ctx.repos.geoCache,
      defaults: { enabled: true, baseUrl: 'https://geo.example' },
      fetch: provider.fetch,
      clock: env.ctx.clock,
      queueClock: clock,
      userAgent: 'UA',
      log: () => {},
    });
    expect(await restarted.lookup({ lat: 49.22672, lng: -122.99781 })).toMatchObject({ status: 'suggested', cached: true });
    expect(provider.calls).toHaveLength(1);

    // Camera-only and ID-only links are answered without any request.
    expect((await resolve(admin, CAMERA_ONLY)).body.data.geo).toMatchObject({ status: 'no_point' });
    expect((await resolve(admin, ID_ONLY)).body.data.geo).toMatchObject({ status: 'no_point' });
    expect(provider.calls).toHaveLength(1);
  });

  it('spaces concurrent lookups across the app and never loses the link preview on failure', async () => {
    const clock = fakeClock();
    let fail = false;
    const provider = fakeGeo(() => (fail ? new Error('ECONNRESET') : { body: BURNABY_ANSWER }), clock);
    env = await createTestEnv(undefined, {
      geocoder: { enabled: true, baseUrl: 'https://geo.example' },
      geo: { fetch: provider.fetch, queueClock: clock },
    });
    const admin = await env.admin();
    const links = [1, 2, 3].map((i) => BURNABY.replace('!3d49.22672', `!3d49.2267${i}`));
    const results = await Promise.all(links.map((l) => resolve(admin, l)));
    expect(results.every((r) => r.body.data.geo.status === 'suggested')).toBe(true);
    const starts = provider.calls.map((c) => c.at);
    expect(starts).toHaveLength(3);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(GEO.minIntervalMs);

    fail = true;
    const failed = await resolve(admin, BURNABY.replace('!3d49.22672', '!3d49.3'));
    expect(failed.status).toBe(200);
    expect(failed.body.data).toMatchObject({ name: 'Some Cafe', geo: { status: 'unavailable' } });
    // Errors are not cached: a later retry asks again.
    fail = false;
    expect((await resolve(admin, BURNABY.replace('!3d49.22672', '!3d49.3'))).body.data.geo.status).toBe('suggested');
  });

  it('settings: switchable without code, provider-separated cache, admin-only and origin-checked', async () => {
    const clock = fakeClock();
    const provider = fakeGeo(() => ({ body: BURNABY_ANSWER }), clock);
    env = await createTestEnv(undefined, {
      geocoder: { enabled: true, baseUrl: 'https://geo.example' },
      geo: { fetch: provider.fetch, queueClock: clock },
    });
    const admin = await env.admin();
    expect((await admin.get('/bistro/api/admin/geo/settings')).body.data).toMatchObject({
      enabled: true,
      baseUrl: 'https://geo.example',
      isDefault: true,
      defaultBaseUrl: 'https://nominatim.openstreetmap.org',
    });
    await resolve(admin, BURNABY);
    expect(provider.calls).toHaveLength(1);

    const switched = await admin.put('/bistro/api/admin/geo/settings', { enabled: true, baseUrl: 'https://mirror.example/nominatim/' });
    expect(switched.body.data).toMatchObject({ baseUrl: 'https://mirror.example/nominatim', isDefault: false });
    await resolve(admin, BURNABY);
    expect(provider.calls).toHaveLength(2); // another provider: not served from the first one's cache
    expect(provider.calls[1]!.url.href.startsWith('https://mirror.example/nominatim/reverse?')).toBe(true);

    await admin.put('/bistro/api/admin/geo/settings', { enabled: false, baseUrl: 'https://mirror.example/nominatim' });
    expect((await resolve(admin, BURNABY)).body.data.geo.status).toBe('disabled');
    expect(provider.calls).toHaveLength(2);

    for (const baseUrl of ['ftp://x.example', 'https://u:p@x.example', 'https://x.example/?q=1', 'not a url']) {
      expect((await admin.put('/bistro/api/admin/geo/settings', { enabled: true, baseUrl })).status).toBe(400);
    }
    const noOrigin = await admin.put('/bistro/api/admin/geo/settings', { enabled: true, baseUrl: 'https://x.example' }, { origin: null });
    expect(noOrigin.status).toBe(403);

    const guest = await env.guest();
    expect((await guest.get('/bistro/api/admin/geo/settings')).status).toBe(404);
    expect((await guest.put('/bistro/api/admin/geo/settings', { enabled: true, baseUrl: 'https://x.example' })).status).toBe(404);
    expect((await guest.post('/bistro/api/admin/restaurants/resolve-map-link', { url: BURNABY, geo: true })).status).toBe(404);
  });
});
