import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHOPPING_LIMITS } from '../shared/constants.js';
import { ADMIN_ORIGIN, createTestEnv, homePlan, idem, PUBLIC_ORIGIN, seedDish, seedRestaurant, type Client, type TestEnv } from './helpers.js';
import { addManual, countRows, createHomePlan, getList, ing, itemOf, rawPlanRow, seedKitchen, setStatus, shoppingPath } from './shoppingHelpers.js';

let env: TestEnv;
let admin: Client;
let guest: Client;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await env.admin();
  guest = await env.guest();
});
afterEach(() => env.cleanup());

type Expected = { planVersion: number; revision: number };
const markHave = (client: Client, planId: string, list: Expected, keys: unknown, opts = idem()) =>
  client.put(shoppingPath(planId, '/have'), { keys, expectedPlanVersion: list.planVersion, expectedRevision: list.revision }, opts);

describe('PUT /plans/:id/shopping/have', () => {
  it('marks every selected pending item 家里已有 in one revision without touching the meal or notifying', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    await env.ctx.worker.drain();
    const sent = env.provider.sent.length;
    const notifications = countRows(env, 'notifications');
    const planBefore = rawPlanRow(env, plan.id);
    env.advance(60_000);

    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '小葱', 'bought')).body.data;
    const res = await markHave(guest, plan.id, list, ['番茄', '鸡蛋']);
    expect(res.status).toBe(200);
    const after = res.body.data;
    expect(after.revision).toBe(list.revision + 1);
    expect(itemOf(after, '番茄')).toMatchObject({ status: 'have', needsReview: false });
    expect(itemOf(after, '鸡蛋')).toMatchObject({ status: 'have', needsReview: false });
    // Existing statuses are untouched.
    expect(itemOf(after, '小葱')!.status).toBe('bought');
    // Sources keep every original quantity and note.
    expect(itemOf(after, '鸡蛋')!.sources).toEqual(itemOf(list, '鸡蛋')!.sources);
    expect(after.counts).toEqual({ pending: 0, have: 2, bought: 1 });

    expect(rawPlanRow(env, plan.id)).toEqual(planBefore);
    await env.ctx.worker.drain();
    expect(countRows(env, 'notifications')).toBe(notifications);
    expect(env.provider.sent.length).toBe(sent);
  });

  it('refuses the whole batch when any key is unknown, already prepared, duplicated or malformed', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '小葱', 'bought')).body.data;

    const unknown = await markHave(guest, plan.id, list, ['番茄', '牛肉']);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: 'shopping_item_missing', details: { missingKeys: ['牛肉'] } });
    expect(unknown.body.error.details.current.revision).toBe(list.revision);

    const prepared = await markHave(guest, plan.id, list, ['番茄', '小葱']);
    expect(prepared.status).toBe(409);
    expect(prepared.body.error).toMatchObject({ code: 'shopping_item_not_pending', details: { changedKeys: ['小葱'] } });

    for (const keys of [[], ['番茄', '番茄'], [''], 'x', [5], ['x'.repeat(SHOPPING_LIMITS.groupKey + 1)]]) {
      expect((await markHave(guest, plan.id, list, keys)).status, JSON.stringify(keys)).toBe(400);
    }
    const tooMany = Array.from({ length: SHOPPING_LIMITS.batchKeys + 1 }, (_, i) => `k${i}`);
    expect((await markHave(guest, plan.id, list, tooMany)).status).toBe(400);

    const now = await getList(guest, plan.id);
    expect(now.revision).toBe(list.revision);
    expect(itemOf(now, '番茄')!.status).toBe('pending');
    expect(itemOf(now, '小葱')!.status).toBe('bought');
  });

  it('keeps synonyms and variants as separate items: only the named keys change', async () => {
    const a = await seedDish(admin, '番茄炒蛋', { ingredients: [ing('番茄', '2颗')] });
    const b = await seedDish(admin, '西红柿豆腐汤', { ingredients: [ing('西红柿', '1颗'), ing('嫩豆腐', '一盒'), ing('豆腐', '半块')] });
    const plan = await createHomePlan(guest, [a.id, b.id]);
    const list = await getList(guest, plan.id);
    expect(list.items.map((i: { key: string }) => i.key)).toEqual(['番茄', '西红柿', '嫩豆腐', '豆腐']);
    const after = (await markHave(guest, plan.id, list, ['西红柿', '豆腐'])).body.data;
    expect(after.items.map((i: { key: string; status: string }) => [i.key, i.status])).toEqual([
      ['番茄', 'pending'],
      ['西红柿', 'have'],
      ['嫩豆腐', 'pending'],
      ['豆腐', 'have'],
    ]);
  });

  it('clears a needs-review flag when confirmed and keeps manual sources', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.eggSoup.id]);
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '小葱', 'have')).body.data;
    list = (await addManual(guest, plan.id, list, { name: '小葱', quantity: '再一把' })).body.data;
    expect(itemOf(list, '小葱')).toMatchObject({ status: 'pending', needsReview: true });
    const after = (await markHave(guest, plan.id, list, ['小葱'])).body.data;
    expect(itemOf(after, '小葱')).toMatchObject({ status: 'have', needsReview: false });
    expect(itemOf(after, '小葱')!.sources).toHaveLength(2);
  });

  it('replays an identical retry with the same key and rejects the key reused for other content', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const list = await getList(guest, plan.id);
    const key = idem();
    const first = await markHave(guest, plan.id, list, ['番茄'], key);
    // The answer was lost; the same request goes out again with the old base.
    const retry = await markHave(guest, plan.id, list, ['番茄'], key);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);
    expect((await getList(guest, plan.id)).revision).toBe(1);

    const mismatch = await markHave(guest, plan.id, list, ['鸡蛋'], key);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('idempotency_mismatch');
    // Without the key the same stale request is a conflict, not a second write.
    const stale = await markHave(guest, plan.id, list, ['番茄']);
    expect(stale.status).toBe(409);
    expect((await getList(guest, plan.id)).revision).toBe(1);
  });

  it('rejects a stale shopping revision or meal version with the current list', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const opened = await getList(guest, plan.id);
    const laptop = await env.guest();
    await setStatus(laptop, plan.id, opened, '鸡蛋', 'bought');

    const stale = await markHave(guest, plan.id, opened, ['番茄', '鸡蛋']);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('shopping_conflict');
    const current = stale.body.error.details.current;
    expect(itemOf(current, '鸡蛋')!.status).toBe('bought');
    // An explicit second confirmation against the new base, without the changed item, goes through.
    const ok = await markHave(guest, plan.id, current, ['番茄']);
    expect(ok.status).toBe(200);
    expect(itemOf(ok.body.data, '鸡蛋')!.status).toBe('bought');

    const before = ok.body.data;
    await guest.put(`/bistro/api/plans/${plan.id}`, { ...homePlan([k.tomatoEgg.id, k.eggSoup.id]), expectedVersion: 1 }, idem());
    const changed = await markHave(guest, plan.id, before, ['小葱']);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('plan_changed');
    expect(changed.body.error.details.current.planVersion).toBe(2);
  });

  it('is locked for cancelled, past and restaurant meals', async () => {
    const k = await seedKitchen(admin);
    const cancelled = await createHomePlan(guest, [k.tomatoEgg.id]);
    const list = await getList(guest, cancelled.id);
    await guest.post(`/bistro/api/plans/${cancelled.id}/cancel`, { expectedVersion: 1 }, idem());
    const res = await markHave(guest, cancelled.id, { ...list, planVersion: 2 }, ['番茄']);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'shopping_locked', details: { reason: 'cancelled' } });

    const past = await createHomePlan(guest, [k.tomatoEgg.id], { date: '2030-01-16' });
    env.setNow('2030-01-16T16:01:00Z');
    const pastRes = await markHave(guest, past.id, { planVersion: 1, revision: 0 }, ['番茄']);
    expect(pastRes.body.error.details.reason).toBe('past');

    env.setNow('2030-01-15T12:00:00Z');
    const r = await seedRestaurant(admin, '面馆');
    const restaurantPlan = (
      await guest.post('/bistro/api/plans', { ...homePlan([]), mode: 'restaurant', candidateIds: [r.id], selectedRestaurantId: r.id }, idem())
    ).body.data;
    const restaurantRes = await markHave(guest, restaurantPlan.id, { planVersion: 1, revision: 0 }, ['番茄']);
    expect(restaurantRes.body.error.details.reason).toBe('restaurant');
    expect(countRows(env, 'plan_shopping')).toBe(0);
  });

  it('needs the gate publicly, checks Origin and the Idempotency-Key', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const list = await getList(guest, plan.id);
    expect((await markHave(env.publicClient(), plan.id, list, ['番茄'])).status).toBe(401);
    const body = { keys: ['番茄'], expectedPlanVersion: 1, expectedRevision: 0 };
    for (const origin of [null, 'https://evil.test', ADMIN_ORIGIN]) {
      expect((await guest.request('PUT', shoppingPath(plan.id, '/have'), { json: body, origin, ...idem() })).status).toBe(403);
    }
    expect((await admin.request('PUT', shoppingPath(plan.id, '/have'), { json: body, origin: PUBLIC_ORIGIN, ...idem() })).status).toBe(403);
    expect((await guest.put(shoppingPath(plan.id, '/have'), body)).status).toBe(400);
    expect((await guest.put(shoppingPath('not-a-uuid', '/have'), body, idem())).status).toBe(404);
    expect((await guest.put(shoppingPath('00000000-0000-4000-8000-000000000000', '/have'), body, idem())).status).toBe(404);
    expect((await getList(guest, plan.id)).revision).toBe(0);
    // The private listener works without a guest session.
    expect((await markHave(admin, plan.id, list, ['番茄'])).status).toBe(200);
  });
});
