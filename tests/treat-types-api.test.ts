import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../server/db/migrations.js';
import { createTestEnv, idem, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

const R = '/bistro/api/admin/restaurants';

async function venue(admin: Client, body: Record<string, unknown>) {
  const res = await admin.post(R, body);
  if (res.status !== 201) throw new Error(res.text);
  return res.body.data as { id: string; name: string; purposes: string[]; treatTypes: string[]; updatedAt: string };
}

const treatOuting = (candidateIds: string[]) => ({
  date: '2030-01-20',
  mealLabel: '下午茶',
  localTime: '15:00',
  timeZone: 'America/Vancouver',
  mode: 'restaurant',
  purpose: 'treat',
  note: '',
  dishIds: [],
  candidateIds,
  selectedRestaurantId: candidateIds[0] ?? null,
});

describe('treat types through the admin API', () => {
  it('derives types from the single tag list, rejects unknown legacy choices and preserves entry', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const inferred = await venue(admin, { name: '老客户端奶茶', tags: ['奶茶', '芋泥'], purposes: ['treat'] });
    expect(inferred.treatTypes).toEqual(['milk_tea']);
    const v = await venue(admin, { name: '甜品屋', tags: ['奶茶'], purposes: ['treat'], treatTypes: ['cake', 'milk_tea'] });
    expect(v.treatTypes).toEqual(['milk_tea', 'cake']);
    expect((await venue(admin, { name: '未分类', tags: ['奶茶'], purposes: ['treat'], treatTypes: [] })).treatTypes).toEqual(['milk_tea']);

    // An older page that does not know types keeps them.
    const older = await admin.put(`${R}/${v.id}`, { name: '甜品屋', tags: ['甜品'] });
    expect(older.body.data.treatTypes).toEqual(['tong_sui']);
    // Meal-only keeps them stored for later.
    const meal = await admin.put(`${R}/${v.id}`, { name: '甜品屋', purposes: ['meal'] });
    expect(meal.body.data).toMatchObject({ purposes: ['meal'], tags: ['甜品'], treatTypes: ['tong_sui'] });
    expect((await admin.put(`${R}/${v.id}`, { name: '甜品屋', treatTypes: ['tea'] })).status).toBe(400);
    expect((await admin.post(R, { name: 'x', purposes: ['treat'], treatTypes: 'coffee' })).status).toBe(400);
    const cleared = await admin.put(`${R}/${v.id}`, { name: '甜品屋', purposes: ['treat'], tags: [] });
    expect(cleared.body.data.treatTypes).toEqual([]);

    // Guests read the same field (no private data involved).
    const guest = await env.guest();
    const catalog = (await guest.get('/bistro/api/catalog')).body.data.restaurants as { name: string; treatTypes: string[] }[];
    expect(catalog.find((r) => r.name === '老客户端奶茶')?.treatTypes).toEqual(['milk_tea']);
  });

  it('freezes types in plan snapshots; later catalog edits never change them', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const shop = await venue(admin, { name: '咖啡店', purposes: ['treat'], treatTypes: ['coffee'] });
    const guest = await env.guest();
    const created = await guest.post('/bistro/api/plans', treatOuting([shop.id]), idem());
    expect(created.status).toBe(201);
    expect(created.body.data.selectedRestaurant.treatTypes).toEqual(['coffee']);
    await admin.put(`${R}/${shop.id}`, { name: '咖啡店', treatTypes: ['cake'] });
    const again = (await guest.get(`/bistro/api/plans/${created.body.data.id}`)).body.data;
    expect(again.selectedRestaurant.treatTypes).toEqual(['coffee']);
    expect(again.candidates[0].treatTypes).toEqual(['coffee']);
  });

  it('bulk import merges legacy choices into tags; bad choices fail just that row', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const link = (n: number) => `https://www.google.com/maps/place/Shop/data=!4m2!3m1!1s0x5486000000000001:0x00000000000000${n}0`;
    const res = await admin.post(
      `${R}/import`,
      {
        rows: [
          { clientId: 'a', name: '自动', mapUrl: link(1), sourceUrl: null, tags: ['奶茶', '咖啡'], purposes: ['treat'] },
          { clientId: 'b', name: '空', mapUrl: link(2), sourceUrl: null, tags: ['奶茶'], purposes: ['treat'], treatTypes: [] },
          { clientId: 'c', name: '吃饭', mapUrl: link(3), sourceUrl: null, tags: ['奶茶'] },
          { clientId: 'd', name: '坏', mapUrl: link(4), sourceUrl: null, tags: [], purposes: ['treat'], treatTypes: ['tea'] },
          { clientId: 'e', name: '明确', mapUrl: link(5), sourceUrl: null, tags: ['奶茶'], purposes: ['treat'], treatTypes: ['bakery'] },
        ],
      },
      idem(),
    );
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.data.results.map((r: { clientId: string }) => [r.clientId, r]));
    expect(by.d).toMatchObject({ status: 'error', field: 'treatTypes' });
    const list = (await admin.get(R)).body.data as { name: string; treatTypes: string[] }[];
    const types = (name: string) => list.find((r) => r.name === name)?.treatTypes;
    expect(types('自动')).toEqual(['milk_tea', 'coffee']);
    expect(types('空')).toEqual(['milk_tea']);
    expect(types('吃饭')).toEqual(['milk_tea']);
    expect(types('明确')).toEqual(['milk_tea', 'bakery']);
    expect(types('坏')).toBeUndefined();
  });
});

describe('migration 8 followed by unified tags', () => {
  const TS = '2030-01-01T00:00:00Z';
  const PID = '88888888-8888-4888-8888-888888888888';
  const SHOPS = [
    { id: '00000000-0000-4000-8000-000000000081', name: '奶茶店', tags: '["奶茶","約會"]', purposes: '["treat"]' },
    { id: '00000000-0000-4000-8000-000000000082', name: '两用', tags: '["咖啡館","麵包"]', purposes: '["meal","treat"]' },
    { id: '00000000-0000-4000-8000-000000000083', name: '拿铁', tags: '["奶茶拿铁","咖啡色"]', purposes: '["treat"]' },
    { id: '00000000-0000-4000-8000-000000000084', name: '饭店', tags: '["奶茶","咖啡"]', purposes: '["meal"]' },
    { id: '00000000-0000-4000-8000-000000000085', name: '坏数据', tags: 'not json', purposes: 'nope' },
  ];
  const SNAP = {
    id: SHOPS[0]!.id,
    name: '奶茶店',
    imageAssetId: null,
    review: '',
    tags: ['奶茶'],
    budgetText: '',
    address: '',
    mapUrl: null,
    links: [],
    location: { country: '', countryCode: '', region: '', city: '', source: '' },
    purposes: ['treat'],
  };

  function seedV7(dataDir: string) {
    const db = new Database(path.join(dataDir, 'bistro.sqlite'));
    runMigrations(db, 7);
    const insert = db.prepare(
      `INSERT INTO restaurants (id, name, tags, purposes_json, budget_text, address, note, active, created_at, updated_at, links_json)
       VALUES (?, ?, ?, ?, '', '', '', 1, ?, ?, '[]')`,
    );
    for (const s of SHOPS) insert.run(s.id, s.name, s.tags, s.purposes, TS, TS);
    db.prepare(
      `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, purpose, candidates_json, selected_json, created_at, updated_at)
       VALUES (?, 'OLD888', 'active', 1, '2030-01-20', '下午茶', 'Asia/Shanghai', 'restaurant', 'treat', ?, ?, ?, ?)`,
    ).run(PID, JSON.stringify([SNAP]), JSON.stringify(SNAP), TS, TS);
    db.close();
  }

  it('keeps classifications while deriving the compatibility cache for every live shop', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV7 });
    const rows = env.ctx.db.prepare('SELECT id, tags, purposes_json, treat_types_json, updated_at FROM restaurants ORDER BY id').all() as Record<string, string>[];
    expect(rows.map((r) => r.treat_types_json)).toEqual(['["milk_tea"]', '["coffee","bakery"]', '[]', '["milk_tea","coffee"]', '[]']);
    // Tags, purposes and timestamps are exactly as before; the meal shop did not become a treat shop.
    expect(rows.map((r) => [r.tags, r.purposes_json, r.updated_at])).toEqual(SHOPS.map((s) => [s.tags, s.purposes, TS]));

    const plan = env.ctx.db.prepare('SELECT selected_json, candidates_json, updated_at FROM plans WHERE id = ?').get(PID) as Record<string, string>;
    expect(JSON.parse(plan.selected_json!)).toEqual(SNAP);
    expect(JSON.parse(plan.candidates_json!)).toEqual([SNAP]);
    expect(plan.updated_at).toBe(TS);

    // Historical snapshots read as 未分类, never filled in from the live catalog.
    const guest = await env.guest();
    const read = (await guest.get(`/bistro/api/plans/${PID}`)).body.data;
    expect(read.selectedRestaurant.treatTypes).toEqual([]);

    // Corrupt stored values read safely.
    env.ctx.db.prepare(`UPDATE restaurants SET treat_types_json = '{oops' WHERE id = ?`).run(SHOPS[0]!.id);
    const admin = await env.admin();
    const list = (await admin.get(R)).body.data as { id: string; treatTypes: string[] }[];
    expect(list.find((r) => r.id === SHOPS[0]!.id)?.treatTypes).toEqual(['milk_tea']);
    expect(runMigrations(env.ctx.db)).toEqual([]);
  });
});
