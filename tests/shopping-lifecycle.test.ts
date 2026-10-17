import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../server/db/migrations.js';
import { createTestEnv, homePlan, idem, seedDish, seedRestaurant, type Client, type TestEnv } from './helpers.js';
import { addManual, countRows, createHomePlan, getList, ing, itemOf, seedKitchen, setStatus } from './shoppingHelpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

async function start() {
  env = await createTestEnv();
  return { admin: await env.admin(), guest: await env.guest() };
}

const editPlan = (guest: Client, planId: string, dishIds: string[], expectedVersion: number, extra: Record<string, unknown> = {}) =>
  guest.put(`/bistro/api/plans/${planId}`, { ...homePlan(dishIds, extra), expectedVersion }, idem());

describe('meal edits reconcile the saved checklist', () => {
  it('keeps unchanged groups, resets changed ones, drops removed ones and adds new ones as pending', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const noodles = await seedDish(admin, '葱油面', { ingredients: [ing('面条', '两人份'), ing('小葱', '一把')] });
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '番茄', 'have')).body.data;
    list = (await setStatus(guest, plan.id, list, '鸡蛋', 'bought')).body.data;
    list = (await setStatus(guest, plan.id, list, '小葱', 'bought')).body.data;
    list = (await addManual(guest, plan.id, list, { name: '可乐' })).body.data;
    list = (await setStatus(guest, plan.id, list, '可乐', 'have')).body.data;

    // The soup's 鸡蛋 quantity changes in the catalog; the edit re-snapshots dishes and reorders them.
    await admin.put(`/bistro/api/admin/dishes/${k.eggSoup.id}`, { name: '鸡蛋汤', ingredients: [ing('鸡蛋', '3颗', '土鸡蛋'), ing('小葱', '一把')] });
    const edited = await editPlan(guest, plan.id, [noodles.id, k.eggSoup.id, k.tomatoEgg.id], 1);
    expect(edited.status).toBe(200);
    const after = await getList(guest, plan.id);
    expect(after.planVersion).toBe(2);
    expect(after.revision).toBe(list.revision + 1);
    expect(itemOf(after, '番茄')).toMatchObject({ status: 'have', needsReview: false });
    expect(itemOf(after, '鸡蛋')).toMatchObject({ status: 'pending', needsReview: true });
    // 小葱 gained a source (葱油面): its requirement changed too.
    expect(itemOf(after, '小葱')).toMatchObject({ status: 'pending', needsReview: true });
    expect(itemOf(after, '面条')).toMatchObject({ status: 'pending', needsReview: false });
    // Manual items survive a meal edit with their state.
    expect(itemOf(after, '可乐')).toMatchObject({ status: 'have' });
    expect(after.manual).toHaveLength(1);
  });

  it('does not reset anything when only the dish or ingredient order changes', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '鸡蛋', 'bought')).body.data;
    list = (await setStatus(guest, plan.id, list, '番茄', 'have')).body.data;
    await admin.put(`/bistro/api/admin/dishes/${k.tomatoEgg.id}`, {
      name: '西红柿炒鸡蛋',
      ingredients: [ing('鸡蛋', '2颗'), ing('番茄', '2颗', '要熟一点')],
      shoppingNote: '番茄挑软一点',
    });
    await editPlan(guest, plan.id, [k.eggSoup.id, k.tomatoEgg.id], 1, { note: '换个顺序' });
    const after = await getList(guest, plan.id);
    expect(itemOf(after, '鸡蛋')).toMatchObject({ status: 'bought', needsReview: false });
    expect(itemOf(after, '番茄')).toMatchObject({ status: 'have', needsReview: false });
    expect(after.items.map((i: { key: string }) => i.key)).toEqual(['鸡蛋', '小葱', '番茄']);
  });

  it('never resurrects a status when a group is removed and added back', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '小葱', 'bought')).body.data;
    await editPlan(guest, plan.id, [k.tomatoEgg.id], 1);
    expect(itemOf(await getList(guest, plan.id), '小葱')).toBeUndefined();
    await editPlan(guest, plan.id, [k.tomatoEgg.id, k.eggSoup.id], 2);
    expect(itemOf(await getList(guest, plan.id), '小葱')).toMatchObject({ status: 'pending', needsReview: false });
  });

  it('writes nothing for meals whose checklist was never touched', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    await editPlan(guest, plan.id, [k.tomatoEgg.id, k.eggSoup.id], 1);
    expect(countRows(env, 'plan_shopping')).toBe(0);
    expect((await getList(guest, plan.id)).revision).toBe(0);
  });

  it('clears manual items and statuses for good when the meal switches to a restaurant', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const r = await seedRestaurant(admin, '面馆');
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '番茄', 'bought')).body.data;
    list = (await addManual(guest, plan.id, list, { name: '可乐' })).body.data;

    await editPlan(guest, plan.id, [], 1, { mode: 'restaurant', candidateIds: [r.id], selectedRestaurantId: r.id });
    const asRestaurant = await getList(guest, plan.id);
    expect(asRestaurant).toMatchObject({ lockReason: 'restaurant', items: [], manual: [] });
    expect(JSON.parse((env.ctx.db.prepare('SELECT manual_json FROM plan_shopping').get() as { manual_json: string }).manual_json)).toEqual([]);

    await editPlan(guest, plan.id, [k.tomatoEgg.id], 2);
    const back = await getList(guest, plan.id);
    expect(back.manual).toEqual([]);
    expect(back.items.every((i: { status: string; needsReview: boolean }) => i.status === 'pending' && !i.needsReview)).toBe(true);
    expect(back.revision).toBeGreaterThan(list.revision);
  });

  it('starts a repeated meal (再来一顿) with an all-pending list and no manual items', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '番茄', 'have')).body.data;
    await addManual(guest, plan.id, list, { name: '可乐' });

    const again = await createHomePlan(guest, [k.tomatoEgg.id], { sourcePlanId: plan.id, date: '2030-01-21' });
    const fresh = await getList(guest, again.id);
    expect(fresh).toMatchObject({ revision: 0, manual: [] });
    expect(fresh.counts).toEqual({ pending: 2, have: 0, bought: 0 });
    expect(itemOf(await getList(guest, plan.id), '番茄')!.status).toBe('have');
  });

  it('keeps the meal create/update/cancel notifications exactly as before', async () => {
    const { admin, guest } = await start();
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '番茄', 'have')).body.data;
    const update = await editPlan(guest, plan.id, [k.tomatoEgg.id, k.eggSoup.id], 1);
    expect(update.body.data.notification).toMatchObject({ event: 'updated', planVersion: 2 });
    await guest.post(`/bistro/api/plans/${plan.id}/cancel`, { expectedVersion: 2 }, idem());
    const events = env.ctx.db.prepare('SELECT event, plan_version FROM notifications ORDER BY created_at').all();
    expect(events).toEqual([
      { event: 'created', plan_version: 1 },
      { event: 'updated', plan_version: 2 },
      { event: 'cancelled', plan_version: 3 },
    ]);
  });
});

describe('migration 6: shopping side table', () => {
  const TS = '2030-01-01T00:00:00Z';
  const PLAN = { legacy: '55555555-5555-4555-8555-555555555551', withDetails: '55555555-5555-4555-8555-555555555552' };

  /** A database as written by the previous release (schema v5), including a pre-v5 raw snapshot. */
  function seedV5(dataDir: string) {
    const db = new Database(path.join(dataDir, 'bistro.sqlite'));
    runMigrations(db, 5);
    const insert = db.prepare(
      `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, dishes_json, created_at, updated_at)
       VALUES (?, ?, 'active', 3, '2030-01-20', '晚餐', 'Asia/Shanghai', 'home', ?, ?, ?)`,
    );
    insert.run(PLAN.legacy, 'OLD601', JSON.stringify([{ id: 'd-old', name: '老菜', category: '家常', imageAssetId: null }]), TS, TS);
    insert.run(
      PLAN.withDetails,
      'OLD602',
      JSON.stringify([
        { id: 'd-new', name: '番茄炒蛋', sections: [], ingredients: [{ name: '番茄', quantity: '2颗', purchaseNote: '' }], shoppingNote: '挑软的' },
        { id: 'd-note', name: '凉拌菜', sections: [], ingredients: [], shoppingNote: '看市场' },
      ]),
      TS,
      TS,
    );
    db.close();
  }

  const rawPlans = () => env.ctx.db.prepare('SELECT * FROM plans ORDER BY id').all();

  it('only adds the side table, is repeatable and never rewrites old plans', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV5 });
    const versions = env.ctx.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions.at(-1)).toEqual({ version: 7 });
    const before = rawPlans();
    expect(runMigrations(env.ctx.db)).toEqual([]);
    env.ctx.db.exec("DELETE FROM schema_migrations WHERE version = 6");
    expect(runMigrations(env.ctx.db)).toEqual([6]);
    expect(countRows(env, 'plan_shopping')).toBe(0);

    const guest = await env.guest();
    const legacy = await getList(guest, PLAN.legacy);
    expect(legacy).toMatchObject({ planVersion: 3, revision: 0, items: [], dishesWithoutIngredients: ['老菜'], writable: true });
    const detailed = await getList(guest, PLAN.withDetails);
    expect(detailed.items.map((i: { name: string }) => i.name)).toEqual(['番茄']);
    expect(detailed.dishesWithoutIngredients).toEqual(['凉拌菜']);
    expect(detailed.dishNotes).toEqual([
      { dishId: 'd-new', dishName: '番茄炒蛋', note: '挑软的' },
      { dishId: 'd-note', dishName: '凉拌菜', note: '看市场' },
    ]);

    // Checking an old meal's list creates only a side row; the plan row stays byte-for-byte.
    expect((await setStatus(guest, PLAN.withDetails, detailed, '番茄', 'bought')).status).toBe(200);
    expect(rawPlans()).toEqual(before);
    expect(countRows(env, 'plan_shopping')).toBe(1);
  });
});
