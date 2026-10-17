import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOTIFICATION_HISTORY } from '../shared/constants.js';
import { historyQuery, parsePageParam } from '../shared/notificationHistory.js';
import type { NotificationPage } from '../shared/types.js';
import { ADMIN_ORIGIN, createTestEnv, homePlan, idem, PUBLIC_ORIGIN, seedDish, type Client, type TestEnv } from './helpers.js';

const DAY = 24 * 60 * 60_000;
const RETENTION = NOTIFICATION_HISTORY.retentionMs;
const LIST = '/bistro/api/admin/notifications';

let env: TestEnv;
let admin: Client;
let guest: Client;
let dishId: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await env.admin();
  guest = await env.guest();
  dishId = (await seedDish(admin, '番茄炒蛋')).id;
});
afterEach(() => env.cleanup());

/** Far enough ahead that plans can still be created after the clock jumps past the retention window. */
async function createPlan(): Promise<{ id: string; shortId: string }> {
  const res = await guest.post('/bistro/api/plans', homePlan([dishId], { date: '2030-06-01' }), idem());
  if (res.status !== 201) throw new Error(`plan create failed: ${res.text}`);
  return res.body.data;
}

/** Inserts an isolated fake outbox row (and optional device rows) with an exact creation time. */
function insertNotification(
  planId: string,
  createdAt: string,
  opts: { status?: string; title?: string; deliveries?: { target: string; status: string }[] } = {},
): string {
  const id = randomUUID();
  const status = opts.status ?? 'sent';
  env.ctx.db
    .prepare(
      `INSERT INTO notifications (id, plan_id, plan_version, event, provider, status, attempts, next_attempt_at,
       last_error, title, body, url, created_at, updated_at)
       VALUES (?, ?, 1, 'created', 'fake', ?, 0, ?, NULL, ?, '正文', 'https://public.test/bistro', ?, ?)`,
    )
    .run(id, planId, status, status === 'pending' ? createdAt : null, opts.title ?? `通知 ${id}`, createdAt, createdAt);
  for (const d of opts.deliveries ?? []) {
    env.ctx.db
      .prepare(
        `INSERT INTO notification_deliveries (notification_id, target_id, target_label, status, attempts, next_attempt_at,
         created_at, updated_at) VALUES (?, ?, '测试设备', ?, 0, ?, ?, ?)`,
      )
      .run(id, d.target, d.status, d.status === 'pending' ? createdAt : null, createdAt, createdAt);
  }
  return id;
}

const isoAgo = (ms: number) => new Date(env.now().getTime() - ms).toISOString();
const count = (sql: string, ...params: unknown[]) => (env.ctx.db.prepare(sql).get(...params) as { n: number }).n;
const notificationIds = () =>
  new Set((env.ctx.db.prepare('SELECT id FROM notifications').all() as { id: string }[]).map((r) => r.id));

async function getPage(query: string): Promise<NotificationPage> {
  const res = await admin.get(`${LIST}?${query}`);
  expect(res.status).toBe(200);
  return res.body.data as NotificationPage;
}

describe('client page parameter', () => {
  it('accepts plain positive page numbers and falls back to page 1 for anything else', () => {
    expect(parsePageParam('3')).toBe(3);
    expect(parsePageParam(String(NOTIFICATION_HISTORY.maxPage))).toBe(NOTIFICATION_HISTORY.maxPage);
    for (const raw of [null, undefined, '', '0', '-2', '1.5', '1e3', 'Infinity', '007', ' 2', '100001', '9999999']) {
      expect(parsePageParam(raw)).toBe(1);
    }
    expect(historyQuery(2)).toBe('page=2&pageSize=10');
  });
});

describe('notification history pagination', () => {
  it('pages through more than 200 rows in SQL with a stable order for identical timestamps', async () => {
    const plan = await createPlan();
    env.ctx.db.prepare('DELETE FROM notification_deliveries').run();
    env.ctx.db.prepare('DELETE FROM notifications').run();
    const sameTime = env.now().toISOString();
    const inserted = Array.from({ length: 205 }, () => insertNotification(plan.id, sameTime));
    const newestFirst = [...inserted].reverse();

    const seen: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const data = await getPage(`page=${page}&pageSize=50`);
      expect(data).toMatchObject({ page, pageSize: 50, total: 205, totalPages: 5, held: 0, retentionDays: 14 });
      seen.push(...data.items.map((n) => n.id));
    }
    expect(seen).toEqual(newestFirst);

    const last = await getPage('page=5&pageSize=50');
    expect(last.items).toHaveLength(5);
    expect(last.items[0]).toMatchObject({ planId: plan.id, planShortId: plan.shortId, title: expect.any(String) });

    // Legacy shape (no query) stays a bounded array for older admin tabs.
    const legacy = await admin.get(LIST);
    expect(Array.isArray(legacy.body.data)).toBe(true);
    expect(legacy.body.data).toHaveLength(NOTIFICATION_HISTORY.legacyLimit);
    expect(legacy.body.data[0].id).toBe(newestFirst[0]);
  });

  it('defaults to 10 per page, clamps a page past the end and returns page 1 when empty', async () => {
    const empty = await getPage('page=3');
    expect(empty).toMatchObject({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 1, held: 0 });

    const plan = await createPlan();
    for (let i = 0; i < 22; i += 1) insertNotification(plan.id, env.now().toISOString());
    const first = await getPage('page=1');
    expect(first).toMatchObject({ page: 1, pageSize: 10, total: 23, totalPages: 3 });
    expect(first.items).toHaveLength(10);

    const beyond = await getPage('page=99999&pageSize=10');
    expect(beyond.page).toBe(3);
    expect(beyond.items).toHaveLength(3);

    const sized = await getPage('pageSize=50');
    expect(sized).toMatchObject({ page: 1, pageSize: 50, totalPages: 1 });
  });

  it('recovers when the last page expires: it clamps to the new last page', async () => {
    const plan = await createPlan();
    // The plan's own notification plus 10 newer rows → page 2 holds only the oldest record.
    for (let i = 0; i < 10; i += 1) insertNotification(plan.id, new Date(env.now().getTime() + DAY).toISOString());
    env.advance(DAY);
    expect((await getPage('page=2&pageSize=10')).items).toHaveLength(1);

    env.advance(RETENTION - DAY + 1); // the oldest row is now strictly older than 14 days
    const after = await getPage('page=2&pageSize=10');
    expect(after).toMatchObject({ page: 1, total: 10, totalPages: 1 });
    expect(after.items).toHaveLength(10);
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=abc',
    'page=1e3',
    'page=Infinity',
    'page=NaN',
    'page=',
    'page=0010',
    'page=%201',
    'page=9999999',
    'page=100001',
    'page=1&page=2',
    'pageSize=0',
    'pageSize=51',
    'pageSize=10.0',
    'pageSize=-10',
    'pageSize=99999999999999999999',
    'page=1&pageSize=',
  ])('rejects invalid query %s', async (query) => {
    const res = await admin.get(`${LIST}?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('stays private: 404 on the public listener and Origin-guarded writes on the admin listener', async () => {
    const pub = env.publicClient();
    for (const path of [`${LIST}?page=1&pageSize=10`, LIST]) {
      expect((await pub.get(path)).status).toBe(404);
      expect((await guest.get(path)).status).toBe(404);
    }
    expect((await guest.post(`${LIST}/retry-held`)).status).toBe(404);

    expect((await admin.post(`${LIST}/retry-held`, {}, { origin: null })).status).toBe(403);
    expect((await admin.post(`${LIST}/retry-held`, {}, { origin: PUBLIC_ORIGIN })).status).toBe(403);
    expect((await admin.post(`${LIST}/retry-held`, {}, { origin: ADMIN_ORIGIN })).status).toBe(200);
  });

  it('reports and retries the held count across all pages, not just the current one', async () => {
    env.provider.configured = false;
    for (let i = 0; i < 12; i += 1) await createPlan();
    await env.ctx.worker.drain();

    const page = await getPage('page=1&pageSize=5');
    expect(page).toMatchObject({ total: 12, totalPages: 3, held: 12 });
    expect(page.items).toHaveLength(5);
    expect((await getPage('page=3&pageSize=5')).held).toBe(12);

    env.provider.configured = true;
    const res = await admin.post(`${LIST}/retry-held`);
    expect(res.body.data.requeued).toBe(12);
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(12);
    expect((await getPage('page=1&pageSize=5')).held).toBe(0);
  });
});

describe('notification retention (14 days)', () => {
  it('uses an exact rolling cutoff: exactly 14 days old is kept, 1 ms older is deleted', async () => {
    const plan = await createPlan();
    const boundary = insertNotification(plan.id, isoAgo(RETENTION));
    const expired = insertNotification(plan.id, isoAgo(RETENTION + 1), {
      deliveries: [{ target: 'fake-device', status: 'sent' }],
    });

    const listed = (await getPage('page=1&pageSize=50')).items.map((n) => n.id);
    expect(listed).toContain(boundary);
    expect(listed).not.toContain(expired);
    expect((await admin.get(LIST)).body.data.map((n: { id: string }) => n.id)).not.toContain(expired);

    expect(env.ctx.repos.notifications.purgeExpired(env.now())).toBe(1);
    const ids = notificationIds();
    expect(ids.has(boundary)).toBe(true);
    expect(ids.has(expired)).toBe(false);
    expect(count('SELECT COUNT(*) AS n FROM notification_deliveries WHERE notification_id = ?', expired)).toBe(0);
  });

  it('deletes expired device rows with their record and leaves all other business data untouched', async () => {
    const restaurant = await admin.post('/bistro/api/admin/restaurants', { name: '小馆', tags: ['川菜'] });
    expect(restaurant.status).toBe(201);
    const plan = await createPlan();
    await env.ctx.worker.drain();
    const shopping = await guest.post(`/bistro/api/plans/${plan.id}/shopping/manual`, { name: '葱', expectedPlanVersion: 1, expectedRevision: 0 }, idem());
    expect(shopping.status).toBe(201);
    env.provider.configured = false;
    await createPlan(); // held (unconfigured), never delivered
    const ts = env.now().toISOString();
    env.ctx.db
      .prepare(`INSERT INTO bark_devices (id, label, device_key, enabled, created_at, updated_at) VALUES (?, '假设备', ?, 1, ?, ?)`)
      .run(randomUUID(), 'fake-key-not-real', ts, ts);
    env.ctx.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('test.fake', '{}', ?)`).run(ts);

    env.advance(RETENTION + 60_000);
    env.provider.configured = true;
    const fresh = await createPlan();
    await env.ctx.worker.drain();

    const tables = ['plans', 'plan_refs', 'dishes', 'restaurants', 'settings', 'bark_devices', 'plan_shopping', 'media', 'sessions'];
    const snapshot = () => Object.fromEntries(tables.map((t) => [t, env.ctx.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
    const before = snapshot();
    expect(count('SELECT COUNT(*) AS n FROM notification_deliveries')).toBeGreaterThan(0);

    expect(env.ctx.repos.notifications.purgeExpired(env.now())).toBe(2);
    expect(snapshot()).toEqual(before);
    expect(count('SELECT COUNT(*) AS n FROM notifications')).toBe(1);
    expect(
      count('SELECT COUNT(*) AS n FROM notification_deliveries WHERE notification_id NOT IN (SELECT id FROM notifications)'),
    ).toBe(0);

    // The plan itself is intact; it just has no notification record anymore.
    const old = await guest.get(`/bistro/api/plans/${plan.id}`);
    expect(old.status).toBe(200);
    expect(old.body.data.notification).toBeNull();
    expect((await guest.get(`/bistro/api/plans/${fresh.id}`)).body.data.notification.status).toBe('sent');
  });

  it('never deletes a record that is being sent; a later pass removes it', async () => {
    const plan = await createPlan();
    const claimed = insertNotification(plan.id, isoAgo(RETENTION + DAY), { status: 'sending' });
    const inFlightDevice = insertNotification(plan.id, isoAgo(RETENTION + DAY), {
      status: 'pending',
      deliveries: [{ target: 'fake-device', status: 'sending' }],
    });

    env.ctx.repos.notifications.purgeExpired(env.now());
    const ids = notificationIds();
    expect(ids.has(claimed)).toBe(true);
    expect(ids.has(inFlightDevice)).toBe(true);
    expect(count('SELECT COUNT(*) AS n FROM notification_deliveries WHERE notification_id = ?', inFlightDevice)).toBe(1);

    env.ctx.db.prepare(`UPDATE notifications SET status = 'failed' WHERE id = ?`).run(claimed);
    env.ctx.db.prepare(`UPDATE notification_deliveries SET status = 'failed' WHERE notification_id = ?`).run(inFlightDevice);
    expect(env.ctx.repos.notifications.purgeExpired(env.now())).toBe(2);
    expect(notificationIds().has(claimed)).toBe(false);
  });

  it('never sends an expired pending record, even before maintenance deletes it', async () => {
    const plan = await createPlan(); // pending, not delivered yet
    env.advance(RETENTION + 1);
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(0);
    expect(count(`SELECT COUNT(*) AS n FROM notifications WHERE plan_id = ? AND status = 'pending'`, plan.id)).toBe(1);
  });

  it('refuses manual and bulk retry of expired records', async () => {
    env.provider.configured = false;
    const plan = await createPlan();
    await env.ctx.worker.drain();
    const held = (await getPage('page=1')).items[0]!;
    expect(held.status).toBe('unconfigured');

    env.provider.configured = true;
    env.advance(RETENTION + 1);
    const res = await admin.post(`${LIST}/${held.id}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('expired');
    expect((await admin.post(`${LIST}/retry-held`)).body.data.requeued).toBe(0);
    expect((await getPage('page=1')).held).toBe(0);
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(0);
    expect(count('SELECT COUNT(*) AS n FROM notifications WHERE plan_id = ?', plan.id)).toBe(1);
  });

  it('on startup recovers in-flight rows, then purges expired ones before the first delivery pass', async () => {
    const oldPlan = await createPlan();
    env.advance(RETENTION + DAY);
    const recentPlan = await createPlan();
    // Simulate a crash mid-send for both records.
    env.ctx.db.prepare(`UPDATE notifications SET status = 'sending'`).run();
    env.ctx.db.prepare(`UPDATE notification_deliveries SET status = 'sending'`).run();

    env.ctx.worker.start();
    // Purge runs synchronously inside start(), before the first kick can claim anything.
    expect(count('SELECT COUNT(*) AS n FROM notifications WHERE plan_id = ?', oldPlan.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM notification_deliveries')).toBe(1);
    await env.ctx.worker.stop();

    expect(env.provider.sentTo).toHaveLength(1);
    expect(env.provider.sentTo[0]!.message.body).toContain(`#${recentPlan.shortId}`);
    expect((await guest.get(`/bistro/api/plans/${oldPlan.id}`)).body.data.notification).toBeNull();
  });
});
