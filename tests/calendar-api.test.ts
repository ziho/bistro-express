import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, homePlan, idem, seedRestaurant, type Client, type TestEnv } from './helpers.js';
import { createHomePlan, getList, ing, seedKitchen, setStatus } from './shoppingHelpers.js';

let env: TestEnv;
let admin: Client;
let guest: Client;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await env.admin();
  guest = await env.guest();
});
afterEach(() => env.cleanup());

const icsPath = (id: string) => `/bistro/api/plans/${id}/calendar.ics`;
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');
const prop = (ics: string, name: string) => unfold(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
const totalChanges = () => (env.ctx.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

describe('GET /plans/:id/calendar.ics', () => {
  it('downloads a private, uncached calendar file built from the frozen plan without writing anything', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id, k.eggSoup.id], { localTime: '18:30' });
    let list = await getList(guest, plan.id);
    list = (await setStatus(guest, plan.id, list, '鸡蛋', 'bought')).body.data;
    // Later catalog edits never reach the exported event.
    await admin.put(`/bistro/api/admin/dishes/${k.tomatoEgg.id}`, { name: '改名后的菜', ingredients: [ing('牛肉')] });

    const before = totalChanges();
    const res = await guest.get(icsPath(plan.id));
    expect(totalChanges()).toBe(before);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const stored = (await guest.get(`/bistro/api/plans/${plan.id}`)).body.data;
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="bistro-${stored.shortId}.ics"`);
    expect(res.headers.get('content-disposition')).toMatch(/^[\x20-\x7e]+$/);

    const ics = res.text;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(prop(ics, 'UID')).toBe(`UID:${plan.id}@bistro-express`);
    expect(prop(ics, 'SEQUENCE')).toBe('SEQUENCE:1');
    expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300120T103000Z');
    expect(prop(ics, 'DTEND')).toBe('DTEND:20300120T113000Z');
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:晚餐 · 在家吃');
    expect(prop(ics, 'LOCATION')).toBe('LOCATION:在家');
    expect(prop(ics, 'URL')).toBe(`URL:https://public.test/bistro/plans/${plan.id}`);
    const description = prop(ics, 'DESCRIPTION')!;
    expect(description).toContain('在家吃：番茄炒蛋、鸡蛋汤');
    expect(description).not.toContain('改名后的菜');
    expect(description).not.toMatch(/已买好|待采购|家里已有/);
    const stamp = new Date(stored.updatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
    expect(prop(ics, 'DTSTAMP')).toBe(`DTSTAMP:${stamp}`);

    // Repeated downloads of the same version are identical.
    expect((await guest.get(icsPath(plan.id))).text).toBe(ics);
  });

  it('keeps the UID and raises SEQUENCE when the meal changes; all-day without a time', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id], { localTime: '18:30' });
    const first = (await guest.get(icsPath(plan.id))).text;
    env.advance(60_000);
    await guest.put(`/bistro/api/plans/${plan.id}`, { ...homePlan([k.tomatoEgg.id]), localTime: null, date: '2030-12-31', expectedVersion: 1 }, idem());
    const second = (await guest.get(icsPath(plan.id))).text;
    expect(prop(second, 'UID')).toBe(prop(first, 'UID'));
    expect(prop(second, 'SEQUENCE')).toBe('SEQUENCE:2');
    expect(prop(second, 'DTSTAMP')).not.toBe(prop(first, 'DTSTAMP'));
    expect(prop(second, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20301231');
    expect(prop(second, 'DTEND')).toBe('DTEND;VALUE=DATE:20310101');
  });

  it('describes a restaurant meal with its frozen address', async () => {
    const r = await seedRestaurant(admin, '面馆', { address: '幸福路 1 号, 2 楼' });
    const plan = (
      await guest.post('/bistro/api/plans', { ...homePlan([]), mode: 'restaurant', candidateIds: [r.id], selectedRestaurantId: r.id }, idem())
    ).body.data;
    await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { name: '新店名', address: '别处' });
    const ics = (await guest.get(icsPath(plan.id))).text;
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:晚餐 · 面馆');
    expect(prop(ics, 'LOCATION')).toBe('LOCATION:幸福路 1 号\\, 2 楼');
  });

  it('refuses cancelled meals but allows a one-off export of a past meal', async () => {
    const k = await seedKitchen(admin);
    const cancelled = await createHomePlan(guest, [k.tomatoEgg.id]);
    await guest.post(`/bistro/api/plans/${cancelled.id}/cancel`, { expectedVersion: 1 }, idem());
    const res = await guest.get(icsPath(cancelled.id));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('calendar_unavailable');
    expect(res.headers.get('content-type')).toContain('application/json');

    const past = await createHomePlan(guest, [k.tomatoEgg.id], { date: '2030-01-16' });
    env.setNow('2030-02-01T00:00:00Z');
    const before = totalChanges();
    const pastRes = await guest.get(icsPath(past.id));
    expect(pastRes.status).toBe(200);
    expect(totalChanges()).toBe(before);
  });

  it('404s malformed and unknown ids', async () => {
    expect((await guest.get(icsPath('not-a-uuid'))).status).toBe(404);
    expect((await guest.get('/bistro/api/plans/..%2Fcatalog/calendar.ics')).status).toBe(404);
    expect((await guest.get(icsPath('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
  });

  it('needs the date gate publicly, works on the private listener, and has no admin or public alias', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    const anonymous = env.publicClient();
    const denied = await anonymous.get(icsPath(plan.id));
    expect(denied.status).toBe(401);
    expect(denied.text).not.toContain('BEGIN:VCALENDAR');
    // A bearer-style query or forged header does not open it either.
    expect((await anonymous.get(`${icsPath(plan.id)}?token=${plan.id}`)).status).toBe(401);
    expect((await anonymous.get(icsPath(plan.id), { headers: { 'x-forwarded-host': 'admin.test' } })).status).toBe(401);

    const internal = await admin.get(icsPath(plan.id));
    expect(internal.status).toBe(200);
    expect(prop(internal.text, 'URL')).toBe(`URL:https://admin.test:8788/bistro/plans/${plan.id}`);
    expect((await guest.get(`/bistro/api/admin/plans/${plan.id}/calendar.ics`)).status).toBe(404);
    expect((await guest.post(icsPath(plan.id), {}, idem())).status).toBe(404);
  });
});

describe('calendar hints', () => {
  it('adds a short calendar hint to new Bark messages without extra pushes', async () => {
    const k = await seedKitchen(admin);
    const plan = await createHomePlan(guest, [k.tomatoEgg.id]);
    await guest.put(`/bistro/api/plans/${plan.id}`, { ...homePlan([k.eggSoup.id]), expectedVersion: 1 }, idem());
    await guest.post(`/bistro/api/plans/${plan.id}/cancel`, { expectedVersion: 2 }, idem());
    await guest.get(icsPath(plan.id));
    await env.ctx.worker.drain();
    // Cancelling supersedes the unsent update; created + cancelled (or all three) — never an extra calendar push.
    const bodies = env.provider.sent.map((m) => m.body);
    expect(bodies.length).toBeLessThanOrEqual(3);
    const notifications = env.ctx.db.prepare('SELECT event, body, url FROM notifications ORDER BY created_at').all() as {
      event: string;
      body: string;
      url: string;
    }[];
    expect(notifications.map((n) => n.event)).toEqual(['created', 'updated', 'cancelled']);
    expect(notifications[0]!.body).toContain('可在计划详情里添加到日历');
    expect(notifications[1]!.body).toContain('如已添加到日历，请手动更新日程');
    expect(notifications[2]!.body).toContain('如已添加到日历，请手动删除日程');
    for (const n of notifications) expect(n.url).toBe(`https://public.test/bistro/plans/${plan.id}`);
  });

  it('keeps calendar files out of the service worker', () => {
    const sw = fs.readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8');
    expect(sw).toContain("url.pathname.startsWith(`${BASE}api/`)");
    expect(sw).toContain("url.pathname.endsWith('.ics')");
  });
});
