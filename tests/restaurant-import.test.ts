import { afterEach, describe, expect, it } from 'vitest';
import { BULK_IMPORT, LIMITS, MAP_LINK_INPUT_MAX } from '../shared/constants.js';
import type { RestaurantImportResponse, RestaurantImportRow } from '../shared/types.js';
import { createTestEnv, PUBLIC_ORIGIN, seedRestaurant, type Client, type TestEnv } from './helpers.js';

const PATH = '/bistro/api/admin/restaurants/import';

/** Real expansions (see map-link.test.ts); every test runs with `noNetwork`, so nothing is fetched. */
const KATSU_SHORT = 'https://maps.app.goo.gl/9f4aKWUmFPaMDfNe6';
const KATSU_CLEAN =
  'https://www.google.com/maps/place/Katsu+San+Richmond/@49.1953668,-123.1098036,13z/data=!4m6!3m5!1s0x54860baf877a0bfd:0xbbeb7dc28fc54b8a!8m2!3d49.1699676!4d-123.1818262!16s%2Fg%2F11jgc9682c';
const KATSU_TRACKED = `${KATSU_CLEAN}?entry=tts&g_ep=EgoyMDI1MTAxNC4wIPu8ASoASAFQAw%3D%3D`;
const KATSU_CID = BigInt('0xbbeb7dc28fc54b8a').toString();
const DEER_CLEAN =
  'https://www.google.com/maps/place/Deer+Garden+Signatures/@49.1793983,-123.1301568,17z/data=!4m6!3m5!1s0x5486753000a08ef7:0xd8c9468b997714a3!8m2!3d49.177903!4d-123.127564!16s%2Fg%2F1hc2_8561';
/** Same brand name as Katsu, different branch (different feature id and point). */
const KATSU_OTHER_BRANCH = 'https://www.google.com/maps/place/Katsu+San+Richmond/data=!4m2!3m1!1s0x5486000000000001:0x1234567890abcdef';

let seq = 0;
const key = () => `import-key-${Date.now()}-${(seq += 1)}`;
const row = (clientId: string, extra: Partial<RestaurantImportRow> = {}): RestaurantImportRow => ({
  clientId,
  name: `店 ${clientId}`,
  mapUrl: `https://maps.google.com/?cid=${1000 + clientId.length * 7919 + clientId.charCodeAt(clientId.length - 1)}`,
  sourceUrl: null,
  tags: [],
  ...extra,
});

async function importRows(admin: Client, rows: unknown, idem = key()) {
  return admin.post(PATH, { rows }, { headers: { 'idempotency-key': idem } });
}

const resultOf = (res: { body: { data: RestaurantImportResponse } }, clientId: string) =>
  res.body.data.results.find((r) => r.clientId === clientId)!;

describe('POST /admin/restaurants/import', () => {
  let env: TestEnv;
  afterEach(() => env.cleanup());

  it('creates valid rows, reports invalid ones per row, stores clean map links and sends no notification', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const res = await importRows(admin, [
      row('ok1', { name: '  Katsu San  ', mapUrl: KATSU_TRACKED, sourceUrl: KATSU_SHORT, tags: ['炸物', '约会', '炸物'] }),
      row('short', { name: '只有短链接', mapUrl: 'https://maps.app.goo.gl/AbCdEf1234' }),
      row('noname', { name: '   ' }),
      row('long', { name: '名'.repeat(LIMITS.name + 1) }),
      row('http', { mapUrl: 'http://www.google.com/maps/place/x' }),
      row('evil', { mapUrl: 'https://evil.example/maps/place/x' }),
      row('search', { mapUrl: 'https://www.google.com/search?q=pizza' }),
      row('nomap', { mapUrl: '' }),
      row('badsource', { sourceUrl: 'https://169.254.169.254/latest' }),
    ]);
    expect(res.status, res.text).toBe(200);
    const data = res.body.data as RestaurantImportResponse;
    expect(data).toMatchObject({ created: 2, duplicates: 0, errors: 7, replayed: false });
    expect(data.results.map((r) => r.clientId)).toEqual(['ok1', 'short', 'noname', 'long', 'http', 'evil', 'search', 'nomap', 'badsource']);
    expect(resultOf(res, 'noname')).toMatchObject({ status: 'error', field: 'name' });
    expect(resultOf(res, 'long')).toMatchObject({ status: 'error', field: 'name' });
    expect(resultOf(res, 'http')).toMatchObject({ status: 'error', field: 'mapUrl', message: expect.stringContaining('https') });
    expect(resultOf(res, 'evil')).toMatchObject({ status: 'error', field: 'mapUrl' });
    expect(resultOf(res, 'search')).toMatchObject({ status: 'error', field: 'mapUrl' });
    expect(resultOf(res, 'nomap')).toMatchObject({ status: 'error', field: 'mapUrl' });
    expect(resultOf(res, 'badsource')).toMatchObject({ status: 'error', field: 'sourceUrl' });

    const saved = env.ctx.repos.catalog.listRestaurants(false);
    expect(saved).toHaveLength(2);
    const katsu = saved.find((r) => r.name === 'Katsu San')!;
    expect(katsu).toMatchObject({ mapUrl: KATSU_CLEAN, tags: ['炸物', '约会'], active: true, review: '', address: '', links: [], imageAssetId: null });
    expect(saved.find((r) => r.name === '只有短链接')!.mapUrl).toBe('https://maps.app.goo.gl/AbCdEf1234');
    expect(resultOf(res, 'ok1')).toEqual({ clientId: 'ok1', status: 'created', restaurant: { id: katsu.id, name: 'Katsu San' } });
    expect(env.ctx.repos.notifications.list(50)).toHaveLength(0);
    expect(env.provider.sent).toHaveLength(0);
  });

  it('skips the same branch already saved (incl. inactive, by short link or CID) but not another branch or a same-name place', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const byShort = await seedRestaurant(admin, '旧的短链接记录', { mapUrl: KATSU_SHORT });
    const byCid = await seedRestaurant(admin, '已下架的同一家', { mapUrl: `https://maps.google.com/?cid=${KATSU_CID}`, active: false });
    const res = await importRows(admin, [
      row('viaShort', { name: 'Katsu', mapUrl: KATSU_CLEAN, sourceUrl: KATSU_SHORT }),
      row('viaCid', { name: 'Katsu 2', mapUrl: KATSU_TRACKED }),
      row('branch', { name: 'Katsu San Richmond', mapUrl: KATSU_OTHER_BRANCH }),
      row('sameName', { name: '旧的短链接记录', mapUrl: DEER_CLEAN }),
    ]);
    expect(res.status, res.text).toBe(200);
    const viaShort = resultOf(res, 'viaShort');
    expect(viaShort.status).toBe('duplicate');
    if (viaShort.status === 'duplicate') {
      expect(viaShort.duplicates.map((d) => d.id).sort()).toEqual([byShort.id, byCid.id].sort());
      expect(viaShort.duplicates.find((d) => d.id === byCid.id)).toMatchObject({ active: false, matchedBy: ['CID'] });
      expect(viaShort.duplicates.find((d) => d.id === byShort.id)!.matchedBy).toEqual(['相同链接']);
    }
    expect(resultOf(res, 'viaCid')).toMatchObject({ status: 'duplicate', duplicates: [{ id: byCid.id, name: '已下架的同一家' }] });
    expect(resultOf(res, 'branch').status).toBe('created');
    expect(resultOf(res, 'sameName').status).toBe('created');
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(4);
  });

  it('rechecks against rows created earlier in the same request', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const res = await importRows(admin, [
      row('first', { name: 'Deer Garden', mapUrl: DEER_CLEAN }),
      row('again', { name: '另一个名字', mapUrl: `${DEER_CLEAN}?entry=tts` }),
      row('short1', { name: '短链接甲', mapUrl: KATSU_SHORT }),
      row('short2', { name: '短链接乙', mapUrl: KATSU_CLEAN, sourceUrl: KATSU_SHORT }),
    ]);
    const first = resultOf(res, 'first');
    expect(first.status).toBe('created');
    const again = resultOf(res, 'again');
    expect(again).toMatchObject({ status: 'duplicate', duplicates: [{ name: 'Deer Garden' }] });
    if (first.status === 'created' && again.status === 'duplicate') expect(again.duplicates[0]!.id).toBe(first.restaurant.id);
    expect(resultOf(res, 'short2')).toMatchObject({ status: 'duplicate', duplicates: [{ name: '短链接甲', matchedBy: ['相同链接'] }] });
    expect(res.body.data).toMatchObject({ created: 2, duplicates: 2, errors: 0 });
  });

  it('rechecks against the latest database, not what the browser saw when previewing', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const preview = env.ctx.repos.catalog.listRestaurants(false);
    expect(preview).toHaveLength(0);
    const meanwhile = await seedRestaurant(admin, '刚刚在别处添加', { mapUrl: DEER_CLEAN });
    const res = await importRows(admin, [row('late', { name: 'Deer Garden', mapUrl: DEER_CLEAN })]);
    expect(resultOf(res, 'late')).toMatchObject({ status: 'duplicate', duplicates: [{ id: meanwhile.id }] });

    // Two imports racing with different keys: the second sees the first's insert.
    const [a, b] = await Promise.all([
      importRows(admin, [row('x', { name: 'Katsu', mapUrl: KATSU_CLEAN })]),
      importRows(admin, [row('y', { name: 'Katsu again', mapUrl: KATSU_TRACKED })]),
    ]);
    expect([a.body.data.created, b.body.data.created].sort()).toEqual([0, 1]);
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(2);
  });

  it('replays an identical retry without inserting twice and refuses a reused key with another payload', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const idem = key();
    const rows = [row('a', { name: 'Katsu', mapUrl: KATSU_CLEAN }), row('b', { name: '' })];
    const first = await importRows(admin, rows, idem);
    expect(first.body.data).toMatchObject({ created: 1, errors: 1, replayed: false });
    const replay = await importRows(admin, rows, idem);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual({ ...first.body.data, replayed: true });
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(1);

    const other = await importRows(admin, [row('a', { name: 'Katsu changed', mapUrl: KATSU_CLEAN })], idem);
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('idempotency_mismatch');

    // A new key for the same rows is a new request: the place now exists, so it is skipped.
    const fresh = await importRows(admin, rows);
    expect(fresh.body.data).toMatchObject({ created: 0, duplicates: 1, errors: 1, replayed: false });
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(1);
  });

  it('rejects malformed requests as a whole before touching the database', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const bad: [string, unknown][] = [
      ['missing rows', undefined],
      ['empty rows', []],
      ['not an array', { clientId: 'a' }],
      ['too many rows', Array.from({ length: BULK_IMPORT.maxRows + 1 }, (_, i) => row(`r${i}`))],
      ['duplicate ids', [row('same'), row('same')]],
      ['bad id', [row('has space')]],
      ['missing id', [{ name: 'x', mapUrl: KATSU_CLEAN, tags: [] }]],
      ['too many tags', [row('t', { tags: Array.from({ length: LIMITS.restaurantTags + 1 }, (_, i) => `t${i}`) })]],
      ['long tag', [row('t', { tags: ['长'.repeat(LIMITS.tag + 1)] })]],
      ['empty tag', [row('t', { tags: ['  '] })]],
      ['tag not string', [{ ...row('t'), tags: [1] }]],
      ['name not string', [{ ...row('t'), name: 42 }]],
      ['huge url', [row('t', { mapUrl: `https://www.google.com/maps/place/${'x'.repeat(MAP_LINK_INPUT_MAX)}` })]],
    ];
    for (const [label, rows] of bad) {
      const res = await admin.post(PATH, rows === undefined ? {} : { rows }, { headers: { 'idempotency-key': key() } });
      expect(res.status, label).toBe(400);
    }
    expect((await admin.post(PATH, { rows: [row('a')] })).status).toBe(400); // no Idempotency-Key
    const notJson = await admin.request('POST', PATH, { body: '{rows', headers: { 'content-type': 'application/json', 'idempotency-key': key() } });
    expect(notJson.status).toBe(400);
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(0);
  });

  it('accepts 100 maximum-size rows above the general 64 KiB limit, and only on the exact private route', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const pad = (base: string, length: number) => `${base}&utm_source=${'x'.repeat(length - base.length - 12)}`;
    const rows = Array.from({ length: BULK_IMPORT.maxRows }, (_, i) =>
      row(`row-${String(i).padStart(3, '0')}-${'z'.repeat(50)}`, {
        name: '名'.repeat(LIMITS.name),
        mapUrl: pad(`https://maps.google.com/?cid=${9_000_000 + i}`, LIMITS.url),
        sourceUrl: pad(`https://www.google.com/maps/search/?api=1&query=shop${i}`, MAP_LINK_INPUT_MAX),
        tags: Array.from({ length: LIMITS.restaurantTags }, (_, t) => `${t}${'标'.repeat(LIMITS.tag - String(t).length)}`),
      }),
    );
    const body = JSON.stringify({ rows });
    expect(Buffer.byteLength(body)).toBeGreaterThan(256 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(BULK_IMPORT.requestBytes);
    const res = await importRows(admin, rows);
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.body.data).toMatchObject({ created: BULK_IMPORT.maxRows, errors: 0 });
    // Tracking parameters are not stored.
    expect(env.ctx.repos.catalog.listRestaurants(false).every((r) => r.mapUrl!.length < 60)).toBe(true);

    const huge = await admin.request('POST', PATH, {
      body: JSON.stringify({ rows: [row('big', { name: 'x'.repeat(BULK_IMPORT.requestBytes) })] }),
      headers: { 'content-type': 'application/json', 'idempotency-key': key() },
    });
    expect(huge.status).toBe(413);

    // Every other JSON route keeps the 64 KiB limit — including near-miss spellings of this one.
    const big = JSON.stringify({ rows: [row('a', { name: 'x'.repeat(70 * 1024) })] });
    for (const p of ['/bistro/api/admin/restaurants', `${PATH}/`, '/bistro/api/admin/restaurants/import2']) {
      const r = await admin.request('POST', p, { body: big, headers: { 'content-type': 'application/json', 'idempotency-key': key() } });
      expect(r.status, p).toBe(413);
    }
    const guest = await env.guest();
    const plan = await guest.request('POST', '/bistro/api/plans', { body: big, headers: { 'content-type': 'application/json', 'idempotency-key': key() } });
    expect(plan.status).toBe(413);
  });

  it('is private: 404 on the public listener and Origin-checked on the admin listener', async () => {
    env = await createTestEnv();
    const guest = await env.guest();
    const rows = [row('a', { name: 'Katsu', mapUrl: KATSU_CLEAN })];
    const pub = await guest.post(PATH, { rows }, { headers: { 'idempotency-key': key(), origin: PUBLIC_ORIGIN } });
    expect(pub.status).toBe(404);
    const admin = await env.admin();
    const noOrigin = await admin.post(PATH, { rows }, { headers: { 'idempotency-key': key() }, origin: null });
    expect(noOrigin.status).toBe(403);
    const wrongOrigin = await admin.post(PATH, { rows }, { headers: { 'idempotency-key': key() }, origin: PUBLIC_ORIGIN });
    expect(wrongOrigin.status).toBe(403);
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(0);
  });
});
