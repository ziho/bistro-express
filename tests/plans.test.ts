import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, homePlan, idem, seedDish, seedRestaurant, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Client;
let guest: Client;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await env.admin();
  guest = await env.guest();
});
afterEach(() => env.cleanup());

const restaurantPlan = (candidateIds: string[], selectedRestaurantId: string | null, extra = {}) => ({
  ...homePlan([], extra),
  mode: 'restaurant',
  candidateIds,
  selectedRestaurantId,
});

describe('home plans', () => {
  it('creates a plan with snapshots and a queued notification', async () => {
    const a = await seedDish(admin, '番茄炒蛋');
    const b = await seedDish(admin, '可乐鸡翅');
    const res = await guest.post('/bistro/api/plans', homePlan([a.id, b.id, a.id]), idem());
    expect(res.status).toBe(201);
    const plan = res.body.data;
    expect(plan).toMatchObject({ status: 'active', version: 1, mode: 'home', mealLabel: '晚餐', note: '少放辣' });
    expect(plan.dishes.map((d: { name: string }) => d.name)).toEqual(['番茄炒蛋', '可乐鸡翅']);
    expect(plan.shortId).toMatch(/^[A-Z0-9]{6}$/);
    expect(plan.notification).toMatchObject({ status: 'pending', event: 'created', planVersion: 1 });

    // Visible from another device/session.
    const other = await env.guest();
    expect((await other.get(`/bistro/api/plans/${plan.id}`)).body.data.id).toBe(plan.id);
    expect((await other.get('/bistro/api/plans?from=2030-01-01')).body.data).toHaveLength(1);
  });

  it('rejects empty, inactive and unknown dishes', async () => {
    const a = await seedDish(admin, '鱼香肉丝');
    expect((await guest.post('/bistro/api/plans', homePlan([]), idem())).body.error.code).toBe('no_items');
    await admin.patch(`/bistro/api/admin/dishes/${a.id}/active`, { active: false });
    const inactive = await guest.post('/bistro/api/plans', homePlan([a.id]), idem());
    expect(inactive.status).toBe(422);
    expect(inactive.body.error.code).toBe('unavailable_items');
    expect(inactive.body.error.details.dishIds).toEqual([a.id]);
    const unknown = await guest.post('/bistro/api/plans', homePlan(['nope']), idem());
    expect(unknown.body.error.code).toBe('unavailable_items');
  });

  it('validates meal metadata', async () => {
    const a = await seedDish(admin, '炒饭');
    const cases: [Record<string, unknown>, number][] = [
      [{ mealLabel: '' }, 400],
      [{ mealLabel: 'x'.repeat(21) }, 400],
      [{ date: '2030-02-30' }, 400],
      [{ timeZone: 'Mars/Olympus' }, 400],
      [{ localTime: '25:00' }, 422],
      [{ note: 'x'.repeat(501) }, 400],
      [{ mode: 'delivery' }, 400],
      [{ date: '2030-01-14' }, 422],
    ];
    for (const [patch, status] of cases) {
      const res = await guest.post('/bistro/api/plans', homePlan([a.id], patch), idem());
      expect(res.status, JSON.stringify(patch)).toBe(status);
    }
  });

  it('requires an idempotency key', async () => {
    const a = await seedDish(admin, '炒面');
    expect((await guest.post('/bistro/api/plans', homePlan([a.id]))).status).toBe(400);
  });
});

describe('restaurant plans', () => {
  it('stores candidates and the selected restaurant', async () => {
    const r1 = await seedRestaurant(admin, '面馆');
    const r2 = await seedRestaurant(admin, '火锅');
    const res = await guest.post('/bistro/api/plans', restaurantPlan([r1.id, r2.id, r2.id], r2.id), idem());
    expect(res.status).toBe(201);
    expect(res.body.data.candidates.map((c: { name: string }) => c.name)).toEqual(['面馆', '火锅']);
    expect(res.body.data.selectedRestaurant.name).toBe('火锅');
    expect(res.body.data.dishes).toEqual([]);
  });

  it('validates the selected member and active candidates', async () => {
    const r1 = await seedRestaurant(admin, '面馆');
    const r2 = await seedRestaurant(admin, '烧烤');
    expect((await guest.post('/bistro/api/plans', restaurantPlan([], null), idem())).body.error.code).toBe('no_items');
    expect((await guest.post('/bistro/api/plans', restaurantPlan([r1.id], null), idem())).body.error.code).toBe(
      'invalid_selection',
    );
    expect((await guest.post('/bistro/api/plans', restaurantPlan([r1.id], r2.id), idem())).body.error.code).toBe(
      'invalid_selection',
    );
    await admin.patch(`/bistro/api/admin/restaurants/${r2.id}/active`, { active: false });
    expect((await guest.post('/bistro/api/plans', restaurantPlan([r1.id, r2.id], r1.id), idem())).body.error.code).toBe(
      'unavailable_items',
    );
  });
});

describe('editing, cancelling and history', () => {
  it('updates with optimistic versioning and returns 409 on conflict', async () => {
    const a = await seedDish(admin, '番茄炒蛋');
    const b = await seedDish(admin, '清炒时蔬');
    const created = (await guest.post('/bistro/api/plans', homePlan([a.id]), idem())).body.data;
    const update = await guest.put(
      `/bistro/api/plans/${created.id}`,
      { ...homePlan([a.id, b.id], { note: '多放蒜' }), expectedVersion: 1 },
      idem(),
    );
    expect(update.status).toBe(200);
    expect(update.body.data.version).toBe(2);
    expect(update.body.data.notification).toMatchObject({ event: 'updated', planVersion: 2 });

    const stale = await guest.put(
      `/bistro/api/plans/${created.id}`,
      { ...homePlan([b.id]), expectedVersion: 1 },
      idem(),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    expect(stale.body.error.details.current.version).toBe(2);
  });

  it('cancels a plan and blocks further edits', async () => {
    const a = await seedDish(admin, '番茄炒蛋');
    const created = (await guest.post('/bistro/api/plans', homePlan([a.id]), idem())).body.data;
    const cancel = await guest.post(`/bistro/api/plans/${created.id}/cancel`, { expectedVersion: 1 }, idem());
    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toMatchObject({ status: 'cancelled', version: 2 });
    expect(cancel.body.data.notification.event).toBe('cancelled');
    const edit = await guest.put(`/bistro/api/plans/${created.id}`, { ...homePlan([a.id]), expectedVersion: 2 }, idem());
    expect(edit.status).toBe(409);
  });

  it('makes past plans read-only based on the plan zone', async () => {
    const a = await seedDish(admin, '饺子');
    const created = (await guest.post('/bistro/api/plans', homePlan([a.id], { date: '2030-01-16' }), idem())).body.data;
    // 2030-01-16T16:30Z is already 2030-01-17 00:30 in Shanghai.
    env.setNow('2030-01-16T16:30:00Z');
    const edit = await guest.put(`/bistro/api/plans/${created.id}`, { ...homePlan([a.id]), expectedVersion: 1 }, idem());
    expect(edit.status).toBe(422);
    expect(edit.body.error.code).toBe('plan_locked');
    const cancel = await guest.post(`/bistro/api/plans/${created.id}/cancel`, { expectedVersion: 1 }, idem());
    expect(cancel.body.error.code).toBe('plan_locked');
    // Still readable.
    expect((await guest.get(`/bistro/api/plans/${created.id}`)).status).toBe(200);
  });

  it('keeps name snapshots in history after catalog changes and deactivation', async () => {
    const a = await seedDish(admin, '旧名字');
    const created = (await guest.post('/bistro/api/plans', homePlan([a.id]), idem())).body.data;
    const dish = (await admin.get('/bistro/api/admin/dishes')).body.data[0];
    await admin.put(`/bistro/api/admin/dishes/${a.id}`, { ...dish, name: '新名字' });
    await admin.patch(`/bistro/api/admin/dishes/${a.id}/active`, { active: false });
    env.setNow('2030-02-01T00:00:00Z');
    const history = await guest.get('/bistro/api/plans?to=2030-01-31');
    expect(history.body.data[0].dishes[0].name).toBe('旧名字');
    expect((await guest.get(`/bistro/api/plans/${created.id}`)).body.data.dishes[0].name).toBe('旧名字');
  });

  it('records the source plan for "再来一顿" clones', async () => {
    const a = await seedDish(admin, '咖喱');
    const first = (await guest.post('/bistro/api/plans', homePlan([a.id]), idem())).body.data;
    const clone = await guest.post(
      '/bistro/api/plans',
      homePlan([a.id], { date: '2030-01-25', sourcePlanId: first.id }),
      idem(),
    );
    expect(clone.body.data.sourcePlanId).toBe(first.id);
  });
});

describe('idempotency', () => {
  it('replays repeated creates without duplicating plans or notifications', async () => {
    const a = await seedDish(admin, '番茄炒蛋');
    const opts = idem();
    const first = await guest.post('/bistro/api/plans', homePlan([a.id]), opts);
    const second = await guest.post('/bistro/api/plans', homePlan([a.id]), opts);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect((await guest.get('/bistro/api/plans')).body.data).toHaveLength(1);
    const count = env.ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('replays repeated update and cancel requests', async () => {
    const a = await seedDish(admin, '番茄炒蛋');
    const created = (await guest.post('/bistro/api/plans', homePlan([a.id]), idem())).body.data;
    const upd = idem();
    const body = { ...homePlan([a.id], { note: 'x' }), expectedVersion: 1 };
    expect((await guest.put(`/bistro/api/plans/${created.id}`, body, upd)).body.data.version).toBe(2);
    const replay = await guest.put(`/bistro/api/plans/${created.id}`, body, upd);
    expect(replay.status).toBe(200);
    expect(replay.body.data.version).toBe(2);

    const can = idem();
    expect((await guest.post(`/bistro/api/plans/${created.id}/cancel`, { expectedVersion: 2 }, can)).status).toBe(200);
    const again = await guest.post(`/bistro/api/plans/${created.id}/cancel`, { expectedVersion: 2 }, can);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('cancelled');
  });

  it('rejects reuse of a key for a different request', async () => {
    const a = await seedDish(admin, '番茄炒蛋');
    const opts = idem();
    await guest.post('/bistro/api/plans', homePlan([a.id]), opts);
    const other = await guest.post('/bistro/api/plans', homePlan([a.id], { note: 'different' }), opts);
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('idempotency_mismatch');
  });
});

describe('timezones', () => {
  it('stores origin wall time, zone and instant for timed meals', async () => {
    const a = await seedDish(admin, '牛排');
    const res = await guest.post(
      '/bistro/api/plans',
      homePlan([a.id], { localTime: '19:30', timeZone: 'America/New_York', date: '2030-03-01' }),
      idem(),
    );
    expect(res.body.data).toMatchObject({
      localTime: '19:30',
      timeZone: 'America/New_York',
      instant: '2030-03-02T00:30:00Z',
      date: '2030-03-01',
    });
  });

  it('rejects wall times skipped by DST and resolves repeated ones', async () => {
    const a = await seedDish(admin, '早午餐');
    // US spring forward 2030-03-10: 02:00–02:59 does not exist.
    const gap = await guest.post(
      '/bistro/api/plans',
      homePlan([a.id], { localTime: '02:30', timeZone: 'America/New_York', date: '2030-03-10' }),
      idem(),
    );
    expect(gap.status).toBe(422);
    expect(gap.body.error.code).toBe('nonexistent_time');
    // Fall back 2030-11-03: 01:30 happens twice — the earlier (EDT) occurrence is used.
    const overlap = await guest.post(
      '/bistro/api/plans',
      homePlan([a.id], { localTime: '01:30', timeZone: 'America/New_York', date: '2030-11-03' }),
      idem(),
    );
    expect(overlap.status).toBe(201);
    expect(overlap.body.data.instant).toBe('2030-11-03T05:30:00Z');
  });

  it('uses the plan zone to decide "today"', async () => {
    const a = await seedDish(admin, '面');
    // 2030-01-15T12:00Z is still 2030-01-15 in Honolulu but 2030-01-16 in Kiritimati (UTC+14).
    expect(
      (await guest.post('/bistro/api/plans', homePlan([a.id], { date: '2030-01-15', timeZone: 'Pacific/Honolulu' }), idem()))
        .status,
    ).toBe(201);
    expect(
      (await guest.post('/bistro/api/plans', homePlan([a.id], { date: '2030-01-15', timeZone: 'Pacific/Kiritimati' }), idem()))
        .status,
    ).toBe(422);
  });
});
