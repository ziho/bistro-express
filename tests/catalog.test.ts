import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, homePlan, idem, seedDish, seedRestaurant, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('catalog access', () => {
  it('requires a guest or admin session', async () => {
    expect((await env.publicClient().get('/bistro/api/catalog')).status).toBe(401);
    expect((await env.adminClient().get('/bistro/api/catalog')).status).toBe(401);
    expect((await env.adminClient().get('/bistro/api/admin/dishes')).status).toBe(401);
  });

  it('starts empty', async () => {
    const guest = await env.guest();
    const res = await guest.get('/bistro/api/catalog');
    expect(res.body.data).toEqual({ dishes: [], restaurants: [] });
  });
});

describe('admin dish CRUD and availability', () => {
  it('creates, updates, deactivates and reactivates dishes', async () => {
    const admin = await env.admin();
    const guest = await env.guest();
    const created = await admin.post('/bistro/api/admin/dishes', {
      name: '  番茄炒蛋 ',
      category: '家常',
      tags: ['快手', '快手', '下饭'],
      description: '<b>酸甜</b>',
      recipeUrl: 'https://example.com/recipe',
    });
    expect(created.status).toBe(201);
    const dish = created.body.data;
    expect(dish.name).toBe('番茄炒蛋');
    expect(dish.tags).toEqual(['快手', '下饭']);
    expect(dish.description).toBe('<b>酸甜</b>'); // stored verbatim, escaped at render time

    const updated = await admin.put(`/bistro/api/admin/dishes/${dish.id}`, { ...dish, name: '西红柿炒蛋' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('西红柿炒蛋');

    expect((await guest.get('/bistro/api/catalog')).body.data.dishes).toHaveLength(1);
    const off = await admin.patch(`/bistro/api/admin/dishes/${dish.id}/active`, { active: false });
    expect(off.body.data.active).toBe(false);
    expect((await guest.get('/bistro/api/catalog')).body.data.dishes).toHaveLength(0);
    expect((await admin.get('/bistro/api/admin/dishes')).body.data).toHaveLength(1);
    await admin.patch(`/bistro/api/admin/dishes/${dish.id}/active`, { active: true });
    expect((await guest.get('/bistro/api/catalog')).body.data.dishes).toHaveLength(1);
  });

  it('validates required fields and URL schemes', async () => {
    const admin = await env.admin();
    expect((await admin.post('/bistro/api/admin/dishes', { name: '' })).status).toBe(400);
    const js = await admin.post('/bistro/api/admin/dishes', { name: 'x', recipeUrl: 'javascript:alert(1)' });
    expect(js.status).toBe(400);
    expect(js.body.error.details.field).toBe('recipeUrl');
    const map = await admin.post('/bistro/api/admin/restaurants', { name: 'y', mapUrl: 'data:text/html,hi' });
    expect(map.status).toBe(400);
    const missingImage = await admin.post('/bistro/api/admin/dishes', { name: 'z', imageAssetId: 'a'.repeat(32) });
    expect(missingImage.status).toBe(400);
  });

  it('hard-deletes unreferenced items but only allows deactivating referenced ones', async () => {
    const admin = await env.admin();
    const guest = await env.guest();
    const unused = await seedDish(admin, '凉拌黄瓜');
    expect((await admin.del(`/bistro/api/admin/dishes/${unused.id}`)).status).toBe(200);

    const used = await seedDish(admin, '红烧肉');
    expect((await guest.post('/bistro/api/plans', homePlan([used.id]), idem())).status).toBe(201);
    const del = await admin.del(`/bistro/api/admin/dishes/${used.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('referenced');
  });
});

describe('admin restaurant CRUD', () => {
  it('creates and edits restaurants with all fields', async () => {
    const admin = await env.admin();
    const created = await admin.post('/bistro/api/admin/restaurants', {
      name: '小酒馆',
      cuisine: '西餐',
      tags: ['约会'],
      budgetText: '人均 150',
      address: '某路 1 号',
      mapUrl: 'https://maps.example.com/?q=1',
      note: '需要预约',
    });
    expect(created.status).toBe(201);
    const r = created.body.data;
    expect(r).toMatchObject({ cuisine: '西餐', budgetText: '人均 150', active: true });
    const off = await admin.patch(`/bistro/api/admin/restaurants/${r.id}/active`, { active: false });
    expect(off.body.data.active).toBe(false);
    const guest = await env.guest();
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurants).toHaveLength(0);
    await seedRestaurant(admin, '面馆');
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurants).toHaveLength(1);
  });
});
