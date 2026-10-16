import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBark } from './fakeBark.js';
import { createTestEnv, homePlan, idem, seedDish, type Client, type TestEnv } from './helpers.js';

const KEY_A = 'AAAAkeyForPhoneA01';
const KEY_B = 'BBBBkeyForPadB0002';
const KEY_C = 'CCCCkeyForNewC0003';

let env: TestEnv;
afterEach(() => env.cleanup());

async function setup() {
  const bark = createFakeBark();
  env = await createTestEnv('2030-01-15T12:00:00Z', { realBark: true, fetch: bark.fetch });
  const admin = await env.admin();
  const guest = await env.guest();
  await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'https://bark.example.com' });
  return { bark, admin, guest };
}

async function addDevice(admin: Client, label: string, deviceKey: string): Promise<string> {
  const res = await admin.post('/bistro/api/admin/settings/bark/devices', { label, deviceKey });
  expect(res.status, res.text).toBe(201);
  return (res.body.data.devices as { id: string; label: string }[]).find((d) => d.label === label)!.id;
}

async function createPlan(admin: Client, guest: Client, extra: Record<string, unknown> = {}) {
  const dish = await seedDish(admin, `菜${Math.random().toString(36).slice(2, 6)}`);
  const res = await guest.post('/bistro/api/plans', homePlan([dish.id], extra), idem());
  expect(res.status, res.text).toBe(201);
  return res.body.data as { id: string; dishes: { id: string }[] };
}

const planNotification = async (guest: Client, id: string) => (await guest.get(`/bistro/api/plans/${id}`)).body.data.notification;

async function adminLog(admin: Client) {
  return (await admin.get('/bistro/api/admin/notifications')).body.data as {
    id: string;
    status: string;
    deliveries: { label: string; status: string; attempts: number; lastError: string | null }[];
  }[];
}

async function drainAfter(ms: number) {
  env.advance(ms);
  await env.ctx.worker.drain();
}

describe('multi-device Bark delivery', () => {
  it('sends the same message to every enabled device, each exactly once', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    await addDevice(admin, 'iPad', KEY_B);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_A)).toBe(1);
    expect(bark.countFor(KEY_B)).toBe(1);
    expect(bark.received[0]!.body).toBe(bark.received[1]!.body);
    const n = await planNotification(guest, plan.id);
    expect(n).toMatchObject({ status: 'sent', delivery: { total: 2, sent: 2, failed: 0, pending: 0, skipped: 0 } });
  });

  it('retries only the failed device; the successful device never receives it again', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    await addDevice(admin, 'iPad', KEY_B);
    bark.failing.set(KEY_B, 2);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();

    let n = await planNotification(guest, plan.id);
    // Partially delivered must not look like "sent".
    expect(n.status).toBe('pending');
    expect(n.delivery).toMatchObject({ total: 2, sent: 1, pending: 1 });
    expect(n.lastError).toContain('2 台设备中 1 台未送达');
    expect(n.lastError).not.toContain(KEY_B);

    await drainAfter(31_000); // B attempt 2 fails
    await drainAfter(2 * 60_000 + 1_000); // B attempt 3 succeeds
    expect(bark.countFor(KEY_A)).toBe(1);
    expect(bark.countFor(KEY_B)).toBe(1);
    n = await planNotification(guest, plan.id);
    expect(n).toMatchObject({ status: 'sent', attempts: 3, delivery: { sent: 2 } });

    const [row] = await adminLog(admin);
    expect(row!.deliveries.map((d) => [d.label, d.status, d.attempts])).toEqual([
      ['手机', 'sent', 1],
      ['iPad', 'sent', 3],
    ]);
  });

  it('caps each device at 5 attempts, reports partial failure, and a manual retry targets only the failed device', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    await addDevice(admin, 'iPad', KEY_B);
    bark.failing.set(KEY_B, Number.POSITIVE_INFINITY);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();
    for (let i = 0; i < 6; i += 1) await drainAfter(31 * 60_000);

    const n = await planNotification(guest, plan.id);
    expect(n).toMatchObject({ status: 'failed', attempts: 5, delivery: { total: 2, sent: 1, failed: 1 } });
    const [row] = await adminLog(admin);
    expect(row!.deliveries.find((d) => d.label === 'iPad')).toMatchObject({ status: 'failed', attempts: 5 });
    expect(row!.deliveries.find((d) => d.label === 'iPad')!.lastError).toContain('***');
    expect(JSON.stringify(row)).not.toContain(KEY_B);

    bark.failing.set(KEY_B, 0);
    const retry = await admin.post(`/bistro/api/admin/notifications/${n.id}/retry`);
    expect(retry.status, retry.text).toBe(200);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_A)).toBe(1);
    expect(bark.countFor(KEY_B)).toBe(1);
    expect((await planNotification(guest, plan.id)).status).toBe('sent');
  });

  it('skips a device that is disabled mid-retry without marking it sent, and resumes when re-enabled', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    const padId = await addDevice(admin, 'iPad', KEY_B);
    bark.failing.set(KEY_B, 1);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();

    await admin.patch(`/bistro/api/admin/settings/bark/devices/${padId}`, { enabled: false });
    await drainAfter(31_000);
    let n = await planNotification(guest, plan.id);
    expect(n.status).toBe('unconfigured'); // held: not everyone got it
    expect(n.delivery).toMatchObject({ total: 2, sent: 1, skipped: 1 });
    const [row] = await adminLog(admin);
    expect(row!.deliveries.find((d) => d.label === 'iPad')).toMatchObject({ status: 'skipped', lastError: '设备已停用' });

    const blocked = await admin.post(`/bistro/api/admin/notifications/${n.id}/retry`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('nothing_to_retry');

    await admin.patch(`/bistro/api/admin/settings/bark/devices/${padId}`, { enabled: true });
    expect((await admin.post(`/bistro/api/admin/notifications/${n.id}/retry`)).status).toBe(200);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_A)).toBe(1);
    expect(bark.countFor(KEY_B)).toBe(1);
    n = await planNotification(guest, plan.id);
    expect(n.status).toBe('sent');
  });

  it('stops a deleted device and never adds devices created after the event to its retries', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    const padId = await addDevice(admin, 'iPad', KEY_B);
    bark.failing.set(KEY_B, 1);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();

    expect((await admin.del(`/bistro/api/admin/settings/bark/devices/${padId}`)).status).toBe(200);
    await addDevice(admin, '新设备', KEY_C);
    await drainAfter(31_000);
    const [row] = await adminLog(admin);
    expect(row!.deliveries.map((d) => [d.label, d.status, d.lastError])).toEqual([
      ['手机', 'sent', null],
      ['iPad', 'skipped', '设备已删除'],
    ]);
    const retry = await admin.post(`/bistro/api/admin/notifications/${row!.id}/retry`);
    expect(retry.body.error.code).toBe('nothing_to_retry');
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_C)).toBe(0);
    expect(bark.countFor(KEY_A)).toBe(1);

    // New events do go to the new device.
    await createPlan(admin, guest);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_C)).toBe(1);
    expect(plan.id).toBeTruthy();
  });

  it('held (unconfigured) notifications go to the devices enabled at retry time', async () => {
    const { bark, admin, guest } = await setup();
    await admin.put('/bistro/api/admin/settings/bark', { enabled: false, serverUrl: 'https://bark.example.com' });
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();
    expect(await planNotification(guest, plan.id)).toMatchObject({ status: 'unconfigured', delivery: null });

    expect((await admin.post('/bistro/api/admin/notifications/retry-held')).body.data.requeued).toBe(0);
    await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'https://bark.example.com' });
    await addDevice(admin, '手机', KEY_A);
    await addDevice(admin, 'iPad', KEY_B);
    expect((await admin.post('/bistro/api/admin/notifications/retry-held')).body.data.requeued).toBe(1);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_A)).toBe(1);
    expect(bark.countFor(KEY_B)).toBe(1);
    expect((await planNotification(guest, plan.id)).status).toBe('sent');
  });

  it('switching the channel off holds pending devices; nobody-received messages re-target current devices', async () => {
    const { bark, admin, guest } = await setup();
    const phoneId = await addDevice(admin, '手机', KEY_A);
    bark.failing.set(KEY_A, 1);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();
    await admin.put('/bistro/api/admin/settings/bark', { enabled: false, serverUrl: 'https://bark.example.com' });
    await drainAfter(31_000);
    let n = await planNotification(guest, plan.id);
    expect(n).toMatchObject({ status: 'unconfigured', delivery: { skipped: 1, sent: 0 } });

    await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'https://bark.example.com' });
    await admin.del(`/bistro/api/admin/settings/bark/devices/${phoneId}`);
    await addDevice(admin, 'iPad', KEY_B);
    expect((await admin.post(`/bistro/api/admin/notifications/${n.id}/retry`)).status).toBe(200);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_A)).toBe(0);
    expect(bark.countFor(KEY_B)).toBe(1);
    n = await planNotification(guest, plan.id);
    expect(n).toMatchObject({ status: 'sent', delivery: { total: 1, sent: 1 } });
  });

  it('a newer plan version supersedes pending device retries; each device gets the newest exactly once', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    await addDevice(admin, 'iPad', KEY_B);
    bark.failing.set(KEY_B, 1);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();
    const upd = await guest.put(
      `/bistro/api/plans/${plan.id}`,
      { ...homePlan(plan.dishes.map((d) => d.id), { note: '改成微辣' }), expectedVersion: 1 },
      idem(),
    );
    expect(upd.status, upd.text).toBe(200);
    await drainAfter(31_000);
    const titles = (key: string) => bark.received.filter((r) => r.key === key).map((r) => r.body.match(/第 \d 版/)![0]);
    expect(titles(KEY_A)).toEqual(['第 1 版', '第 2 版']);
    expect(titles(KEY_B)).toEqual(['第 2 版']);
    const log = await adminLog(admin);
    expect(log.map((l) => l.status)).toEqual(['sent', 'superseded']);
    expect(log[1]!.deliveries.map((d) => d.status)).toEqual(['sent', 'superseded']);
  });

  it('after a crash only the in-flight device is re-sent, never the ones already delivered', async () => {
    const { bark, admin, guest } = await setup();
    await addDevice(admin, '手机', KEY_A);
    await addDevice(admin, 'iPad', KEY_B);
    bark.failing.set(KEY_B, 1);
    const plan = await createPlan(admin, guest);
    await env.ctx.worker.drain();
    // Simulate a crash while B's retry was in flight.
    env.ctx.db.prepare(`UPDATE notifications SET status = 'sending'`).run();
    env.ctx.db.prepare(`UPDATE notification_deliveries SET status = 'sending' WHERE status = 'pending'`).run();
    expect(env.ctx.repos.notifications.resetInFlight(env.now())).toBe(1);
    await env.ctx.worker.drain();
    expect(bark.countFor(KEY_A)).toBe(1);
    expect(bark.countFor(KEY_B)).toBe(1);
    expect((await planNotification(guest, plan.id)).status).toBe('sent');
  });
});
