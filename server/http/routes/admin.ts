import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS } from '../../../shared/constants.js';
import { badRequest, conflict, HttpError, notFound } from '../../lib/errors.js';
import { dishInputSchema, parseWith, restaurantInputSchema, UUID_RE } from '../../lib/validation.js';
import { processUpload } from '../../media/process.js';
import { ok, readJson, requireAdmin } from '../helpers.js';
import type { Ctx, HonoEnv } from '../types.js';
import { adminAuthRoutes } from './auth.js';
import { barkSettingsRoutes } from './barkSettings.js';
import { mapLinkRoutes } from './mapLink.js';

function itemId(c: Ctx): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw notFound();
  return id;
}

function ensureImage(c: Ctx, imageAssetId: string | null) {
  if (imageAssetId && !c.get('app').repos.media.exists(imageAssetId)) {
    throw badRequest('图片不存在，请重新上传', { field: 'imageAssetId' });
  }
}

async function readActive(c: Ctx): Promise<boolean> {
  const { value } = await readJson(c);
  const active = (value as { active?: unknown }).active;
  if (typeof active !== 'boolean') throw badRequest('active 必须是 true 或 false');
  return active;
}

function catalogRoutes() {
  const r = new Hono<HonoEnv>();

  r.get('/dishes', (c) => ok(c, c.get('app').repos.catalog.listDishes(false)));

  r.post('/dishes', async (c) => {
    const input = parseWith(dishInputSchema, (await readJson(c)).value);
    ensureImage(c, input.imageAssetId);
    const app = c.get('app');
    return ok(c, app.repos.catalog.createDish(input, app.clock()), 201);
  });

  r.put('/dishes/:id', async (c) => {
    const id = itemId(c);
    const input = parseWith(dishInputSchema, (await readJson(c)).value);
    ensureImage(c, input.imageAssetId);
    const app = c.get('app');
    const dish = app.repos.catalog.updateDish(id, input, app.clock());
    if (!dish) throw notFound('这道菜不存在');
    return ok(c, dish);
  });

  r.patch('/dishes/:id/active', async (c) => {
    const id = itemId(c);
    const app = c.get('app');
    const dish = app.repos.catalog.setDishActive(id, await readActive(c), app.clock());
    if (!dish) throw notFound('这道菜不存在');
    return ok(c, dish);
  });

  r.delete('/dishes/:id', (c) => {
    const result = c.get('app').repos.catalog.deleteDish(itemId(c));
    if (result === 'missing') throw notFound('这道菜不存在');
    if (result === 'referenced') throw conflict('referenced', '这道菜出现在历史计划里，只能下架，不能删除');
    return ok(c, { deleted: true });
  });

  r.get('/restaurants', (c) => ok(c, c.get('app').repos.catalog.listRestaurants(false)));

  r.post('/restaurants', async (c) => {
    const input = parseWith(restaurantInputSchema, (await readJson(c)).value);
    ensureImage(c, input.imageAssetId);
    const app = c.get('app');
    return ok(c, app.repos.catalog.createRestaurant(input, app.clock()), 201);
  });

  r.put('/restaurants/:id', async (c) => {
    const id = itemId(c);
    const input = parseWith(restaurantInputSchema, (await readJson(c)).value);
    ensureImage(c, input.imageAssetId);
    const app = c.get('app');
    const restaurant = app.repos.catalog.updateRestaurant(id, input, app.clock());
    if (!restaurant) throw notFound('这家餐厅不存在');
    return ok(c, restaurant);
  });

  r.patch('/restaurants/:id/active', async (c) => {
    const id = itemId(c);
    const app = c.get('app');
    const restaurant = app.repos.catalog.setRestaurantActive(id, await readActive(c), app.clock());
    if (!restaurant) throw notFound('这家餐厅不存在');
    return ok(c, restaurant);
  });

  r.delete('/restaurants/:id', (c) => {
    const result = c.get('app').repos.catalog.deleteRestaurant(itemId(c));
    if (result === 'missing') throw notFound('这家餐厅不存在');
    if (result === 'referenced') throw conflict('referenced', '这家餐厅出现在历史计划里，只能下架，不能删除');
    return ok(c, { deleted: true });
  });

  return r;
}

function mediaRoutes() {
  const r = new Hono<HonoEnv>();
  r.post(
    '/media',
    bodyLimit({
      maxSize: LIMITS.uploadBytes + 512 * 1024,
      onError: () => {
        throw new HttpError(413, 'file_too_large', '图片不能超过 20MB');
      },
    }),
    async (c) => {
      let body: Record<string, unknown>;
      try {
        body = await c.req.parseBody();
      } catch {
        throw badRequest('上传内容无效');
      }
      const file = body.file;
      if (!(file instanceof File)) throw badRequest('请选择一张图片');
      const app = c.get('app');
      const processed = await processUpload(Buffer.from(await file.arrayBuffer()), app.mediaDir);
      app.repos.media.insert(processed, app.clock());
      const { id, width, height, sourceType } = processed;
      return ok(c, { id, width, height, sourceType }, 201);
    },
  );
  return r;
}

function notificationRoutes() {
  const r = new Hono<HonoEnv>();

  r.get('/plans', (c) => ok(c, c.get('app').planService.list({})));

  r.get('/notifications', (c) => ok(c, c.get('app').repos.notifications.list(200)));

  r.post('/notifications/retry-held', (c) => {
    const app = c.get('app');
    const count = app.repos.notifications.retryAllHeld(app.clock(), app.provider.listRecipients());
    if (count) app.worker.kick();
    return ok(c, { requeued: count });
  });

  r.post('/notifications/:id/retry', (c) => {
    const app = c.get('app');
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) throw notFound();
    const result = app.repos.notifications.retry(id, app.clock(), app.provider.listRecipients());
    if (result === 'missing') throw notFound('通知记录不存在');
    if (result === 'stale') throw conflict('stale', '这条通知已被更新的版本取代，无需重试');
    if (result === 'not_retryable') throw conflict('not_retryable', '只有发送失败或未送达的通知可以重试');
    if (result === 'unconfigured') throw conflict('unconfigured', '推送还未启用，或没有启用的设备');
    if (result === 'nothing_to_retry') {
      throw conflict('nothing_to_retry', '没有可重试的设备：未送达的设备已停用或删除，已送达的设备不会重复推送');
    }
    app.worker.kick();
    return ok(c, { requeued: true });
  });

  return r;
}

export function adminRoutes() {
  const r = new Hono<HonoEnv>();
  r.route('/', adminAuthRoutes());
  r.use('*', async (c, next) => {
    if (c.req.path.endsWith('/admin/login') || c.req.path.endsWith('/admin/logout')) return next();
    requireAdmin(c);
    await next();
  });
  r.route('/', catalogRoutes());
  r.route('/', mediaRoutes());
  r.route('/', notificationRoutes());
  r.route('/', barkSettingsRoutes());
  r.route('/', mapLinkRoutes());
  return r;
}
