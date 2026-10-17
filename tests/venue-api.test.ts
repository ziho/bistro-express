import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../server/db/migrations.js';
import { createTestEnv, idem, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

const R = '/bistro/api/admin/restaurants';
const EMPTY = { country: '', countryCode: '', region: '', city: '', source: '' };
const BURNABY = { country: '加拿大', countryCode: 'CA', region: 'British Columbia', city: 'Burnaby', source: 'osm' };

async function venue(admin: Client, body: Record<string, unknown>) {
  const res = await admin.post(R, body);
  if (res.status !== 201) throw new Error(res.text);
  return res.body.data as { id: string; name: string; location: typeof EMPTY; purposes: string[] };
}

const outing = (candidateIds: string[], extra: Record<string, unknown> = {}) => ({
  date: '2030-01-20',
  mealLabel: '下午茶',
  localTime: '15:00',
  timeZone: 'America/Vancouver',
  mode: 'restaurant',
  note: '',
  dishIds: [],
  candidateIds,
  selectedRestaurantId: candidateIds[0] ?? null,
  ...extra,
});

describe('worldwide venue fields', () => {
  it('only needs a name: unknown location and a meal venue by default, no made-up city', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const v = await venue(admin, { name: '只有名字', address: 'Vancouver 某路 1 号' });
    expect(v.location).toEqual(EMPTY);
    expect(v.purposes).toEqual(['meal']);
  });

  it('normalizes text, fills the Chinese country from a code, and validates lengths, controls and codes', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const v = await venue(admin, {
      name: '奶茶店',
      purposes: ['treat', 'treat'],
      location: { countryCode: 'ca', region: '  British   Columbia ', city: 'Burnaby' },
    });
    expect(v.location).toEqual({ country: '加拿大', countryCode: 'CA', region: 'British Columbia', city: 'Burnaby', source: 'manual' });
    expect(v.purposes).toEqual(['treat']);
    // City-state: no region at all is fine.
    const sg = await venue(admin, { name: 'Kopi', location: { country: '新加坡', city: 'Singapore' } });
    expect(sg.location).toMatchObject({ country: '新加坡', region: '', city: 'Singapore', countryCode: '' });

    const bad = async (body: Record<string, unknown>) => (await admin.post(R, { name: 'x', ...body })).status;
    expect(await bad({ location: { city: 'a'.repeat(61) } })).toBe(400);
    expect(await bad({ location: { city: 'Bur‮naby' } })).toBe(400);
    expect(await bad({ location: { city: 5 } })).toBe(400);
    expect(await bad({ location: { countryCode: 'ZZ' } })).toBe(400);
    expect(await bad({ location: 'Canada' })).toBe(400);
    expect(await bad({ purposes: [] })).toBe(400);
    expect(await bad({ purposes: ['brunch'] })).toBe(400);
  });

  it('keeps location and purposes an older page does not send; explicit empty values clear', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const v = await venue(admin, { name: '甜品店', purposes: ['treat'], location: BURNABY });
    expect(v.location).toEqual(BURNABY);
    // An older admin page: original fields only.
    const legacy = await admin.put(`${R}/${v.id}`, { name: '甜品店', review: '好吃', tags: ['甜品'] });
    expect(legacy.status).toBe(200);
    expect(legacy.body.data).toMatchObject({ review: '好吃', purposes: ['treat'], location: BURNABY });
    // Explicit empty purposes are rejected rather than silently turned into a meal venue.
    expect((await admin.put(`${R}/${v.id}`, { name: '甜品店', purposes: [] })).status).toBe(400);
    // '' clears one field (and a manual edit is no longer the lookup's suggestion); null clears everything.
    const cleared = await admin.put(`${R}/${v.id}`, { name: '甜品店', location: { city: '' } });
    expect(cleared.body.data.location).toEqual({ ...BURNABY, city: '', source: 'manual' });
    const changedCountry = await admin.put(`${R}/${v.id}`, { name: '甜品店', location: { country: 'Canada' } });
    expect(changedCountry.body.data.location).toMatchObject({ country: 'Canada', countryCode: '' });
    const none = await admin.put(`${R}/${v.id}`, { name: '甜品店', location: null });
    expect(none.body.data.location).toEqual(EMPTY);
  });
});

describe('drinks / dessert outings', () => {
  async function setup() {
    env = await createTestEnv();
    const admin = await env.admin();
    const meal = await venue(admin, { name: '火锅店', purposes: ['meal'] });
    const treat = await venue(admin, { name: '奶茶店', purposes: ['treat'], location: BURNABY });
    const both = await venue(admin, { name: '咖啡简餐', purposes: ['meal', 'treat'] });
    return { admin, guest: await env.guest(), meal, treat, both };
  }

  it('saves a treat outing with a frozen purpose and location, separate from meals', async () => {
    const { guest, admin, treat, both } = await setup();
    const res = await guest.post('/bistro/api/plans', outing([treat.id, both.id], { purpose: 'treat' }), idem());
    expect(res.status).toBe(201);
    const plan = res.body.data;
    expect(plan).toMatchObject({ mode: 'restaurant', purpose: 'treat', selectedRestaurant: { location: BURNABY, purposes: ['treat'] } });
    // Later catalog edits never change the snapshot.
    await admin.put(`${R}/${treat.id}`, { name: '奶茶店', location: null, purposes: ['meal', 'treat'] });
    const again = (await guest.get(`/bistro/api/plans/${plan.id}`)).body.data;
    expect(again.selectedRestaurant).toMatchObject({ location: BURNABY, purposes: ['treat'] });

    await env.ctx.worker.drain();
    const msg = env.provider.sent.at(-1)!;
    expect(msg.title).toContain('饮品甜品');
    expect(msg.title).not.toContain('用餐');
    expect(msg.body).toContain('饮番杯：奶茶店');
    expect(msg.body).toContain('地区：加拿大 · British Columbia · Burnaby');

    const ics = await guest.get(`/bistro/api/plans/${plan.id}/calendar.ics`);
    expect(ics.status).toBe(200);
    expect(ics.text).toContain('SUMMARY:下午茶 · 奶茶店');
    expect(ics.text.replace(/\r\n /g, '')).toContain('饮品甜品：奶茶店');
    expect(ics.text).toMatch(/DTEND:\d{8}T\d{6}Z/); // the usual one-hour timed event
  });

  it('rejects venues of the wrong purpose on create and update; a mixed venue fits both', async () => {
    const { guest, meal, treat, both } = await setup();
    const wrong = await guest.post('/bistro/api/plans', outing([meal.id], { purpose: 'treat' }), idem());
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: 'incompatible_purpose', details: { restaurantIds: [meal.id] } });
    expect((await guest.post('/bistro/api/plans', outing([treat.id], { purpose: 'meal' }), idem())).status).toBe(422);
    // Omitted purpose on create = meal (older clients).
    expect((await guest.post('/bistro/api/plans', outing([treat.id]), idem())).status).toBe(422);
    expect((await guest.post('/bistro/api/plans', outing([both.id]), idem())).body.data.purpose).toBe('meal');
    const home = await guest.post('/bistro/api/plans', { ...outing([]), mode: 'home', purpose: 'treat', dishIds: ['x'] }, idem());
    expect(home.status).toBe(422);
    expect(home.body.error.code).toBe('invalid_purpose');
  });

  it('an older client editing a treat outing without purpose keeps it a treat; cancel and repeat work as before', async () => {
    const { guest, treat, both, meal } = await setup();
    const created = (await guest.post('/bistro/api/plans', outing([treat.id], { purpose: 'treat' }), idem())).body.data;
    const legacyEdit = await guest.put(`/bistro/api/plans/${created.id}`, { ...outing([treat.id, both.id]), expectedVersion: 1 }, idem());
    expect(legacyEdit.status).toBe(200);
    expect(legacyEdit.body.data).toMatchObject({ purpose: 'treat', version: 2 });
    // Explicitly switching to a meal needs meal venues.
    const toMeal = await guest.put(`/bistro/api/plans/${created.id}`, { ...outing([meal.id]), purpose: 'meal', expectedVersion: 2 }, idem());
    expect(toMeal.body.data).toMatchObject({ purpose: 'meal', version: 3 });

    const repeat = await guest.post('/bistro/api/plans', outing([treat.id], { purpose: 'treat', sourcePlanId: created.id }), idem());
    expect(repeat.body.data).toMatchObject({ purpose: 'treat', sourcePlanId: created.id });
    const cancelled = await guest.post(`/bistro/api/plans/${repeat.body.data.id}/cancel`, { expectedVersion: 1 }, idem());
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', purpose: 'treat' });
    await env.ctx.worker.drain();
    expect(env.provider.sent.at(-1)!.title).toContain('饮品甜品安排已取消');
    // No shopping list for any outing.
    const shopping = (await guest.get(`/bistro/api/plans/${created.id}/shopping`)).body.data;
    expect(shopping).toMatchObject({ writable: false, lockReason: 'restaurant', items: [] });
  });
});

describe('bulk import with region and purpose', () => {
  it('imports per-row location and purposes, rejects only the bad row, and still dedups by place only', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const link = (n: number) => `https://www.google.com/maps/place/Shop/data=!4m2!3m1!1s0x5486000000000001:0x00000000000000${n}0`;
    const res = await admin.post(
      `${R}/import`,
      {
        rows: [
          { clientId: 'a', name: '奶茶', mapUrl: link(1), sourceUrl: null, tags: ['奶茶'], location: BURNABY, purposes: ['treat'] },
          { clientId: 'b', name: '老格式', mapUrl: link(2), sourceUrl: null, tags: [] },
          { clientId: 'c', name: '坏地区', mapUrl: link(3), sourceUrl: null, tags: [], location: { city: 'x'.repeat(100) } },
          { clientId: 'd', name: '空用途', mapUrl: link(4), sourceUrl: null, tags: [], purposes: [] },
          // Same place as row a, different name/region/purpose: still a duplicate.
          { clientId: 'e', name: '别名', mapUrl: link(1), sourceUrl: null, tags: [], location: EMPTY, purposes: ['meal'] },
        ],
      },
      idem(),
    );
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.data.results.map((r: { clientId: string }) => [r.clientId, r]));
    expect(by.a.status).toBe('created');
    expect(by.b.status).toBe('created');
    expect(by.c).toMatchObject({ status: 'error', field: 'location.city' });
    expect(by.d).toMatchObject({ status: 'error', field: 'purposes' });
    expect(by.e.status).toBe('duplicate');
    const list = (await admin.get(R)).body.data as { name: string; location: unknown; purposes: string[] }[];
    expect(list.find((r) => r.name === '奶茶')).toMatchObject({ location: BURNABY, purposes: ['treat'] });
    expect(list.find((r) => r.name === '老格式')).toMatchObject({ location: EMPTY, purposes: ['meal'] });
  });
});

describe('migration 7', () => {
  const TS = '2030-01-01T00:00:00Z';
  const VID = '00000000-0000-4000-8000-000000000077';
  const PID = '77777777-7777-4777-8777-777777777777';
  const SNAP = { id: VID, name: '老店', imageAssetId: null, review: '', tags: ['川菜'], budgetText: '', address: '', mapUrl: null, links: [] };

  function seedV6(dataDir: string) {
    const db = new Database(path.join(dataDir, 'bistro.sqlite'));
    runMigrations(db, 6);
    db.prepare(
      `INSERT INTO restaurants (id, name, tags, budget_text, address, note, active, created_at, updated_at, links_json)
       VALUES (?, '老店', '["川菜"]', '', 'Vancouver 某路', '', 1, ?, ?, '[]')`,
    ).run(VID, TS, TS);
    db.prepare(
      `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, candidates_json, selected_json, created_at, updated_at)
       VALUES (?, 'OLD777', 'active', 2, '2030-01-20', '晚餐', 'Asia/Shanghai', 'restaurant', ?, ?, ?, ?)`,
    ).run(PID, JSON.stringify([SNAP]), JSON.stringify(SNAP), TS, TS);
    db.close();
  }

  it('adds meal purposes and blank locations without touching timestamps, tags or stored snapshots', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV6 });
    const raw = env.ctx.db.prepare('SELECT * FROM restaurants WHERE id = ?').get(VID) as Record<string, unknown>;
    expect(raw).toMatchObject({ updated_at: TS, tags: '["川菜"]', country: '', city: '', purposes_json: '["meal"]' });
    const planRow = env.ctx.db.prepare('SELECT purpose, updated_at, selected_json FROM plans WHERE id = ?').get(PID) as Record<string, string>;
    expect(planRow).toMatchObject({ purpose: 'meal', updated_at: TS });
    expect(JSON.parse(planRow.selected_json!)).toEqual(SNAP);

    const admin = await env.admin();
    const v = (await admin.get(R)).body.data[0];
    expect(v).toMatchObject({ location: EMPTY, purposes: ['meal'], address: 'Vancouver 某路' });
    const guest = await env.guest();
    const plan = (await guest.get(`/bistro/api/plans/${PID}`)).body.data;
    expect(plan).toMatchObject({ purpose: 'meal', version: 2, selectedRestaurant: { location: EMPTY, purposes: ['meal'] } });
    expect(runMigrations(env.ctx.db)).toEqual([]);
  });
});
