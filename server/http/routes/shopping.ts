import type { Hono } from 'hono';
import { notFound } from '../../lib/errors.js';
import { manualDeleteSchema, manualItemSchema, shoppingHaveBatchSchema, shoppingStatusSchema } from '../../lib/shoppingValidation.js';
import { parseWith, UUID_RE } from '../../lib/validation.js';
import { idempotencyKey, ok, readJson } from '../helpers.js';
import type { Ctx, HonoEnv } from '../types.js';

function uuidParam(c: Ctx, name: string, message: string): string {
  const id = c.req.param(name) ?? '';
  if (!UUID_RE.test(id)) throw notFound(message);
  return id;
}

const planIdOf = (c: Ctx) => uuidParam(c, 'id', '这个计划不存在');
const manualIdOf = (c: Ctx) => uuidParam(c, 'manualId', '这条补充项已经不存在');

/**
 * Shared shopping checklist of a home meal. Registered inside the guest routes, so it sits behind
 * the same access guard (public date gate or private listener), Origin check and body limit.
 * Every write needs an Idempotency-Key; a retry of the identical request replays the first answer.
 */
export function registerShoppingRoutes(r: Hono<HonoEnv>): void {
  r.get('/plans/:id/shopping', (c) => ok(c, c.get('app').shoppingService.get(planIdOf(c))));

  r.put('/plans/:id/shopping/status', async (c) => {
    const id = planIdOf(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const input = parseWith(shoppingStatusSchema, value);
    const res = c.get('app').shoppingService.setStatus(id, input, {
      key,
      fingerprintSource: `PUT /plans/${id}/shopping/status ${raw}`,
    });
    return ok(c, res.body, res.status as 200);
  });

  r.put('/plans/:id/shopping/have', async (c) => {
    const id = planIdOf(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const input = parseWith(shoppingHaveBatchSchema, value);
    const res = c.get('app').shoppingService.markHave(id, input, {
      key,
      fingerprintSource: `PUT /plans/${id}/shopping/have ${raw}`,
    });
    return ok(c, res.body, res.status as 200);
  });

  r.post('/plans/:id/shopping/manual', async (c) => {
    const id = planIdOf(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const input = parseWith(manualItemSchema, value);
    const res = c.get('app').shoppingService.addManual(id, input, {
      key,
      fingerprintSource: `POST /plans/${id}/shopping/manual ${raw}`,
    });
    return ok(c, res.body, res.status as 201);
  });

  r.put('/plans/:id/shopping/manual/:manualId', async (c) => {
    const id = planIdOf(c);
    const manualId = manualIdOf(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const input = parseWith(manualItemSchema, value);
    const res = c.get('app').shoppingService.updateManual(id, manualId, input, {
      key,
      fingerprintSource: `PUT /plans/${id}/shopping/manual/${manualId} ${raw}`,
    });
    return ok(c, res.body, res.status as 200);
  });

  r.delete('/plans/:id/shopping/manual/:manualId', async (c) => {
    const id = planIdOf(c);
    const manualId = manualIdOf(c);
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const input = parseWith(manualDeleteSchema, value);
    const res = c.get('app').shoppingService.deleteManual(id, manualId, input, {
      key,
      fingerprintSource: `DELETE /plans/${id}/shopping/manual/${manualId} ${raw}`,
    });
    return ok(c, res.body, res.status as 200);
  });
}
