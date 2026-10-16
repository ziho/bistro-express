import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGACY_DEVICE_LABEL, runMigrations } from '../server/db/migrations.js';
import { maskKey, normalizeDeviceKey } from '../server/notify/bark.js';
import { createFakeBark } from './fakeBark.js';
import { createTestEnv, homePlan, idem, seedDish, type TestEnv } from './helpers.js';

const DEVICES = '/bistro/api/admin/settings/bark/devices';
const KEY = 'SecretKeyForPhone123';

let env: TestEnv;
afterEach(() => env.cleanup());

describe('Bark device management', () => {
  it('stores keys privately: every response is masked and the raw key never appears', async () => {
    const bark = createFakeBark();
    env = await createTestEnv(undefined, { realBark: true, fetch: bark.fetch });
    const admin = await env.admin();
    const created = await admin.post(DEVICES, { label: '主厨的 iPhone', deviceKey: KEY });
    expect(created.status, created.text).toBe(201);
    expect(created.body.data.devices).toEqual([
      expect.objectContaining({ label: '主厨的 iPhone', keyMasked: maskKey(KEY), enabled: true }),
    ]);
    const id = created.body.data.devices[0].id as string;
    const texts = [
      created.text,
      (await admin.get('/bistro/api/admin/settings/bark')).text,
      (await admin.patch(`${DEVICES}/${id}`, { label: '改名了' })).text,
    ];
    for (const text of texts) expect(text).not.toContain(KEY);

    // Omitting the key on edit keeps it; the push still goes to the original key.
    await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'https://bark.example.com' });
    expect((await admin.post(`${DEVICES}/${id}/test`)).status).toBe(200);
    expect(bark.countFor(KEY)).toBe(1);
  });

  it('deduplicates keys (also when pasted as a Bark URL) and limits the number of devices', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    expect((await admin.post(DEVICES, { label: 'A', deviceKey: KEY })).status).toBe(201);
    const dup = await admin.post(DEVICES, { label: 'B', deviceKey: `https://api.day.app/${KEY}/` });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_device');
    expect(dup.text).not.toContain(KEY);

    const second = await admin.post(DEVICES, { label: 'B', deviceKey: 'OtherKey000002' });
    const secondId = second.body.data.devices[1].id as string;
    const clash = await admin.patch(`${DEVICES}/${secondId}`, { deviceKey: KEY });
    expect(clash.status).toBe(409);

    expect((await admin.post(DEVICES, { label: 'C', deviceKey: 'bad key with spaces' })).status).toBe(400);
    expect((await admin.post(DEVICES, { label: '', deviceKey: 'Fine0000003' })).status).toBe(400);

    for (let i = 3; i <= 10; i += 1) {
      expect((await admin.post(DEVICES, { label: `设备${i}`, deviceKey: `Device${i}Key0000` })).status).toBe(201);
    }
    const tooMany = await admin.post(DEVICES, { label: '第11台', deviceKey: 'Device11Key0000' });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('too_many_devices');

    expect((await admin.del(`${DEVICES}/${secondId}`)).body.data.devices).toHaveLength(9);
    expect((await admin.del(`${DEVICES}/${secondId}`)).status).toBe(404);
  });

  it('test-all reports each device separately, honours enabled flags and scrubs keys from errors', async () => {
    const bark = createFakeBark();
    env = await createTestEnv(undefined, { realBark: true, fetch: bark.fetch });
    const admin = await env.admin();
    await admin.post(DEVICES, { label: '手机', deviceKey: KEY });
    await admin.post(DEVICES, { label: 'iPad', deviceKey: 'PadKey00000002' });
    const off = await admin.post(DEVICES, { label: '旧手机', deviceKey: 'OldKey00000003', enabled: false });
    expect(off.body.data.devices[2].enabled).toBe(false);

    expect((await admin.post('/bistro/api/admin/settings/bark/test')).status).toBe(409); // global switch off
    await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'https://bark.example.com' });
    bark.failing.set('PadKey00000002', 1);
    const res = await admin.post('/bistro/api/admin/settings/bark/test');
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(false);
    expect(res.body.data.results.map((r: { label: string; ok: boolean }) => [r.label, r.ok])).toEqual([
      ['手机', true],
      ['iPad', false],
    ]);
    expect(res.text).not.toContain('PadKey00000002');
    expect(res.text).toContain('***');
    expect(bark.countFor('OldKey00000003')).toBe(0);
  });

  it('normalizes keys pasted from the Bark app', () => {
    expect(normalizeDeviceKey('  abcDEF123456  ')).toBe('abcDEF123456');
    expect(normalizeDeviceKey('https://api.day.app/abcDEF123456/标题')).toBe('abcDEF123456');
    expect(normalizeDeviceKey('abc')).toBeNull();
    expect(normalizeDeviceKey('a b c d e')).toBeNull();
  });
});

function seedV1(dataDir: string, barkJson: string | null, extra?: (db: Database.Database) => void) {
  const db = new Database(path.join(dataDir, 'bistro.sqlite'));
  runMigrations(db, 1);
  if (barkJson !== null) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('notify.bark', ?, '2030-01-01T00:00:00Z')`).run(barkJson);
  }
  extra?.(db);
  db.close();
}

const LEGACY_PLAN_ID = '11111111-1111-4111-8111-111111111111';

function seedLegacyNotifications(db: Database.Database) {
  db.prepare(
    `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, created_at, updated_at)
     VALUES (?, 'OLD234', 'active', 2, '2030-01-20', '晚餐', 'Asia/Shanghai', 'home', '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z')`,
  ).run(LEGACY_PLAN_ID);
  const insert = db.prepare(
    `INSERT INTO notifications (id, plan_id, plan_version, event, provider, status, attempts, last_error, title, body, url,
     created_at, updated_at, sent_at) VALUES (?, ?, ?, ?, 'bark', ?, ?, ?, ?, 'body', 'https://public.test/x', ?, ?, ?)`,
  );
  insert.run('aaaaaaaa-0000-4000-8000-000000000001', LEGACY_PLAN_ID, 1, 'created', 'sent', 1, null, '旧通知 v1',
    '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2030-01-01T00:00:05Z');
  insert.run('aaaaaaaa-0000-4000-8000-000000000002', LEGACY_PLAN_ID, 2, 'updated', 'failed', 5, 'Bark 网络错误', '旧通知 v2',
    '2030-01-02T00:00:00Z', '2030-01-02T00:00:00Z', null);
}

describe('migration from the single-key Bark settings', () => {
  it('turns the legacy key into a labelled device, keeps settings and completed notifications', async () => {
    const bark = createFakeBark();
    env = await createTestEnv(undefined, {
      realBark: true,
      fetch: bark.fetch,
      beforeOpen: (dir) =>
        seedV1(dir, JSON.stringify({ enabled: true, serverUrl: 'https://bark.example.com', deviceKey: KEY }), seedLegacyNotifications),
    });
    const settingsRow = env.ctx.db.prepare(`SELECT value FROM settings WHERE key = 'notify.bark'`).get() as { value: string };
    expect(JSON.parse(settingsRow.value)).toEqual({ enabled: true, serverUrl: 'https://bark.example.com' });

    const admin = await env.admin();
    const view = await admin.get('/bistro/api/admin/settings/bark');
    expect(view.body.data).toMatchObject({ enabled: true, configured: true, deviceKeyMasked: maskKey(KEY) });
    expect(view.body.data.devices).toEqual([expect.objectContaining({ label: LEGACY_DEVICE_LABEL, enabled: true })]);
    expect(view.text).not.toContain(KEY);

    const log = (await admin.get('/bistro/api/admin/notifications')).body.data;
    expect(log.map((n: { title: string; status: string }) => [n.title, n.status])).toEqual([
      ['旧通知 v2', 'failed'],
      ['旧通知 v1', 'sent'],
    ]);
    expect(log[1]).toMatchObject({ attempts: 1, sentAt: '2030-01-01T00:00:05Z', delivery: null, deliveries: [] });

    // The held legacy failure can be retried and goes to the migrated device.
    expect((await admin.post(`/bistro/api/admin/notifications/${log[0].id}/retry`)).status).toBe(200);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY)).toBe(1);
    expect((await admin.get('/bistro/api/admin/notifications')).body.data[0]).toMatchObject({
      status: 'sent',
      delivery: { total: 1, sent: 1 },
    });
  });

  it('delivers a legacy pending notification (no recipient rows) to the current devices', async () => {
    const bark = createFakeBark();
    env = await createTestEnv(undefined, {
      realBark: true,
      fetch: bark.fetch,
      beforeOpen: (dir) =>
        seedV1(dir, JSON.stringify({ enabled: true, serverUrl: 'https://bark.example.com', deviceKey: KEY }), (db) => {
          seedLegacyNotifications(db);
          db.prepare(`UPDATE notifications SET status = 'pending', next_attempt_at = '2030-01-02T00:00:00Z' WHERE plan_version = 2`).run();
        }),
    });
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY)).toBe(1);
  });

  it.each([
    ['no settings row', null],
    ['empty key', JSON.stringify({ enabled: true, serverUrl: 'https://api.day.app', deviceKey: '  ' })],
    ['corrupt JSON', '{not json'],
  ])('creates no device for %s', async (_name, json) => {
    env = await createTestEnv(undefined, { beforeOpen: (dir) => seedV1(dir, json) });
    expect(env.ctx.repos.barkDevices.count()).toBe(0);
    const versions = env.ctx.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions).toEqual(expect.arrayContaining([{ version: 1 }, { version: 2 }]));
  });

  it('keeps accepting the legacy single-key settings payload as "add this device"', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const body = { enabled: true, serverUrl: 'https://bark.example.com', deviceKey: KEY };
    await admin.put('/bistro/api/admin/settings/bark', body);
    const again = await admin.put('/bistro/api/admin/settings/bark', body);
    expect(again.body.data.devices).toHaveLength(1);
    // An empty legacy key never deletes devices.
    const cleared = await admin.put('/bistro/api/admin/settings/bark', { ...body, deviceKey: '' });
    expect(cleared.body.data.devices).toHaveLength(1);

    const dish = await seedDish(admin, '番茄炒蛋');
    const guest = await env.guest();
    expect((await guest.post('/bistro/api/plans', homePlan([dish.id]), idem())).status).toBe(201);
  });
});
