import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../server/notify/bark.js';
import { cidFromFtid, classifyMapsUrl, parseMapsUrl } from '../server/maps/parse.js';
import { extractLink, MapLinkError, resolveMapsLink } from '../server/maps/resolve.js';
import { createTestEnv, seedRestaurant, type TestEnv } from './helpers.js';

/** Real share links and their expansions as verified on whitepc (tracking values shortened). */
const KATSU_SHORT = 'https://maps.app.goo.gl/9f4aKWUmFPaMDfNe6';
const KATSU_FULL =
  'https://www.google.com/maps/place/Katsu+San+Richmond/@49.1953668,-123.1098036,13z/data=!4m6!3m5!1s0x54860baf877a0bfd:0xbbeb7dc28fc54b8a!8m2!3d49.1699676!4d-123.1818262!16s%2Fg%2F11jgc9682c?entry=tts&g_ep=EgoyMDI1MTAxNC4wIPu8ASoASAFQAw%3D%3D&skid=0b6c6ad1-aaaa-bbbb-cccc-1234567890ab';
const DEER_SHORT = 'https://maps.app.goo.gl/vh524oStWovWvmhp8';
const DEER_FULL =
  'https://www.google.com/maps/place/Deer+Garden+Signatures/@49.1793983,-123.1301568,17z/data=!4m6!3m5!1s0x5486753000a08ef7:0xd8c9468b997714a3!8m2!3d49.177903!4d-123.127564!16s%2Fg%2F1hc2_8561?entry=tts&g_ep=EgoyMDI1MTAxNC4wIPu8ASoASAFQAw%3D%3D&skid=ffffffff-1111-2222-3333-444444444444';

type Route = { status: number; location?: string } | Error;

/** Fake fetch serving canned redirect responses; records every requested URL. */
function fakeRedirects(routes: Record<string, Route>) {
  const requested: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    requested.push({ url, redirect: init.redirect });
    const route = routes[url];
    if (!route) throw new Error(`unexpected request ${url}`);
    if (route instanceof Error) throw route;
    const headers = route.location ? { location: route.location } : undefined;
    return new Response('<html><title>Google Maps</title></html>', { status: route.status, headers });
  };
  return { fetch, requested };
}

const unresolved = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(MapLinkError);

describe('Google Maps URL parsing (no network)', () => {
  it('reads name, place point, ids and camera from the real Katsu San expansion', () => {
    const c = classifyMapsUrl(KATSU_FULL);
    expect(c.ok && c.kind).toBe('maps');
    const p = parseMapsUrl(new URL(KATSU_FULL));
    expect(p).toMatchObject({
      name: 'Katsu San Richmond',
      nameSource: 'place',
      ftid: '0x54860baf877a0bfd:0xbbeb7dc28fc54b8a',
      kgId: '/g/11jgc9682c',
      place: { lat: 49.1699676, lng: -123.1818262 },
      camera: { lat: 49.1953668, lng: -123.1098036, zoom: 13 },
      cidDerived: true,
      placeId: null,
    });
    expect(p.cid).toBe(BigInt('0xbbeb7dc28fc54b8a').toString());
    // Tracking parameters are dropped; the place path and data are kept.
    expect(p.cleanUrl).toBe(KATSU_FULL.split('?')[0]);
  });

  it('distinguishes the place point from the camera centre for Deer Garden', () => {
    const p = parseMapsUrl(new URL(DEER_FULL));
    expect(p.name).toBe('Deer Garden Signatures');
    expect(p.place).toEqual({ lat: 49.177903, lng: -123.127564 });
    expect(p.camera).toMatchObject({ lat: 49.1793983, lng: -123.1301568, zoom: 17 });
    expect(p.kgId).toBe('/g/1hc2_8561');
  });

  it('parses query-style Maps URLs (api=1 query/query_place_id, q, cid, ftid)', () => {
    const search = parseMapsUrl(
      new URL('https://www.google.com/maps/search/?api=1&query=Caf%C3%A9+%E5%B0%8F%E9%A6%86&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4'),
    );
    expect(search).toMatchObject({ name: 'Café 小馆', nameSource: 'query', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' });
    expect(search.cleanUrl).toContain('query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4');

    const coords = parseMapsUrl(new URL('https://maps.google.com/maps?q=49.17,-123.12&utm_source=x'));
    expect(coords).toMatchObject({ name: null, place: { lat: 49.17, lng: -123.12 } });
    expect(coords.cleanUrl).toBe('https://maps.google.com/maps?q=49.17%2C-123.12');

    const cid = parseMapsUrl(new URL('https://maps.google.com/?cid=13540235218587814794'));
    expect(cid).toMatchObject({ cid: '13540235218587814794', cidDerived: false });

    const ftid = parseMapsUrl(new URL('https://www.google.com/maps?q=Deer+Garden&ftid=0x5486753000a08ef7:0xd8c9468b997714a3'));
    expect(ftid).toMatchObject({ name: 'Deer Garden', ftid: '0x5486753000a08ef7:0xd8c9468b997714a3' });
  });

  it('treats decoded text as plain data (control/bidi characters removed, nothing executed)', () => {
    const p = parseMapsUrl(new URL('https://www.google.com/maps/place/%3Cscript%3Ealert(1)%3C%2Fscript%3E%E2%80%AE%0A+Bar/'));
    expect(p.name).toBe('<script>alert(1)</script> Bar');
  });

  it('derives the CID from the feature id', () => {
    expect(cidFromFtid('0x0:0x10')).toBe('16');
    expect(cidFromFtid('nonsense')).toBeNull();
  });

  it.each([
    ['http://maps.app.goo.gl/9f4aKWUmFPaMDfNe6', 'https'],
    ['https://user:pw@maps.app.goo.gl/9f4aKWUmFPaMDfNe6', '用户名'],
    ['https://maps.app.goo.gl:8443/9f4aKWUmFPaMDfNe6', '端口'],
    ['https://127.0.0.1/maps/place/x', 'IP'],
    ['https://[::1]/maps/place/x', 'IP'],
    ['https://localhost/maps/place/x', 'IP'],
    ['https://maps.app.goo.gl.evil.com/abcd', 'Google 地图'],
    ['https://evil.com/maps/place/x', 'Google 地图'],
    ['https://www.google.com/search?q=pizza', '不是地图'],
    ['https://goo.gl/abcdef', '短链接'],
    ['https://maps.app.goo.gl/../../etc', '短链接'],
    ['javascript:alert(1)', 'https'],
  ])('rejects %s', (url, reason) => {
    const c = classifyMapsUrl(url);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain(reason);
  });

  it('extracts the link from pasted share text', () => {
    expect(extractLink(`Katsu San Richmond\n${KATSU_SHORT}`)).toBe(KATSU_SHORT);
    expect(extractLink('没有链接')).toBeNull();
  });
});

describe('short link expansion (mocked redirects)', () => {
  it('follows maps.app.goo.gl with manual redirects and stops at the Google Maps place URL', async () => {
    const { fetch, requested } = fakeRedirects({ [KATSU_SHORT]: { status: 302, location: KATSU_FULL } });
    const r = await resolveMapsLink(KATSU_SHORT, fetch);
    expect(r).toMatchObject({ sourceUrl: KATSU_SHORT, expanded: true, hops: 1 });
    expect(r.parsed.name).toBe('Katsu San Richmond');
    // Only the short link is requested — never the google.com page itself.
    expect(requested).toEqual([{ url: KATSU_SHORT, redirect: 'manual' }]);
  });

  it('parses full Google Maps links without any request', async () => {
    const { fetch, requested } = fakeRedirects({});
    const r = await resolveMapsLink(DEER_FULL, fetch);
    expect(r.expanded).toBe(false);
    expect(requested).toHaveLength(0);
  });

  it('validates every hop: redirects to other hosts, http, or consent pages are refused', async () => {
    const cases: [string, string][] = [
      ['https://evil.example/maps/place/x', 'evil.example'],
      ['http://www.google.com/maps/place/x', 'www.google.com'],
      ['https://consent.google.com/m?continue=https://www.google.com/maps/place/x', 'Cookie'],
      ['https://169.254.169.254/latest/meta-data', '169.254.169.254'],
    ];
    for (const [location, message] of cases) {
      const { fetch, requested } = fakeRedirects({ [KATSU_SHORT]: { status: 301, location } });
      await expect(resolveMapsLink(KATSU_SHORT, fetch)).rejects.toThrow(message);
      expect(requested).toHaveLength(1);
    }
  });

  it('bounds the number of hops', async () => {
    const loop: Record<string, Route> = {};
    for (let i = 0; i < 8; i += 1) loop[`https://maps.app.goo.gl/hop${i}x`] = { status: 302, location: `/hop${i + 1}x` };
    const { fetch, requested } = fakeRedirects(loop);
    await expect(resolveMapsLink('https://maps.app.goo.gl/hop0x', fetch)).rejects.toThrow('跳转次数太多');
    expect(requested).toHaveLength(5);
  });

  it('reports dead links, missing Location and network failures clearly', async () => {
    await expect(resolveMapsLink(KATSU_SHORT, fakeRedirects({ [KATSU_SHORT]: { status: 404 } }).fetch)).rejects.toThrow('可能已失效');
    await expect(resolveMapsLink(KATSU_SHORT, fakeRedirects({ [KATSU_SHORT]: { status: 302 } }).fetch)).rejects.toThrow('有效的跳转');
    await expect(resolveMapsLink(KATSU_SHORT, fakeRedirects({ [KATSU_SHORT]: new TypeError('fetch failed') }).fetch)).rejects.toThrow(
      '连不上',
    );
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    await expect(resolveMapsLink(KATSU_SHORT, slow, { timeoutMs: 20 })).rejects.toThrow('超时');
    await unresolved(resolveMapsLink('ftp://maps.app.goo.gl/x', fakeRedirects({}).fetch));
  });
});

describe('POST /admin/restaurants/resolve-map-link', () => {
  let env: TestEnv;
  afterEach(() => env.cleanup());

  const PATH = '/bistro/api/admin/restaurants/resolve-map-link';
  const routes = {
    [KATSU_SHORT]: { status: 302, location: KATSU_FULL },
    [DEER_SHORT]: { status: 302, location: DEER_FULL },
  };

  it('returns an editable preview, fills only what the link contains, and never creates a restaurant', async () => {
    env = await createTestEnv(undefined, { fetch: fakeRedirects(routes).fetch });
    const admin = await env.admin();
    const res = await admin.post(PATH, { url: `Katsu San Richmond ${KATSU_SHORT}` });
    expect(res.status, res.text).toBe(200);
    expect(res.body.data).toMatchObject({
      sourceUrl: KATSU_SHORT,
      resolvedUrl: KATSU_FULL.split('?')[0],
      mapUrl: KATSU_FULL.split('?')[0],
      expanded: true,
      name: 'Katsu San Richmond',
      place: { lat: 49.1699676, lng: -123.1818262 },
      duplicates: [],
    });
    expect(res.body.data).not.toHaveProperty('address');
    expect(res.body.data).not.toHaveProperty('rating');
    expect(res.body.data.notes.join()).toContain('地址');
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(0);
  });

  it('warns about the same branch by link, FTID or CID — but not about another branch of the brand', async () => {
    env = await createTestEnv(undefined, { fetch: fakeRedirects(routes).fetch });
    const admin = await env.admin();
    const byShort = await seedRestaurant(admin, '炸猪排（短链接）', { mapUrl: KATSU_SHORT });
    const byCid = await seedRestaurant(admin, '炸猪排（CID）', {
      mapUrl: `https://maps.google.com/?cid=${BigInt('0xbbeb7dc28fc54b8a').toString()}`,
      active: false,
    });
    await seedRestaurant(admin, 'Katsu San 另一家分店', {
      mapUrl: 'https://www.google.com/maps/place/Katsu+San+Richmond/data=!4m2!3m1!1s0x5486000000000001:0x1234567890abcdef',
    });
    await seedRestaurant(admin, '没有地图链接');
    const res = await admin.post(PATH, { url: KATSU_SHORT });
    const dups = res.body.data.duplicates as { id: string; active: boolean; matchedBy: string[] }[];
    expect(dups.map((d) => d.id).sort()).toEqual([byShort.id, byCid.id].sort());
    expect(dups.find((d) => d.id === byShort.id)!.matchedBy).toEqual(['相同链接']);
    expect(dups.find((d) => d.id === byCid.id)).toMatchObject({ active: false, matchedBy: ['CID'] });
  });

  it('fails with a clear, retryable explanation and stays admin-only', async () => {
    env = await createTestEnv(undefined, { fetch: fakeRedirects({ [DEER_SHORT]: { status: 404 } }).fetch });
    const admin = await env.admin();
    const dead = await admin.post(PATH, { url: DEER_SHORT });
    expect(dead.status).toBe(422);
    expect(dead.body.error).toMatchObject({ code: 'map_link_unresolved' });
    const notGoogle = await admin.post(PATH, { url: 'https://example.com/maps/place/x' });
    expect(notGoogle.body.error.code).toBe('map_link_invalid');
    expect((await admin.post(PATH, { url: 'x'.repeat(3000) })).status).toBe(400);
    expect((await admin.post(PATH, { url: 'https://www.google.com/maps/@49.1,-123.1,13z' })).status).toBe(422);

    const guest = await env.guest();
    expect((await guest.post(PATH, { url: KATSU_SHORT })).status).toBe(404);
    expect((await env.adminClient().post(PATH, { url: KATSU_SHORT })).status).toBe(401);
  });

  it('rate-limits outbound expansion', async () => {
    env = await createTestEnv(undefined, { fetch: fakeRedirects(routes).fetch });
    const admin = await env.admin();
    for (let i = 0; i < 30; i += 1) expect((await admin.post(PATH, { url: DEER_FULL })).status).toBe(200);
    const limited = await admin.post(PATH, { url: DEER_FULL });
    expect(limited.status).toBe(429);
    env.advance(10 * 60_000 + 1);
    expect((await admin.post(PATH, { url: DEER_FULL })).status).toBe(200);
  });
});
