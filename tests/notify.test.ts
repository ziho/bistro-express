import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maskKey, sendBark } from '../server/notify/bark.js';
import { createTestEnv, homePlan, idem, seedDish, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Client;
let guest: Client;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await env.admin();
  guest = await env.guest();
});
afterEach(() => env.cleanup());

async function createPlan(extra: Record<string, unknown> = {}) {
  const dish = await seedDish(admin, `菜${Math.random().toString(36).slice(2, 6)}`);
  return (await guest.post('/bistro/api/plans', homePlan([dish.id], extra), idem())).body.data;
}

describe('notification outbox', () => {
  it('delivers a full summary with a public deep link via the provider adapter', async () => {
    const plan = await createPlan({ localTime: '18:30' });
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(1);
    const msg = env.provider.sent[0]!;
    expect(msg.group).toBe('Bistro Express');
    expect(msg.title).toContain('新的用餐计划');
    expect(msg.body).toContain('2030-01-20');
    expect(msg.body).toContain('晚餐 18:30');
    expect(msg.body).toContain('Asia/Shanghai');
    expect(msg.body).toContain('少放辣');
    expect(msg.body).toContain(`#${plan.shortId}`);
    expect(msg.body).toContain('第 1 版');
    expect(msg.url).toBe(`https://public.test/bistro/plans/${plan.id}`);
    const fetched = (await guest.get(`/bistro/api/plans/${plan.id}`)).body.data;
    expect(fetched.notification.status).toBe('sent');
  });

  it('retries with backoff, gives up after 5 attempts, and allows a manual retry', async () => {
    env.provider.failuresRemaining = 99;
    const plan = await createPlan();
    await env.ctx.worker.drain();
    let n = (await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification;
    expect(n).toMatchObject({ status: 'pending', attempts: 1 });
    expect(n.lastError).toContain('fake provider down');

    for (let i = 0; i < 4; i += 1) {
      env.advance(31 * 60_000);
      await env.ctx.worker.drain();
    }
    n = (await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification;
    expect(n).toMatchObject({ status: 'failed', attempts: 5 });
    expect(env.provider.sent).toHaveLength(0);

    env.provider.failuresRemaining = 0;
    const retry = await admin.post(`/bistro/api/admin/notifications/${n.id}/retry`);
    expect(retry.status).toBe(200);
    await env.ctx.worker.drain();
    expect((await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification.status).toBe('sent');
    expect(env.provider.sent).toHaveLength(1);
  });

  it('does not retry before the backoff elapses', async () => {
    env.provider.failuresRemaining = 1;
    const plan = await createPlan();
    await env.ctx.worker.drain();
    env.advance(10_000);
    await env.ctx.worker.drain();
    expect((await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification.attempts).toBe(1);
    env.advance(30_000);
    await env.ctx.worker.drain();
    expect((await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification.status).toBe('sent');
  });

  it('marks notifications unconfigured (never sent) when no channel is set up', async () => {
    env.provider.configured = false;
    const plan = await createPlan();
    await env.ctx.worker.drain();
    const n = (await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification;
    expect(n.status).toBe('unconfigured');
    expect(env.provider.sent).toHaveLength(0);

    env.provider.configured = true;
    const res = await admin.post('/bistro/api/admin/notifications/retry-held');
    expect(res.body.data.requeued).toBe(1);
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(1);
  });

  it('supersedes stale unsent revisions so only the newest is delivered', async () => {
    env.provider.failuresRemaining = 1;
    const plan = await createPlan();
    await env.ctx.worker.drain(); // first attempt fails, waits for backoff
    const upd = await guest.put(
      `/bistro/api/plans/${plan.id}`,
      { ...homePlan(plan.dishes.map((d: { id: string }) => d.id), { note: '改成微辣' }), expectedVersion: 1 },
      idem(),
    );
    expect(upd.status).toBe(200);
    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(1);
    expect(env.provider.sent[0]!.title).toContain('有更新');
    expect(env.provider.sent[0]!.body).toContain('第 2 版');
    const log = (await admin.get('/bistro/api/admin/notifications')).body.data as { status: string }[];
    expect(log.map((l) => l.status).sort()).toEqual(['sent', 'superseded']);
    const stale = log.find((l) => l.status === 'superseded') as unknown as { id: string };
    expect((await admin.post(`/bistro/api/admin/notifications/${stale.id}/retry`)).status).toBe(409);
  });

  it('re-queues in-flight messages after a restart', async () => {
    const plan = await createPlan();
    env.ctx.db.prepare(`UPDATE notifications SET status = 'sending'`).run();
    expect(env.ctx.repos.notifications.resetInFlight(env.now())).toBe(1);
    await env.ctx.worker.drain();
    expect((await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.notification.status).toBe('sent');
  });

  it('notifies on cancel', async () => {
    const plan = await createPlan();
    await env.ctx.worker.drain();
    await guest.post(`/bistro/api/plans/${plan.id}/cancel`, { expectedVersion: 1 }, idem());
    await env.ctx.worker.drain();
    expect(env.provider.sent.map((m) => m.title.split(' · ')[0])).toEqual(['新的用餐计划', '用餐计划已取消']);
  });
});

describe('Bark settings and adapter', () => {
  it('stores settings privately and masks the device key on read', async () => {
    const initial = await admin.get('/bistro/api/admin/settings/bark');
    expect(initial.body.data).toMatchObject({ enabled: false, configured: false, deviceKeyMasked: null });
    const saved = await admin.put('/bistro/api/admin/settings/bark', {
      enabled: true,
      serverUrl: 'https://bark.example.com/',
      deviceKey: 'ABCDEFGHIJKLMNOP',
    });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain('ABCDEFGHIJKLMNOP');
    expect(saved.body.data).toMatchObject({ enabled: true, configured: true, serverUrl: 'https://bark.example.com' });
    // Omitting the key keeps it.
    const kept = await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'https://bark.example.com' });
    expect(kept.body.data.deviceKeyMasked).toBe(maskKey('ABCDEFGHIJKLMNOP'));
    const bad = await admin.put('/bistro/api/admin/settings/bark', { enabled: true, serverUrl: 'ftp://x' });
    expect(bad.status).toBe(400);
  });

  it('test push refuses when not configured', async () => {
    const res = await admin.post('/bistro/api/admin/settings/bark/test');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('unconfigured');
  });

  it('posts JSON to /push and treats only code 200 as accepted', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 });
    };
    const settings = { enabled: true, serverUrl: 'https://bark.example.com/', deviceKey: 'KEY123456' };
    await sendBark(settings, { title: 't', body: 'b', url: 'https://public.test/bistro/plans/1', group: 'Bistro Express' }, fakeFetch);
    expect(calls[0]!.url).toBe('https://bark.example.com/push');
    expect(calls[0]!.body).toMatchObject({ device_key: 'KEY123456', title: 't', group: 'Bistro Express' });

    const failing = async () => new Response(JSON.stringify({ code: 400, message: 'bad key KEY123456' }), { status: 400 });
    await expect(sendBark(settings, { title: 't', body: 'b', url: 'u', group: 'g' }, failing)).rejects.toThrow(/\*\*\*/);
    const offline = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(sendBark(settings, { title: 't', body: 'b', url: 'u', group: 'g' }, offline)).rejects.toThrow(/网络错误/);
  });
});
