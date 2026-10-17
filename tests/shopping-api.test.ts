import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHOPPING_LIMITS } from '../shared/constants.js';
import { ADMIN_ORIGIN, createTestEnv, homePlan, idem, PUBLIC_ORIGIN, seedRestaurant, type Client, type TestEnv } from './helpers.js';
import {
  addManual,
  countRows,
  createHomePlan,
  deleteManual,
  getList,
  ing,
  itemOf,
  rawPlanRow,
  seedKitchen,
  setStatus,
  shoppingPath,
  updateManual,
} from './shoppingHelpers.js';

let env: TestEnv;
let admin: Client;
let guest: Client;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await env.admin();
  guest = await env.guest();
});
afterEach(() => env.cleanup());

describe('reading a saved meal checklist', () => {
  it('derives groups from the frozen snapshot only, without writing anything', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id, k.congee.id]);
    // Later catalog edits never reach the saved list.
    await admin.put(`/bistro/api/admin/dishes/${k.tomatoEgg.id}`, { name: '新番茄炒蛋', ingredients: [ing('牛肉', '1斤')] });

    const changesBefore = (env.ctx.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const list = await getList(guest, plan.id);
    const changesAfter = (env.ctx.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    expect(changesAfter).toBe(changesBefore);
    expect(countRows(env, 'plan_shopping')).toBe(0);

    expect(list).toMatchObject({ planId: plan.id, planVersion: 1, revision: 0, writable: true, lockReason: null, manual: [] });
    expect(list.items.map((i: { name: string }) => i.name)).toEqual(['番茄', '鸡蛋', '小葱']);
    expect(itemOf(list, '鸡蛋')!.sources).toEqual([
      { kind: 'dish', dishId: k.tomatoEgg.id, dishName: '番茄炒蛋', name: '鸡蛋', quantity: '2颗', purchaseNote: '' },
      { kind: 'dish', dishId: k.eggSoup.id, dishName: '鸡蛋汤', name: '鸡蛋', quantity: '2颗', purchaseNote: '土鸡蛋' },
    ]);
    expect(list.dishNotes).toEqual([{ dishId: k.tomatoEgg.id, dishName: '番茄炒蛋', note: '番茄挑软一点' }]);
    expect(list.dishesWithoutIngredients).toEqual(['白粥']);
    expect(list.counts).toEqual({ pending: 3, have: 0, bought: 0 });
    // The plan list response is not bloated with the checklist.
    expect((await guest.get('/bistro/api/plans')).body.data[0]).not.toHaveProperty('shopping');
  });

  it('404s unknown plans and malformed ids', async () => {
    expect((await guest.get(shoppingPath('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await guest.get(shoppingPath('nope'))).status).toBe(404);
  });
});

describe('statuses', () => {
  it('sets each status explicitly and reversibly without touching the meal or notifications', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    await env.ctx.worker.drain();
    const sentBefore = env.provider.sent.length;
    const notificationsBefore = countRows(env, 'notifications');
    const planBefore = rawPlanRow(env, plan.id);
    env.advance(60_000);

    let list = await getList(guest, plan.id);
    for (const status of ['have', 'bought', 'pending', 'bought'] as const) {
      const res = await setStatus(guest, plan.id, list, '鸡蛋', status);
      expect(res.status, status).toBe(200);
      list = res.body.data;
      expect(itemOf(list, '鸡蛋')).toMatchObject({ status, needsReview: false });
    }
    expect(list.revision).toBe(4);
    expect(list.counts).toEqual({ pending: 2, have: 0, bought: 1 });
    // Shared with another device/session.
    const other = await env.guest();
    expect(itemOf(await getList(other, plan.id), '鸡蛋')!.status).toBe('bought');

    expect(rawPlanRow(env, plan.id)).toEqual(planBefore);
    expect((await guest.get(`/bistro/api/plans/${plan.id}`)).body.data).toMatchObject({ version: 1, updatedAt: plan.updatedAt });
    await env.ctx.worker.drain();
    expect(countRows(env, 'notifications')).toBe(notificationsBefore);
    expect(env.provider.sent.length).toBe(sentBefore);
  });

  it('validates the status, the group key and the request shape', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const list = await getList(guest, plan.id);
    expect((await setStatus(guest, plan.id, list, '鸡蛋', 'toggle')).status).toBe(400);
    expect((await setStatus(guest, plan.id, list, '鸡蛋', '')).status).toBe(400);
    const unknown = await setStatus(guest, plan.id, list, '牛肉', 'have');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('shopping_item_missing');
    expect((await setStatus(guest, plan.id, list, 'x'.repeat(SHOPPING_LIMITS.groupKey + 1), 'have')).status).toBe(400);
    const noKey = await guest.put(shoppingPath(plan.id, '/status'), { key: '鸡蛋', status: 'have', expectedPlanVersion: 1, expectedRevision: 0 });
    expect(noKey.status).toBe(400);
    const badRevision = await guest.put(
      shoppingPath(plan.id, '/status'),
      { key: '鸡蛋', status: 'have', expectedPlanVersion: 1, expectedRevision: -1 },
      idem(),
    );
    expect(badRevision.status).toBe(400);
    expect(countRows(env, 'plan_shopping')).toBe(0);
  });
});

describe('manual additions', () => {
  it('adds name-only items, groups them with recipe items and edits/deletes only the manual source', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.eggSoup.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '小葱', 'have')).body.data;

    const added = await addManual(guest, plan.id, list, { name: '  小葱 ' });
    expect(added.status).toBe(201);
    list = added.body.data;
    const manualId = list.manual[0].id;
    expect(list.manual[0]).toMatchObject({ name: '小葱', quantity: '', note: '' });
    expect(itemOf(list, '小葱')!.sources).toEqual([
      { kind: 'dish', dishId: k.eggSoup.id, dishName: '鸡蛋汤', name: '小葱', quantity: '一把', purchaseNote: '' },
      { kind: 'manual', manualId, name: '小葱', quantity: '', note: '' },
    ]);
    // The group's requirement changed: it is back to pending and flagged for review.
    expect(itemOf(list, '小葱')).toMatchObject({ status: 'pending', needsReview: true });

    list = (await setStatus(guest, plan.id, list, '小葱', 'bought')).body.data;
    const edited = await updateManual(guest, plan.id, list, manualId, { name: '小葱', quantity: '再来一把', note: '炒菜用' });
    expect(edited.status).toBe(200);
    list = edited.body.data;
    expect(itemOf(list, '小葱')).toMatchObject({ status: 'pending', needsReview: true });
    expect(itemOf(list, '小葱')!.sources[1]).toMatchObject({ kind: 'manual', quantity: '再来一把', note: '炒菜用' });

    // Recipe sources cannot be edited or deleted through the manual API.
    expect((await updateManual(guest, plan.id, list, k.eggSoup.id, { name: 'x' })).body.error.code).toBe('manual_missing');
    expect((await deleteManual(guest, plan.id, list, k.eggSoup.id)).status).toBe(404);

    list = (await setStatus(guest, plan.id, list, '小葱', 'have')).body.data;
    const deleted = await deleteManual(guest, plan.id, list, manualId);
    expect(deleted.status).toBe(200);
    list = deleted.body.data;
    expect(list.manual).toEqual([]);
    expect(itemOf(list, '小葱')).toMatchObject({ status: 'pending', needsReview: true });
    expect(itemOf(list, '小葱')!.sources).toHaveLength(1);
    // The recipe item itself is still there and unchanged.
    expect(list.items.map((i: { key: string }) => i.key)).toEqual(['鸡蛋', '小葱']);
  });

  it('keeps unrelated statuses and distinct identical manual rows apart', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '番茄', 'have')).body.data;
    list = (await addManual(guest, plan.id, list, { name: '可乐', quantity: '2瓶' })).body.data;
    list = (await addManual(guest, plan.id, list, { name: '可乐', quantity: '2瓶' })).body.data;
    expect(list.manual).toHaveLength(2);
    expect(list.manual[0].id).not.toBe(list.manual[1].id);
    expect(itemOf(list, '可乐')!.sources).toHaveLength(2);
    expect(itemOf(list, '番茄')!.status).toBe('have');

    // Renaming a manual-only group moves it; the old group disappears with its state.
    list = (await setStatus(guest, plan.id, list, '可乐', 'bought')).body.data;
    list = (await deleteManual(guest, plan.id, list, list.manual[0].id)).body.data;
    expect(itemOf(list, '可乐')).toMatchObject({ status: 'pending', needsReview: true });
    list = (await updateManual(guest, plan.id, list, list.manual[0].id, { name: '雪碧', quantity: '2瓶' })).body.data;
    expect(itemOf(list, '可乐')).toBeUndefined();
    expect(itemOf(list, '雪碧')).toMatchObject({ status: 'pending', needsReview: false });
    expect(itemOf(list, '番茄')!.status).toBe('have');
  });

  it('validates names and limits without truncating', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.congee.id]);
    const list = await getList(guest, plan.id);
    const cases: [Record<string, unknown>, string][] = [
      [{ name: '   ' }, 'name'],
      [{}, 'name'],
      [{ name: 'x'.repeat(SHOPPING_LIMITS.name + 1) }, 'name'],
      [{ name: '可乐', quantity: 'x'.repeat(SHOPPING_LIMITS.quantity + 1) }, 'quantity'],
      [{ name: '可乐', note: 'x'.repeat(SHOPPING_LIMITS.note + 1) }, 'note'],
      [{ name: 5 }, 'name'],
    ];
    for (const [item, field] of cases) {
      const res = await addManual(guest, plan.id, list, item);
      expect(res.status, JSON.stringify(item)).toBe(400);
      expect(res.body.error.details.field).toBe(field);
    }
    const max = await addManual(guest, plan.id, list, {
      name: 'x'.repeat(SHOPPING_LIMITS.name),
      quantity: 'q'.repeat(SHOPPING_LIMITS.quantity),
      note: 'n'.repeat(SHOPPING_LIMITS.note),
    });
    expect(max.status).toBe(201);
    expect(max.body.data.manual[0].name).toHaveLength(SHOPPING_LIMITS.name);
  });

  it('caps manual items per meal', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.congee.id]);
    let list = await getList(guest, plan.id);
    for (let i = 0; i < SHOPPING_LIMITS.manualItems; i += 1) list = (await addManual(guest, plan.id, list, { name: `物品${i}` })).body.data;
    const over = await addManual(guest, plan.id, list, { name: '再来一样' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('manual_limit');
    expect((await getList(guest, plan.id)).manual).toHaveLength(SHOPPING_LIMITS.manualItems);
  });

  it('replays a retried create with the same key instead of adding a duplicate', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.congee.id]);
    const list = await getList(guest, plan.id);
    const key = idem();
    const first = await addManual(guest, plan.id, list, { name: '可乐', quantity: '2瓶' }, key);
    // The response was "lost"; the client retries the identical request with the same key.
    const retry = await addManual(guest, plan.id, list, { name: '可乐', quantity: '2瓶' }, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.data).toEqual(first.body.data);
    expect((await getList(guest, plan.id)).manual).toHaveLength(1);

    const mismatch = await addManual(guest, plan.id, list, { name: '雪碧' }, key);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('idempotency_mismatch');
    expect((await getList(guest, plan.id)).manual).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('rejects a stale shopping revision with the current list and keeps the other write', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    const phone = guest;
    const laptop = await env.guest();
    const seenByPhone = await getList(phone, plan.id);
    const seenByLaptop = await getList(laptop, plan.id);

    expect((await setStatus(phone, plan.id, seenByPhone, '鸡蛋', 'bought')).status).toBe(200);
    const stale = await setStatus(laptop, plan.id, seenByLaptop, '鸡蛋', 'have');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('shopping_conflict');
    expect(itemOf(stale.body.error.details.current, '鸡蛋')!.status).toBe('bought');
    const staleAdd = await addManual(laptop, plan.id, seenByLaptop, { name: '可乐' });
    expect(staleAdd.status).toBe(409);

    // After refreshing, a distinct edit from the other device goes through and both survive.
    const fresh = stale.body.error.details.current;
    const ok = await setStatus(laptop, plan.id, fresh, '番茄', 'have');
    expect(ok.status).toBe(200);
    expect(itemOf(ok.body.data, '鸡蛋')!.status).toBe('bought');
    expect(itemOf(ok.body.data, '番茄')!.status).toBe('have');
    expect((await getList(phone, plan.id)).manual).toEqual([]);
  });

  it('rejects writes made against an older meal version', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const before = await getList(guest, plan.id);
    await guest.put(`/bistro/api/plans/${plan.id}`, { ...homePlan([k.tomatoEgg.id, k.eggSoup.id]), expectedVersion: 1 }, idem());
    const res = await setStatus(guest, plan.id, before, '番茄', 'have');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('plan_changed');
    expect(res.body.error.details.current.planVersion).toBe(2);
    expect(res.body.error.details.current.items.map((i: { key: string }) => i.key)).toEqual(['番茄', '鸡蛋', '小葱']);
    expect((await addManual(guest, plan.id, before, { name: '可乐' })).status).toBe(409);
  });
});

describe('read-only meals', () => {
  it('keeps a cancelled meal readable with its statuses and blocks every write', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '番茄', 'bought')).body.data;
    list = (await addManual(guest, plan.id, list, { name: '可乐' })).body.data;
    await guest.post(`/bistro/api/plans/${plan.id}/cancel`, { expectedVersion: 1 }, idem());

    const cancelled = await getList(guest, plan.id);
    expect(cancelled).toMatchObject({ writable: false, lockReason: 'cancelled', revision: list.revision });
    expect(itemOf(cancelled, '番茄')!.status).toBe('bought');
    expect(cancelled.manual).toHaveLength(1);
    for (const res of [
      await setStatus(guest, plan.id, cancelled, '番茄', 'pending'),
      await addManual(guest, plan.id, cancelled, { name: '雪碧' }),
      await updateManual(guest, plan.id, cancelled, cancelled.manual[0].id, { name: '雪碧' }),
      await deleteManual(guest, plan.id, cancelled, cancelled.manual[0].id),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('shopping_locked');
      expect(res.body.error.details.reason).toBe('cancelled');
    }
    expect(await getList(guest, plan.id)).toEqual(cancelled);
  });

  it('locks past meals by the plan zone and has no checklist for restaurant meals', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id], { date: '2030-01-16' });
    env.setNow('2030-01-16T15:59:00Z'); // still 2030-01-16 23:59 in Shanghai
    const today = await getList(guest, plan.id);
    expect(today.writable).toBe(true);
    env.setNow('2030-01-16T16:01:00Z');
    const past = await getList(guest, plan.id);
    expect(past).toMatchObject({ writable: false, lockReason: 'past' });
    expect((await setStatus(guest, plan.id, past, '番茄', 'have')).body.error.code).toBe('shopping_locked');

    env.setNow('2030-01-15T12:00:00Z');
    const r = await seedRestaurant(admin, '面馆');
    const restaurantPlan = (
      await guest.post('/bistro/api/plans', { ...homePlan([]), mode: 'restaurant', candidateIds: [r.id], selectedRestaurantId: r.id }, idem())
    ).body.data;
    const list = await getList(guest, restaurantPlan.id);
    expect(list).toMatchObject({ writable: false, lockReason: 'restaurant', items: [], manual: [], dishNotes: [], dishesWithoutIngredients: [] });
    const res = await addManual(guest, restaurantPlan.id, list, { name: '可乐' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.reason).toBe('restaurant');
    expect(countRows(env, 'plan_shopping')).toBe(0);
  });
});

describe('access isolation', () => {
  it('needs the date gate on the public listener and works on the private one without a session', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const anonymous = env.publicClient();
    expect((await anonymous.get(shoppingPath(plan.id))).status).toBe(401);
    const list = await getList(guest, plan.id);
    expect((await setStatus(anonymous, plan.id, list, '番茄', 'have')).status).toBe(401);

    const privateList = await getList(admin, plan.id);
    expect(privateList.items).toHaveLength(2);
    expect((await setStatus(admin, plan.id, privateList, '番茄', 'have')).status).toBe(200);
  });

  it('checks Origin on every write and never exposes shopping under admin paths publicly', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const list = await getList(guest, plan.id);
    const body = { key: '番茄', status: 'have', expectedPlanVersion: 1, expectedRevision: 0 };
    for (const origin of [null, 'https://evil.test', ADMIN_ORIGIN]) {
      const res = await guest.request('PUT', shoppingPath(plan.id, '/status'), { json: body, origin, ...idem() });
      expect(res.status, String(origin)).toBe(403);
    }
    const adminFromPublicOrigin = await admin.request('PUT', shoppingPath(plan.id, '/status'), { json: body, origin: PUBLIC_ORIGIN, ...idem() });
    expect(adminFromPublicOrigin.status).toBe(403);
    expect((await guest.get(`/bistro/api/admin/plans/${plan.id}/shopping`)).status).toBe(404);
    expect((await getList(guest, plan.id)).revision).toBe(list.revision);
  });

  it('rejects oversized bodies', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const list = await getList(guest, plan.id);
    const res = await addManual(guest, plan.id, list, { name: '可乐', note: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
  });
});
