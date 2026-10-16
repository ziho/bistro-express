import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAdminPath } from '../server/http/middleware.js';
import { createTestEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

const ADMIN_PATHS = [
  '/bistro/admin',
  '/bistro/admin/',
  '/bistro/admin/dishes',
  '/bistro/api/admin/login',
  '/bistro/api/admin/dishes',
  '/bistro/api/admin/settings/bark',
  '/bistro/Admin',
  '/bistro/API/ADMIN/dishes',
  '/bistro/%61dmin',
  '/bistro/api/%61dmin/dishes',
  '/bistro/api/%2561dmin/dishes',
  '/bistro//admin',
  '/bistro/api//admin/dishes',
  '/bistro/./admin',
  '/bistro/assets/../admin',
  '/bistro/api/admin;x=1',
];

describe('public listener isolation', () => {
  it.each(ADMIN_PATHS)('returns 404 for %s', async (p) => {
    const res = await env.publicApp.request(`https://public.test${p}`);
    expect(res.status).toBe(404);
  });

  it('404s admin APIs even with an admin session cookie and spoofed headers', async () => {
    const legacy = env.ctx.repos.sessions.create('admin', 8 * 3600, env.now());
    const adminCookie = 'bx_admin=' + legacy.token;
    const spoofed = {
      cookie: adminCookie,
      host: 'admin.test:8788',
      'x-forwarded-host': 'admin.test:8788',
      'x-forwarded-port': '8788',
      'x-forwarded-proto': 'https',
      'x-original-url': '/bistro/api/admin/dishes',
      'x-rewrite-url': '/bistro/api/admin/dishes',
      'x-forwarded-for': '127.0.0.1',
      origin: 'https://admin.test:8788',
    };
    for (const [method, p] of [
      ['GET', '/bistro/api/admin/dishes'],
      ['POST', '/bistro/api/admin/login'],
      ['GET', '/bistro/admin'],
    ] as const) {
      const res = await env.publicApp.request(`https://public.test${p}`, {
        method,
        headers: spoofed,
        body: method === 'POST' ? JSON.stringify({ password: 'unused' }) : undefined,
      });
      expect(res.status).toBe(404);
    }
    // Header-based rewrites must not reach admin handlers through innocent paths either.
    const viaRewrite = await env.publicApp.request('https://public.test/bistro/api/catalog', { headers: spoofed });
    expect(viaRewrite.status).toBe(401);
  });

  it('admin session is not honoured as guest access on the public listener', async () => {
    const legacy = env.ctx.repos.sessions.create('admin', 8 * 3600, env.now());
    const res = await env.publicApp.request('https://public.test/bistro/api/catalog', {
      headers: { cookie: 'bx_admin=' + legacy.token },
    });
    expect(res.status).toBe(401);
    const session = await env.publicApp.request('https://public.test/bistro/api/auth/session', {
      headers: { cookie: 'bx_admin=' + legacy.token },
    });
    expect((await session.json()).data).toEqual({ listener: 'public', guest: false, admin: false });
  });

  it('the internal listener serves admin paths', async () => {
    const res = await env.adminApp.request('https://admin.test:8788/bistro/admin/dishes');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Bistro Express');
  });

  it('normalizes disguised paths', () => {
    expect(isAdminPath('/bistro/administrator')).toBe(false);
    expect(isAdminPath('/bistro/plans/admin')).toBe(false);
    expect(isAdminPath('/bistro/%E0%A4%A')).toBe(true); // malformed encoding fails closed
  });
});

describe('base path, SPA and API fallbacks', () => {
  it('serves health on both listeners', async () => {
    for (const app of [env.publicApp, env.adminApp]) {
      const res = await app.request('https://x/bistro/api/health');
      expect(res.status).toBe(200);
      expect((await res.json()).data.status).toBe('ok');
    }
  });

  it('serves the SPA shell for deep links', async () => {
    for (const p of ['/bistro/', '/bistro/plans/123e4567-e89b-12d3-a456-426614174000', '/bistro/history', '/bistro/gate']) {
      const res = await env.publicApp.request(`https://public.test${p}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('redirects bare paths into the base path', async () => {
    const bare = await env.publicApp.request('https://public.test/bistro');
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/bistro/');
    const root = await env.publicApp.request('https://public.test/');
    expect(root.headers.get('location')).toBe('/bistro/');
  });

  it('serves hashed assets as immutable and 404s missing files', async () => {
    const asset = await env.publicApp.request('https://public.test/bistro/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await env.publicApp.request('https://public.test/bistro/assets/missing.js')).status).toBe(404);
    expect((await env.publicApp.request('https://public.test/bistro/../../etc/passwd')).status).not.toBe(200);
    expect((await env.publicApp.request('https://public.test/bistro/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404);
  });

  it('serves the service worker without long caching', async () => {
    const res = await env.publicApp.request('https://public.test/bistro/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    for (const app of [env.publicApp, env.adminApp]) {
      const res = await app.request('https://x/bistro/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect((await res.json()).error.code).toBe('not_found');
    }
  });

  it('sets security headers and no-store on API responses', async () => {
    const res = await env.publicApp.request('https://public.test/bistro/api/health');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
