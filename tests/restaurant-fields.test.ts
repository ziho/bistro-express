import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../shared/constants.js';
import { migrateRestaurantClassification, runMigrations } from '../server/db/migrations.js';
import { createTestEnv, idem, seedRestaurant, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

const TS = '2030-01-01T00:00:00Z';
const ID = {
  plain: '00000000-0000-4000-8000-000000000001',
  dup: '00000000-0000-4000-8000-000000000002',
  full: '00000000-0000-4000-8000-000000000003',
  multi: '00000000-0000-4000-8000-000000000004',
  noCuisine: '00000000-0000-4000-8000-000000000005',
  corrupt: '00000000-0000-4000-8000-000000000006',
};
const LEGACY_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const TWELVE_TAGS = Array.from({ length: LIMITS.tags }, (_, i) => `标签${i + 1}`);
const LEGACY_SNAPSHOT = {
  id: ID.plain,
  name: '面馆',
  cuisine: '川菜',
  imageAssetId: null,
  budgetText: '人均 50',
  address: '某路 1 号',
  mapUrl: 'https://maps.app.goo.gl/abc',
};

/** A database as written by the previous release: schema v2 with cuisine and old-style plan snapshots. */
function seedV2(dataDir: string) {
  const db = new Database(path.join(dataDir, 'bistro.sqlite'));
  runMigrations(db, 2);
  const insert = db.prepare(
    `INSERT INTO restaurants (id, name, cuisine, tags, budget_text, address, map_url, note, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  insert.run(ID.plain, '面馆', '川菜', '["约会"]', '人均 50', '某路 1 号', LEGACY_SNAPSHOT.mapUrl, '周末要排队', TS, TS);
  insert.run(ID.dup, '火锅店', ' 火锅 ', '["火锅","聚餐"]', '', '', null, '', TS, TS);
  insert.run(ID.full, '满标签', '日料', JSON.stringify(TWELVE_TAGS), '', '', null, '', TS, TS);
  insert.run(ID.multi, '多菜系', '粤菜、茶餐厅', '[]', '', '', null, '', TS, TS);
  insert.run(ID.noCuisine, '小吃摊', '', '["小吃"]', '', '', null, '', TS, TS);
  insert.run(ID.corrupt, '坏数据', '西餐', '{oops', '', '', null, '', TS, TS);

  db.prepare(
    `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, candidates_json, selected_json,
     created_at, updated_at) VALUES (?, 'OLD234', 'active', 1, '2030-01-20', '晚餐', 'Asia/Shanghai', 'restaurant', ?, ?, ?, ?)`,
  ).run(LEGACY_PLAN_ID, JSON.stringify([LEGACY_SNAPSHOT]), JSON.stringify(LEGACY_SNAPSHOT), TS, TS);
  db.prepare(`INSERT INTO plan_refs (plan_id, kind, item_id) VALUES (?, 'restaurant', ?)`).run(LEGACY_PLAN_ID, ID.plain);
  db.prepare(
    `INSERT INTO notifications (id, plan_id, plan_version, event, provider, status, attempts, title, body, url, created_at, updated_at, sent_at)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000001', ?, 1, 'created', 'bark', 'sent', 1, '旧通知', 'body', 'https://public.test/x', ?, ?, ?)`,
  ).run(LEGACY_PLAN_ID, TS, TS, TS);
  db.close();
}

const rawRestaurants = (e: TestEnv) =>
  e.ctx.db.prepare('SELECT id, cuisine, tags, note, updated_at FROM restaurants ORDER BY id').all() as {
    id: string;
    cuisine: string;
    tags: string;
    note: string;
    updated_at: string;
  }[];

describe('migration 3: cuisine merged into tags', () => {
  it('merges each cuisine into tags once, keeping every restaurant, tag and note', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV2 });
    const versions = env.ctx.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }]);

    const admin = await env.admin();
    const list = (await admin.get('/bistro/api/admin/restaurants')).body.data as Record<string, unknown>[];
    expect(list).toHaveLength(6);
    const byId = new Map(list.map((r) => [r.id, r]));

    expect(byId.get(ID.plain)).toMatchObject({
      tags: ['川菜', '约会'],
      note: '周末要排队',
      review: '',
      links: [],
      budgetText: '人均 50',
      mapUrl: LEGACY_SNAPSHOT.mapUrl,
    });
    expect(byId.get(ID.dup)!.tags).toEqual(['火锅', '聚餐']);
    // Nothing is dropped to make room: the tag limit is not enforced on migrated data.
    expect(byId.get(ID.full)!.tags).toEqual(['日料', ...TWELVE_TAGS]);
    expect(byId.get(ID.multi)!.tags).toEqual(['粤菜', '茶餐厅']);
    expect(byId.get(ID.noCuisine)!.tags).toEqual(['小吃']);
    for (const r of list) {
      expect(r).not.toHaveProperty('cuisine');
      expect(r.review).toBe(''); // cuisine never becomes a review
    }

    const raw = new Map(rawRestaurants(env).map((r) => [r.id, r]));
    expect(raw.get(ID.corrupt)!.tags).toBe('{oops'); // unreadable tags are left untouched
    expect(raw.get(ID.plain)!.cuisine).toBe('川菜'); // legacy column kept, just no longer read
    for (const r of raw.values()) expect(r.updated_at).toBe(TS);
  });

  it('is idempotent when the data step or the migrator runs again', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV2 });
    const before = rawRestaurants(env);
    env.ctx.db.transaction(() => migrateRestaurantClassification(env.ctx.db))();
    env.ctx.db.transaction(() => migrateRestaurantClassification(env.ctx.db))();
    expect(runMigrations(env.ctx.db)).toEqual([]);
    expect(rawRestaurants(env)).toEqual(before);
  });

  it('keeps legacy plan snapshots readable without rewriting or re-notifying them', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV2 });
    const guest = await env.guest();
    const plan = (await guest.get(`/bistro/api/plans/${LEGACY_PLAN_ID}`)).body.data;
    const expected = {
      id: ID.plain,
      name: '面馆',
      imageAssetId: null,
      review: '',
      tags: ['川菜'],
      budgetText: '人均 50',
      address: '某路 1 号',
      mapUrl: LEGACY_SNAPSHOT.mapUrl,
      links: [],
      // Read-only normalization of a pre-migration-7 snapshot: unknown place, a meal venue.
      location: { country: '', countryCode: '', region: '', city: '', source: '' },
      purposes: ['meal'],
      // Pre-migration-8 snapshot: no types (未分类), never filled in from the catalog.
      treatTypes: [],
    };
    expect(plan.selectedRestaurant).toEqual(expected);
    expect(plan.candidates).toEqual([expected]);
    expect(plan).toMatchObject({ version: 1, notification: { status: 'sent', planVersion: 1 } });

    const row = env.ctx.db.prepare('SELECT selected_json, version FROM plans WHERE id = ?').get(LEGACY_PLAN_ID) as {
      selected_json: string;
      version: number;
    };
    expect(JSON.parse(row.selected_json)).toEqual(LEGACY_SNAPSHOT);
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(0);
    const count = env.ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('lets a legacy plan be edited, freezing the current restaurant fields', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV2 });
    const guest = await env.guest();
    const res = await guest.put(
      `/bistro/api/plans/${LEGACY_PLAN_ID}`,
      { ...restaurantPlan([ID.plain], ID.plain), expectedVersion: 1 },
      idem(),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
    expect(res.body.data.selectedRestaurant).toMatchObject({ tags: ['川菜', '约会'], review: '', links: [] });
  });
});

const restaurantPlan = (candidateIds: string[], selectedRestaurantId: string) => ({
  date: '2030-01-20',
  mealLabel: '晚餐',
  localTime: null,
  timeZone: 'Asia/Shanghai',
  mode: 'restaurant',
  note: '',
  dishIds: [],
  candidateIds,
  selectedRestaurantId,
});

async function create(admin: Client, body: Record<string, unknown>) {
  return admin.post('/bistro/api/admin/restaurants', body);
}

describe('restaurant review and tags', () => {
  it('creates, reads and edits review/tags through admin and guest catalog', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const guest = await env.guest();
    const created = await create(admin, {
      name: 'A Very Long Restaurant Name Without Any Spaces Whatsoever',
      cuisine: '川菜', // legacy field from an old client: ignored
      review: '  汤底很鲜，\n  适合冬天  ',
      tags: ['火锅', '约会'],
    });
    expect(created.status).toBe(201);
    const r = created.body.data;
    expect(r).toMatchObject({ review: '汤底很鲜， 适合冬天', tags: ['火锅', '约会'] });
    expect(r).not.toHaveProperty('cuisine');

    const fromCatalog = (await guest.get('/bistro/api/catalog')).body.data.restaurants[0];
    expect(fromCatalog).toMatchObject({ review: r.review, tags: r.tags });

    const edited = await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { ...r, review: '换了主厨', tags: ['小酒馆'] });
    expect(edited.status).toBe(200);
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurants[0]).toMatchObject({ review: '换了主厨', tags: ['小酒馆'] });
  });

  it('only requires a name; everything else defaults to empty', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const res = await create(admin, { name: '只有名字' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      review: '',
      tags: [],
      budgetText: '',
      address: '',
      mapUrl: null,
      links: [],
      note: '',
      imageAssetId: null,
    });
    expect(res.body.data).not.toHaveProperty('linkUrl');
    expect((await create(admin, { name: '  ' })).status).toBe(400);
  });

  it('enforces the review limit', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    expect((await create(admin, { name: 'a', review: '好'.repeat(LIMITS.review) })).status).toBe(201);
    const longReview = await create(admin, { name: 'b', review: '好'.repeat(LIMITS.review + 1) });
    expect(longReview.status).toBe(400);
    expect(longReview.body.error.details.field).toBe('review');
  });

  it('reuses the same tag across restaurants independently', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const guest = await env.guest();
    const a = await seedRestaurant(admin, '甲', { tags: ['火锅', '聚餐'] });
    await seedRestaurant(admin, '乙', { tags: ['火锅'] });
    await admin.put(`/bistro/api/admin/restaurants/${a.id}`, { name: '甲', tags: ['约会'] });
    const restaurants = (await guest.get('/bistro/api/catalog')).body.data.restaurants as { name: string; tags: string[] }[];
    expect(Object.fromEntries(restaurants.map((r) => [r.name, r.tags]))).toEqual({ 甲: ['约会'], 乙: ['火锅'] });
  });

  it('freezes tags and review into plan snapshots', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const guest = await env.guest();
    const r = await seedRestaurant(admin, '小酒馆', { review: '<b>适合约会</b>', tags: ['西餐', '约会'] });
    const created = await guest.post('/bistro/api/plans', restaurantPlan([r.id], r.id), idem());
    expect(created.status).toBe(201);
    const frozen = { review: '<b>适合约会</b>', tags: ['西餐', '约会'] }; // stored verbatim, escaped by React
    expect(created.body.data.selectedRestaurant).toMatchObject(frozen);
    expect(created.body.data.selectedRestaurant).not.toHaveProperty('cuisine');

    await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { name: '小酒馆', review: '换了主厨', tags: ['小酒馆'] });
    const again = (await guest.get(`/bistro/api/plans/${created.body.data.id}`)).body.data;
    expect(again.selectedRestaurant).toMatchObject(frozen);
    expect(again.candidates[0]).toMatchObject(frozen);
  });
});
