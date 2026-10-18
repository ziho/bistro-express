import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from './helpers.js';
import { canonicalVenueTag, reconcileVenueTagFilter } from '../shared/tagManagement.js';
import { emptyVenueFilter } from '../shared/venueFilter.js';
import { loadVenueFilter } from '../web/src/lib/venueFilterStore.js';

let env: TestEnv;
afterEach(() => { env?.cleanup(); vi.unstubAllGlobals(); });
const R = '/bistro/api/admin/restaurants', T = '/bistro/api/admin/restaurant-tags';
async function seed(admin: Client) {
  const create = async (name: string, tags: string[], active = true) => {
    const result = await admin.post(R, { name, tags, active, purposes: ['meal', 'treat'], review: '原点评', links: [{ label: '菜单', url: 'https://example.com' }] });
    expect(result.status).toBe(201); return result.body.data;
  };
  return [await create('甲', ['日料', '约会']), await create('乙', ['日式', '日料']), await create('丙', ['日料'], false), await create('丁', ['咖啡'])];
}
async function change(admin: Client, sources: string[], target: string) {
  const p = await admin.post(T + '/preview', { sources, target });
  expect(p.status, p.text).toBe(200);
  const body = { sources, target, expectedFingerprint: p.body.data.fingerprint };
  const headers = idem();
  return { preview: p.body.data, body, headers, result: await admin.post(T + '/apply', body, headers) };
}

describe('managed venue tags', () => {
  it('counts all shops once, previews overlap, merges atomically and preserves unrelated fields', async () => {
    env = await createTestEnv(); const admin = await env.admin(); const shops = await seed(admin);
    const index = (await admin.get(T)).body.data;
    expect(index.tags.find((tag: any) => tag.name === '日料')).toMatchObject({ count: 3, activeCount: 2 });
    const c = await change(admin, ['日料'], '日式');
    expect(c.preview).toMatchObject({ affected: 3, inactive: 1, overlap: 1, resultCount: 3 });
    expect(c.result.status).toBe(200);
    const list = (await admin.get(R)).body.data;
    for (const original of shops) {
      const saved = list.find((s: any) => s.id === original.id);
      expect(saved).toMatchObject({ name: original.name, review: original.review, links: original.links, active: original.active, purposes: original.purposes });
      expect(saved.tags).not.toContain('日料');
    }
    expect(list.find((s: any) => s.id === shops[1].id).tags).toEqual(['日式']);
    expect((await admin.get(T)).body.data).toMatchObject({ aliases: { 日料: '日式' } });
    expect((await admin.post(T + '/apply', c.body, c.headers)).body.data).toEqual(c.result.body.data);
    expect(env.ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 0 });
  });

  it('renames several sources, flattens chains and allows renaming back without cycles', async () => {
    env = await createTestEnv(); const admin = await env.admin(); await seed(admin);
    await change(admin, ['日料'], '日式');
    await change(admin, ['日式', '约会'], '聚餐');
    expect((await admin.get(T)).body.data.aliases).toEqual({ 日料: '聚餐', 日式: '聚餐', 约会: '聚餐' });
    await change(admin, ['聚餐'], '日料');
    const aliases = (await admin.get(T)).body.data.aliases;
    expect(aliases).toEqual({ 日式: '日料', 约会: '日料', 聚餐: '日料' });
    expect(Object.keys(aliases)).not.toContain('日料');
  });

  it('normalizes stale names in new, edited and bulk-imported shops, and exposes mapping to signed-in guests', async () => {
    env = await createTestEnv(); const admin = await env.admin(); const shops = await seed(admin);
    await change(admin, ['日料'], '日式');
    const added = await admin.post(R, { name: '旧页面新店', tags: ['日料', '日式'] });
    expect(added.body.data.tags).toEqual(['日式']);
    expect((await admin.put(R + '/' + shops[3].id, { name: '丁', tags: ['日料'] })).body.data.tags).toEqual(['日式']);
    const bulk = await admin.post(R + '/import', { rows: [{ clientId: 'a', name: '导入店', tags: ['日料'], mapUrl: 'https://www.google.com/maps?q=UniqueShop', sourceUrl: null }] }, idem());
    expect(bulk.body.data.created).toBe(1);
    expect((await admin.get(R)).body.data.find((s: any) => s.name === '导入店').tags).toEqual(['日式']);
    const guest = await env.guest();
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurantTagAliases).toEqual({ 日料: '日式' });
  });

  it('keeps historical snapshots and dish tags unchanged', async () => {
    env = await createTestEnv(); const admin = await env.admin(); const shops = await seed(admin);
    const guest = await env.guest();
    const p = await guest.post('/bistro/api/plans', { date: '2030-01-20', mealLabel: '晚餐', timeZone: 'Asia/Shanghai', mode: 'restaurant', candidateIds: [shops[0].id], selectedRestaurantId: shops[0].id }, idem());
    expect(p.status).toBe(201);
    const dish = await admin.post('/bistro/api/admin/dishes', { name: '菜', tags: ['日料'] });
    const before = env.ctx.db.prepare('SELECT selected_json,candidates_json,updated_at FROM plans WHERE id=?').get(p.body.data.id);
    await change(admin, ['日料'], '日式');
    expect(env.ctx.db.prepare('SELECT selected_json,candidates_json,updated_at FROM plans WHERE id=?').get(p.body.data.id)).toEqual(before);
    expect(env.ctx.repos.catalog.getDish(dish.body.data.id)?.tags).toEqual(['日料']);
  });

  it('treats object-property names as ordinary tags when creating aliases', async () => {
    env = await createTestEnv(); const admin = await env.admin();
    await admin.post(R, { name: '特殊名称', tags: ['__proto__', 'constructor'] });
    const c = await change(admin, ['__proto__', 'constructor'], '特殊分类');
    expect(c.result.status).toBe(200);
    const aliases = (await admin.get(T)).body.data.aliases;
    expect(Object.hasOwn(aliases, '__proto__')).toBe(true);
    expect(canonicalVenueTag('__proto__', aliases)).toBe('特殊分类');
    expect((await admin.post(R, { name: '旧名', tags: ['__proto__', 'constructor'] })).body.data.tags).toEqual(['特殊分类']);
  });

  it('refuses stale previews, validates input, and rolls back when the change is rejected', async () => {
    env = await createTestEnv(); const admin = await env.admin(); await seed(admin);
    const p = await admin.post(T + '/preview', { sources: ['日料'], target: '日式' });
    await admin.post(R, { name: '刚加的店', tags: ['日料'] });
    expect((await admin.post(T + '/apply', { sources: ['日料'], target: '日式', expectedFingerprint: p.body.data.fingerprint }, idem())).status).toBe(409);
    expect((await admin.get(T)).body.data.aliases).toEqual({});
    for (const body of [{ sources: [], target: 'x' }, { sources: ['日料'], target: '' }, { sources: ['日料'], target: 'a'.repeat(17) }, { sources: ['日料'], target: '\u0000' }, { sources: ['日料'], target: '日料' }, { sources: ['不存在'], target: 'x' }]) {
      expect((await admin.post(T + '/preview', body)).status).toBeGreaterThanOrEqual(400);
    }
  });

  it('is private and Origin checked, including preview and apply', async () => {
    env = await createTestEnv(); const publicClient = env.publicClient(), admin = await env.admin();
    for (const route of [T, T + '/preview', T + '/apply']) {
      expect((await publicClient.get(route)).status).toBe(404);
      expect((await publicClient.post(route, {}, { headers: { 'x-forwarded-host': 'admin.test:8788', 'x-forwarded-proto': 'https' } })).status).toBe(404);
    }
    expect((await admin.post(T + '/preview', {}, { origin: null })).status).toBe(403);
  });

  it('updates current and remembered filters with deduplication, preserving other criteria', () => {
    const filter = { ...emptyVenueFilter('meal'), tags: ['日料', '日式'], tagMode: 'all' as const, q: '店', places: ['unknown'], onlySelected: true };
    const next = reconcileVenueTagFilter(filter, { 日料: '日式' });
    expect(next).toEqual({ ...filter, tags: ['日式'] });
    expect(reconcileVenueTagFilter(next, { 日料: '日式' })).toBe(next);
    expect(canonicalVenueTag('constructor', {})).toBe('constructor');
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ version: 1, meal: { tags: ['日料'], tagMode: 'any', places: [] } }) } });
    expect(loadVenueFilter('meal', { tags: new Set(['日式']), places: new Set(), aliases: { 日料: '日式' } }).tags).toEqual(['日式']);
  });
});
