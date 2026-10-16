import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, TEST_ENTRY_DATE, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('guest date gate', () => {
  it('accepts the configured date and sets a hardened session cookie', async () => {
    const client = env.publicClient();
    const res = await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('bx_guest='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/bistro/);
    expect(cookie).toMatch(/Max-Age=2592000/);

    const session = await client.get('/bistro/api/auth/session');
    expect(session.body.data).toEqual({ listener: 'public', guest: true, admin: false });
  });

  it('stores only a hash of the session token', async () => {
    const client = await env.guest();
    const token = client.cookies.get('bx_guest')!;
    const rows = env.ctx.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a wrong date with a friendly message', async () => {
    const res = await env.publicClient().post('/bistro/api/auth/gate', { date: '1999-12-31' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('wrong_date');
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it('rejects malformed dates', async () => {
    const res = await env.publicClient().post('/bistro/api/auth/gate', { date: '2001-02-30' });
    expect(res.status).toBe(400);
  });

  it('rate limits repeated failures per client and globally', async () => {
    const client = env.publicClient();
    for (let i = 0; i < 8; i += 1) {
      const res = await client.post('/bistro/api/auth/gate', { date: '1999-12-31' }, { headers: { 'x-forwarded-for': '1.1.1.1' } });
      expect(res.status).toBe(401);
    }
    const blocked = await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE }, { headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // Rotating forwarded addresses still hits the global failure budget.
    for (let i = 0; i < 40; i += 1) {
      await client.post('/bistro/api/auth/gate', { date: '1999-12-31' }, { headers: { 'x-forwarded-for': `2.2.2.${i}` } });
    }
    const global = await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE }, { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(global.status).toBe(429);

    env.advance(61 * 60_000);
    const later = await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE }, { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(later.status).toBe(200);
  });

  it('expires guest sessions after 30 days', async () => {
    const client = await env.guest();
    env.advance(29 * 24 * 3600_000);
    expect((await client.get('/bistro/api/catalog')).status).toBe(200);
    env.advance(2 * 24 * 3600_000);
    expect((await client.get('/bistro/api/catalog')).status).toBe(401);
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const client = await env.guest();
    const token = client.cookies.get('bx_guest')!;
    const res = await client.post('/bistro/api/auth/logout');
    expect(res.status).toBe(200);
    expect(client.cookies.has('bx_guest')).toBe(false);
    // Replaying the old token no longer works.
    const replay = await env.publicApp.request('https://public.test/bistro/api/catalog', {
      headers: { cookie: `bx_guest=${token}` },
    });
    expect(replay.status).toBe(401);
  });
});

describe('passwordless private listener', () => {
  it('opens admin APIs without a password or cookie and creates no session', async () => {
    const client = env.adminClient();
    expect((await client.get('/bistro/api/admin/me')).body.data).toEqual({ admin: true });
    for (const route of ['dishes', 'restaurants', 'plans', 'notifications', 'settings/bark']) {
      const res = await client.get('/bistro/api/admin/' + route);
      expect(res.status, route).toBe(200);
      expect(res.headers.getSetCookie()).toHaveLength(0);
    }
    expect(client.cookies.size).toBe(0);
    expect(env.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('does not expire private access or depend on old admin cookies', async () => {
    const client = env.adminClient();
    client.cookies.set('bx_admin', 'expired-or-invalid-legacy-token');
    env.advance(31 * 24 * 3600_000);
    expect((await client.get('/bistro/api/admin/dishes')).status).toBe(200);
    expect((await client.get('/bistro/api/auth/session')).body.data).toEqual({ listener: 'admin', guest: true, admin: true });
  });

  it('also opens guest features on the private listener without the date gate', async () => {
    const client = env.adminClient();
    expect((await client.get('/bistro/api/catalog')).status).toBe(200);
    expect((await client.get('/bistro/api/auth/session')).body.data).toEqual({ listener: 'admin', guest: true, admin: true });
  });

  it('allows catalog changes without a login or cookie', async () => {
    const client = env.adminClient();
    const created = await client.post('/bistro/api/admin/dishes', { name: '免登录录入' });
    expect(created.status).toBe(201);
    expect((await client.put('/bistro/api/admin/dishes/' + created.body.data.id, { name: '修改成功' })).status).toBe(200);
    expect(client.cookies.size).toBe(0);
  });

  it('removes the old password login/logout endpoints', async () => {
    const client = env.adminClient();
    expect((await client.post('/bistro/api/admin/login', { password: 'unused' })).status).toBe(404);
    expect((await client.post('/bistro/api/admin/logout')).status).toBe(404);
  });
});

describe('origin checks on writes', () => {
  it('rejects writes without or with a foreign Origin', async () => {
    const client = env.publicClient();
    expect((await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE }, { origin: null })).status).toBe(403);
    expect(
      (await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE }, { origin: 'https://evil.test' })).status,
    ).toBe(403);
    // Public listener does not accept the admin origin and vice versa.
    expect(
      (await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE }, { origin: 'https://admin.test:8788' })).status,
    ).toBe(403);
    const admin = env.adminClient();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const origin of [null, 'https://evil.test', 'https://public.test']) {
        const res = await admin.request(method, '/bistro/api/admin/dishes', { json: { name: 'x' }, origin });
        expect(res.status).toBe(403);
      }
    }
    const missingOrigin = await admin.request('POST', '/bistro/api/admin/media', { body: new FormData(), origin: null });
    expect(missingOrigin.status).toBe(403);
    expect(env.ctx.repos.catalog.listDishes(false)).toHaveLength(0);
  });
});
