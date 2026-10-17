import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDishDetails, runMigrations } from '../server/db/migrations.js';
import { createTestEnv, idem, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

const TS = '2030-01-01T00:00:00Z';
const ASSET = 'a'.repeat(32);
const ID = {
  home: '00000000-0000-4000-8000-000000000021',
  spaced: '00000000-0000-4000-8000-000000000022',
  none: '00000000-0000-4000-8000-000000000023',
  blank: '00000000-0000-4000-8000-000000000024',
  photo: '00000000-0000-4000-8000-000000000025',
};
const PLAN = {
  legacy: '44444444-4444-4444-8444-444444444441',
  explicitEmpty: '44444444-4444-4444-8444-444444444442',
};

/** A schema-v1..v4 dish snapshot: only id/name/category/imageAssetId. */
const v4Snapshot = (id: string, name: string, category: string, imageAssetId: string | null = null) => ({
  id,
  name,
  category,
  imageAssetId,
});

/** A database as written by the previous release (schema v4, one free-text category per dish). */
function seedV4(dataDir: string) {
  const db = new Database(path.join(dataDir, 'bistro.sqlite'));
  runMigrations(db, 4);
  db.prepare(`INSERT INTO media (id, width, height, source_type, bytes, created_at) VALUES (?, 10, 10, 'png', 100, ?)`).run(ASSET, TS);
  const insert = db.prepare(
    `INSERT INTO dishes (id, name, image_asset_id, category, tags, description, recipe_url, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  insert.run(ID.home, '番茄炒蛋', null, '家常', '["快手"]', '酸甜', 'https://example.com/r', TS, TS);
  insert.run(ID.spaced, '杂菜汤', null, '  汤  甜品 ', '[]', '', null, TS, TS);
  insert.run(ID.none, '白粥', null, '', '[]', '', null, TS, TS);
  insert.run(ID.blank, '空白', null, '   ', '["早餐"]', '', null, TS, TS);
  insert.run(ID.photo, '红烧肉', ASSET, '硬菜', '["下饭","聚餐"]', '肥而不腻', 'https://example.com/hsr', TS, TS);

  const plan = db.prepare(
    `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, dishes_json, created_at, updated_at)
     VALUES (?, ?, 'active', 1, '2030-01-20', '晚餐', 'Asia/Shanghai', 'home', ?, ?, ?)`,
  );
  plan.run(
    PLAN.legacy,
    'OLD401',
    JSON.stringify([v4Snapshot(ID.home, '番茄炒蛋', '家常'), v4Snapshot(ID.photo, '红烧肉', '硬菜', ASSET), v4Snapshot(ID.none, '白粥', '')]),
    TS,
    TS,
  );
  // Written by the new release (sections: []) but still carrying a stale category: must never resurrect.
  plan.run(PLAN.explicitEmpty, 'NEW402', JSON.stringify([{ ...v4Snapshot(ID.home, '番茄炒蛋', '家常'), sections: [] }]), TS, TS);
  db.close();
}

const rawDishes = (e: TestEnv) =>
  e.ctx.db
    .prepare(
      `SELECT id, name, image_asset_id, category, sections_json, tags, description, recipe_url, ingredients_json,
       total_minutes, active_minutes, serving_text, shopping_note, created_at, updated_at FROM dishes ORDER BY id`,
    )
    .all() as Record<string, unknown>[];

const rawPlans = (e: TestEnv) =>
  e.ctx.db.prepare('SELECT id, version, dishes_json, updated_at FROM plans ORDER BY id').all() as {
    id: string;
    version: number;
    dishes_json: string;
    updated_at: string;
  }[];

describe('migration 5: dish details', () => {
  it('adds empty detail columns and copies each non-blank category as exactly one section', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV4 });
    const versions = env.ctx.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);

    const raw = new Map(rawDishes(env).map((r) => [r.id, r]));
    expect(raw.get(ID.home)).toEqual({
      id: ID.home,
      name: '番茄炒蛋',
      image_asset_id: null,
      category: '家常', // legacy column kept as is
      sections_json: '["家常"]',
      tags: '["快手"]',
      description: '酸甜',
      recipe_url: 'https://example.com/r',
      ingredients_json: '[]',
      total_minutes: null,
      active_minutes: null,
      serving_text: '',
      shopping_note: '',
      created_at: TS,
      updated_at: TS,
    });
    // Trimmed but never split or remapped.
    expect(raw.get(ID.spaced)).toMatchObject({ category: '  汤  甜品 ', sections_json: '["汤 甜品"]' });
    expect(raw.get(ID.none)).toMatchObject({ sections_json: '[]' });
    expect(raw.get(ID.blank)).toMatchObject({ category: '   ', sections_json: '[]', tags: '["早餐"]' });
    expect(raw.get(ID.photo)).toMatchObject({
      image_asset_id: ASSET,
      sections_json: '["硬菜"]',
      tags: '["下饭","聚餐"]',
      description: '肥而不腻',
      recipe_url: 'https://example.com/hsr',
    });
    for (const r of raw.values()) expect(r.updated_at).toBe(TS);

    const admin = await env.admin();
    const list = (await admin.get('/bistro/api/admin/dishes')).body.data as Record<string, unknown>[];
    const byId = new Map(list.map((d) => [d.id, d]));
    expect(byId.get(ID.home)).toMatchObject({ category: '家常', sections: ['家常'], tags: ['快手'], ingredients: [] });
    expect(byId.get(ID.none)).toMatchObject({ category: '', sections: [] });

    await env.ctx.worker.drain();
    expect((env.ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n).toBe(0);
  });

  it('is idempotent when the data step or the migrator runs again', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV4 });
    const before = rawDishes(env);
    const plansBefore = rawPlans(env);
    env.ctx.db.transaction(() => migrateDishDetails(env.ctx.db))();
    env.ctx.db.transaction(() => migrateDishDetails(env.ctx.db))();
    expect(runMigrations(env.ctx.db)).toEqual([]);
    expect(rawDishes(env)).toEqual(before);
    expect(rawPlans(env)).toEqual(plansBefore);
  });

  it('never resurrects a cleared section from the legacy category, and keeps edits on a re-run', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV4 });
    const admin = await env.admin();
    const cleared = await admin.put(`/bistro/api/admin/dishes/${ID.home}`, { name: '番茄炒蛋', sections: [] });
    expect(cleared.body.data.sections).toEqual([]);
    const edited = await admin.put(`/bistro/api/admin/dishes/${ID.photo}`, { name: '红烧肉', sections: ['配饭菜', '硬菜'] });
    expect(edited.body.data.sections).toEqual(['配饭菜', '硬菜']);

    env.ctx.db.transaction(() => migrateDishDetails(env.ctx.db))();
    const raw = new Map(rawDishes(env).map((r) => [r.id, r]));
    expect(raw.get(ID.home)).toMatchObject({ category: '', sections_json: '[]' });
    expect(raw.get(ID.photo)).toMatchObject({ category: '配饭菜', sections_json: '["配饭菜","硬菜"]' });
  });

  it('reads old plan snapshots with empty defaults and the old category, without rewriting them', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV4 });
    const plansBefore = rawPlans(env);
    // Edit the catalog first: old snapshots must not pick up current catalog values.
    const admin = await env.admin();
    await admin.put(`/bistro/api/admin/dishes/${ID.home}`, {
      name: '新名字',
      sections: ['汤羹'],
      ingredients: [{ name: '鸡蛋', quantity: '3个', purchaseNote: '' }],
      totalMinutes: 10,
    });

    const guest = await env.guest();
    const legacy = (await guest.get(`/bistro/api/plans/${PLAN.legacy}`)).body.data;
    const empty = { tags: [], description: '', recipeUrl: null, ingredients: [], totalMinutes: null, activeMinutes: null, servingText: '', shoppingNote: '' };
    expect(legacy.dishes).toEqual([
      { id: ID.home, name: '番茄炒蛋', category: '家常', sections: ['家常'], imageAssetId: null, ...empty },
      { id: ID.photo, name: '红烧肉', category: '硬菜', sections: ['硬菜'], imageAssetId: ASSET, ...empty },
      { id: ID.none, name: '白粥', category: '', sections: [], imageAssetId: null, ...empty },
    ]);
    const explicit = (await guest.get(`/bistro/api/plans/${PLAN.explicitEmpty}`)).body.data;
    expect(explicit.dishes[0]).toMatchObject({ sections: [], category: '' });
    expect((await guest.get('/bistro/api/plans')).body.data.find((p: { id: string }) => p.id === PLAN.legacy).dishes).toEqual(
      legacy.dishes,
    );

    expect(rawPlans(env)).toEqual(plansBefore);
  });

  it('keeps old plans editable and cancellable; an edit snapshots the current details', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV4 });
    const guest = await env.guest();
    const body = {
      date: '2030-01-20',
      mealLabel: '晚餐',
      localTime: null,
      timeZone: 'Asia/Shanghai',
      mode: 'home',
      note: '',
      dishIds: [ID.home, ID.photo],
      candidateIds: [],
      selectedRestaurantId: null,
      expectedVersion: 1,
    };
    const updated = await guest.put(`/bistro/api/plans/${PLAN.legacy}`, body, idem());
    expect(updated.status).toBe(200);
    expect(updated.body.data.dishes.map((d: { sections: string[] }) => d.sections)).toEqual([['家常'], ['硬菜']]);
    const stored = JSON.parse(rawPlans(env).find((p) => p.id === PLAN.legacy)!.dishes_json);
    expect(stored[0]).toMatchObject({ sections: ['家常'], ingredients: [], totalMinutes: null });

    const cancelled = await guest.post(`/bistro/api/plans/${PLAN.legacy}/cancel`, { expectedVersion: 2 }, idem());
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
  });
});
