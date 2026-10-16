import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import type { AppConfig } from '../server/config.js';
import { createAppContext, type AppContext } from '../server/context.js';
import { createHttpApp } from '../server/http/app.js';
import type { HonoEnv } from '../server/http/types.js';
import { entryDateSecret, hashScrypt } from '../server/lib/crypto.js';
import { ProviderError, type NotificationProvider, type PushMessage } from '../server/notify/types.js';

/** Fictional gate answer used only in tests. */
export const TEST_ENTRY_DATE = '2001-02-03';
export const TEST_ADMIN_PASSWORD = 'test-admin-password-123';
export const PUBLIC_ORIGIN = 'https://public.test';
export const ADMIN_ORIGIN = 'https://admin.test:8788';

export class FakeProvider implements NotificationProvider {
  readonly name = 'fake';
  configured = true;
  failuresRemaining = 0;
  readonly sent: PushMessage[] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async send(message: PushMessage): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new ProviderError('fake provider down');
    }
    this.sent.push(message);
  }
}

export interface Response {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

export class Client {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: Hono<HonoEnv>,
    private readonly origin: string,
  ) {}

  async request(
    method: string,
    urlPath: string,
    opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; origin?: string | null } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const origin = opts.origin === undefined ? this.origin : opts.origin;
    if (origin) headers.origin = origin;
    let body = opts.body;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await this.app.request(`${this.origin}${urlPath}`, { method, headers, body });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      const value = rest.join('=');
      if (!name) continue;
      if (!value || /max-age=0/i.test(raw)) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  get = (p: string, o?: Parameters<Client['request']>[2]) => this.request('GET', p, o);
  post = (p: string, json?: unknown, o: Parameters<Client['request']>[2] = {}) =>
    this.request('POST', p, { ...o, json: json ?? {} });
  put = (p: string, json?: unknown, o: Parameters<Client['request']>[2] = {}) =>
    this.request('PUT', p, { ...o, json: json ?? {} });
  patch = (p: string, json?: unknown, o: Parameters<Client['request']>[2] = {}) =>
    this.request('PATCH', p, { ...o, json: json ?? {} });
  del = (p: string, o?: Parameters<Client['request']>[2]) => this.request('DELETE', p, o);
}

export interface TestEnv {
  ctx: AppContext;
  provider: FakeProvider;
  publicApp: Hono<HonoEnv>;
  adminApp: Hono<HonoEnv>;
  setNow(iso: string): void;
  advance(ms: number): void;
  now(): Date;
  guest(): Promise<Client>;
  admin(): Promise<Client>;
  publicClient(): Client;
  adminClient(): Client;
  cleanup(): void;
}

let cachedHashes: { entry: string; admin: string } | null = null;

export async function createTestEnv(start = '2030-01-15T12:00:00Z'): Promise<TestEnv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bistro-test-'));
  const webDir = path.join(dir, 'web');
  fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Bistro Express</title><div id="root"></div>');
  fs.writeFileSync(path.join(webDir, 'assets', 'app-abc123.js'), 'console.log("app")');
  fs.writeFileSync(path.join(webDir, 'sw.js'), 'self.addEventListener("fetch",()=>{})');

  // Low scrypt cost keeps tests fast; production uses setup.mjs defaults.
  cachedHashes ??= {
    entry: await hashScrypt(entryDateSecret(TEST_ENTRY_DATE), 1024, 8, 1),
    admin: await hashScrypt(TEST_ADMIN_PASSWORD, 1024, 8, 1),
  };

  const config: AppConfig = {
    publicBaseUrl: `${PUBLIC_ORIGIN}/bistro`,
    adminBaseUrl: `${ADMIN_ORIGIN}/bistro`,
    publicOrigin: PUBLIC_ORIGIN,
    adminOrigin: ADMIN_ORIGIN,
    publicPort: 0,
    adminPort: 0,
    host: '127.0.0.1',
    dataDir: path.join(dir, 'data'),
    entryDateHash: cachedHashes.entry,
    adminPasswordHash: cachedHashes.admin,
    cookieSecure: true,
    trustProxy: true,
    webDir,
  };
  let now = new Date(start);
  const provider = new FakeProvider();
  const ctx = createAppContext(config, { clock: () => now, provider: () => provider, log: () => {} });
  const publicApp = createHttpApp(ctx, 'public');
  const adminApp = createHttpApp(ctx, 'admin');

  const env: TestEnv = {
    ctx,
    provider,
    publicApp,
    adminApp,
    setNow: (iso) => {
      now = new Date(iso);
    },
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
    publicClient: () => new Client(publicApp, PUBLIC_ORIGIN),
    adminClient: () => new Client(adminApp, ADMIN_ORIGIN),
    async guest() {
      const client = new Client(publicApp, PUBLIC_ORIGIN);
      const res = await client.post('/bistro/api/auth/gate', { date: TEST_ENTRY_DATE });
      if (res.status !== 200) throw new Error(`gate failed: ${res.text}`);
      return client;
    },
    async admin() {
      const client = new Client(adminApp, ADMIN_ORIGIN);
      const res = await client.post('/bistro/api/admin/login', { password: TEST_ADMIN_PASSWORD });
      if (res.status !== 200) throw new Error(`admin login failed: ${res.text}`);
      return client;
    },
    cleanup() {
      void ctx.worker.stop();
      ctx.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return env;
}

let keyCounter = 0;
export const idem = () => ({ headers: { 'idempotency-key': `test-key-${Date.now()}-${(keyCounter += 1)}` } });

export async function seedDish(admin: Client, name: string, extra: Record<string, unknown> = {}) {
  const res = await admin.post('/bistro/api/admin/dishes', { name, category: '家常', tags: ['快手'], ...extra });
  if (res.status !== 201) throw new Error(`seed dish failed: ${res.text}`);
  return res.body.data as { id: string; name: string };
}

export async function seedRestaurant(admin: Client, name: string, extra: Record<string, unknown> = {}) {
  const res = await admin.post('/bistro/api/admin/restaurants', { name, cuisine: '川菜', ...extra });
  if (res.status !== 201) throw new Error(`seed restaurant failed: ${res.text}`);
  return res.body.data as { id: string; name: string };
}

export function homePlan(dishIds: string[], extra: Record<string, unknown> = {}) {
  return {
    date: '2030-01-20',
    mealLabel: '晚餐',
    localTime: null,
    timeZone: 'Asia/Shanghai',
    mode: 'home',
    note: '少放辣',
    dishIds,
    candidateIds: [],
    selectedRestaurantId: null,
    ...extra,
  };
}
