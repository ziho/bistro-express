import fs from 'node:fs/promises';
import { Hono } from 'hono';
import { isValidDateString } from '../../../shared/time.js';
import type { Catalog } from '../../../shared/types.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseWith, planCancelSchema, planInputSchema, planUpdateSchema, UUID_RE } from '../../lib/validation.js';
import { mediaPath, type MediaVariant } from '../../media/process.js';
import { idempotencyKey, ok, readJson, requireGuestAccess } from '../helpers.js';
import type { Ctx, HonoEnv } from '../types.js';
import { registerShoppingRoutes } from './shopping.js';

function optionalDate(c: Ctx, name: string): string | undefined {
  const value = c.req.query(name);
  if (!value) return undefined;
  if (!isValidDateString(value)) throw badRequest(`${name} 日期格式不正确`);
  return value;
}

function planId(c: Ctx): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw notFound('这个计划不存在');
  return id;
}

export function guestRoutes() {
  const r = new Hono<HonoEnv>();

  const guard = async (c: Ctx, next: () => Promise<void>) => {
    requireGuestAccess(c);
    await next();
  };
  for (const pattern of ['/catalog', '/plans', '/plans/*', '/media/*']) r.use(pattern, guard);

  r.get('/catalog', (c) => {
    const { catalog } = c.get('app').repos;
    const data: Catalog = { dishes: catalog.listDishes(true), restaurants: catalog.listRestaurants(true) };
    return ok(c, data);
  });

  r.get('/plans', (c) => {
    const plans = c.get('app').planService.list({ from: optionalDate(c, 'from'), to: optionalDate(c, 'to') });
    return ok(c, plans);
  });

  r.get('/plans/:id', (c) => ok(c, c.get('app').planService.get(planId(c))));

  r.post('/plans', async (c) => {
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const input = parseWith(planInputSchema, value);
    const res = c.get('app').planService.create(input, { key, fingerprintSource: `POST /plans ${raw}` });
    return ok(c, res.body, res.status as 200 | 201);
  });

  r.put('/plans/:id', async (c) => {
    const id = planId(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const { expectedVersion, ...input } = parseWith(planUpdateSchema, value);
    const res = c.get('app').planService.update(id, input, expectedVersion, {
      key,
      fingerprintSource: `PUT /plans/${id} ${raw}`,
    });
    return ok(c, res.body, res.status as 200);
  });

  r.post('/plans/:id/cancel', async (c) => {
    const id = planId(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const { expectedVersion } = parseWith(planCancelSchema, value);
    const res = c.get('app').planService.cancel(id, expectedVersion, {
      key,
      fingerprintSource: `POST /plans/${id}/cancel ${raw}`,
    });
    return ok(c, res.body, res.status as 200);
  });

  registerShoppingRoutes(r);

  r.get('/media/:id/:variant', async (c) => {
    const variant = c.req.param('variant') as MediaVariant;
    if (variant !== 'full' && variant !== 'thumb') throw notFound();
    const file = mediaPath(c.get('app').mediaDir, c.req.param('id') ?? '', variant);
    if (!file) throw notFound();
    let data: Buffer;
    try {
      data = await fs.readFile(file);
    } catch {
      throw notFound('图片不存在');
    }
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    });
  });

  return r;
}
