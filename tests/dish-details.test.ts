import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISH_LIMITS } from '../shared/constants.js';
import { createTestEnv, homePlan, idem, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

const DISHES = '/bistro/api/admin/dishes';
const create = (admin: Client, body: Record<string, unknown>) => admin.post(DISHES, body);
const update = (admin: Client, id: string, body: Record<string, unknown>) => admin.put(`${DISHES}/${id}`, body);
const ing = (name: string, quantity = '', purchaseNote = '') => ({ name, quantity, purchaseNote });

/** Everything a fully filled dish carries (as the new admin form sends it). */
const FULL = {
  name: '土豆烧鸡',
  sections: ['配饭菜', '饭面简餐'],
  tags: ['下饭'],
  description: '周末做',
  recipeUrl: 'https://example.com/recipe',
  ingredients: [ing('鸡腿', '约300g', '去骨鸡腿'), ing('土豆', '两个')],
  totalMinutes: 50,
  activeMinutes: 20,
  servingText: '一盘（两人分享）',
  shoppingNote: '周末去菜市场',
};

/** What an older admin page (before the dish details existed) sends when saving a dish. */
const oldClientBody = (name: string, category: string) => ({
  name,
  imageAssetId: null,
  category,
  tags: ['下饭'],
  description: '旧页面保存',
  recipeUrl: 'https://example.com/recipe',
  active: true,
});

describe('dish details: create and defaults', () => {
  it('creates a dish with only a name and empty defaults', async () => {
    const admin = await env.admin();
    const res = await create(admin, { name: '  番茄炒蛋 ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: '番茄炒蛋',
      category: '',
      sections: [],
      tags: [],
      description: '',
      recipeUrl: null,
      imageAssetId: null,
      ingredients: [],
      totalMinutes: null,
      activeMinutes: null,
      servingText: '',
      shoppingNote: '',
      active: true,
    });
  });

  it('stores every detail, trims text, and exposes it in the guest catalog', async () => {
    const admin = await env.admin();
    const res = await create(admin, {
      ...FULL,
      sections: ['  配饭菜 ', '饭面简餐', '配饭菜', '  '],
      ingredients: [ing(' 鸡腿 ', ' 约300g ', ' 去骨  鸡腿 '), ing('', '', ''), ing('  ', ' ', ''), ing('土豆', '两个')],
      servingText: '  一盘（两人分享） ',
      shoppingNote: '  周末去菜市场 ',
    });
    expect(res.status).toBe(201);
    const dish = res.body.data;
    expect(dish.sections).toEqual(['配饭菜', '饭面简餐']);
    expect(dish.category).toBe('配饭菜'); // deprecated projection = first section
    expect(dish.ingredients).toEqual([ing('鸡腿', '约300g', '去骨 鸡腿'), ing('土豆', '两个')]);
    expect(dish).toMatchObject({ totalMinutes: 50, activeMinutes: 20, servingText: '一盘（两人分享）', shoppingNote: '周末去菜市场' });

    const guest = await env.guest();
    const catalog = (await guest.get('/bistro/api/catalog')).body.data;
    expect(catalog.dishes[0]).toMatchObject({ sections: ['配饭菜', '饭面简餐'], ingredients: dish.ingredients, totalMinutes: 50 });
  });

  it('keeps zero minutes apart from missing ones and allows either time alone', async () => {
    const admin = await env.admin();
    const zero = await create(admin, { name: '凉拌黄瓜', totalMinutes: 0, activeMinutes: 0 });
    expect(zero.body.data).toMatchObject({ totalMinutes: 0, activeMinutes: 0 });
    const totalOnly = await create(admin, { name: '炖汤', totalMinutes: 1440 });
    expect(totalOnly.body.data).toMatchObject({ totalMinutes: 1440, activeMinutes: null });
    const activeOnly = await create(admin, { name: '炒青菜', activeMinutes: 10, totalMinutes: '' });
    expect(activeOnly.body.data).toMatchObject({ totalMinutes: null, activeMinutes: 10 });
  });

  it.each([
    [{ totalMinutes: -1 }, 'totalMinutes'],
    [{ totalMinutes: 1441 }, 'totalMinutes'],
    [{ totalMinutes: 12.5 }, 'totalMinutes'],
    [{ totalMinutes: '30' }, 'totalMinutes'],
    [{ activeMinutes: 1e9 }, 'activeMinutes'],
    [{ totalMinutes: 10, activeMinutes: 11 }, 'activeMinutes'],
  ])('rejects invalid times %j', async (body, field) => {
    const admin = await env.admin();
    const res = await create(admin, { name: '测试', ...body });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe(field);
    expect(res.body.error.message).toMatch(/分钟|动手时间/);
  });

  it('gives row errors for ingredient metadata without a name and enforces limits', async () => {
    const admin = await env.admin();
    const orphan = await create(admin, { name: '测试', ingredients: [ing('鸡蛋'), ing('', '两个')] });
    expect(orphan.status).toBe(400);
    expect(orphan.body.error.details.field).toBe('ingredients.1.name');
    expect(orphan.body.error.message).toContain('主料名称');
    const noteOnly = await create(admin, { name: '测试', ingredients: [ing('', '', '常买品牌')] });
    expect(noteOnly.body.error.details.field).toBe('ingredients.0.name');

    const longName = await create(admin, { name: '测试', ingredients: [ing('鸡'.repeat(DISH_LIMITS.ingredientName + 1))] });
    expect(longName.body.error.details.field).toBe('ingredients.0.name');
    const longQty = await create(admin, { name: '测试', ingredients: [ing('鸡', '1'.repeat(DISH_LIMITS.ingredientQuantity + 1))] });
    expect(longQty.body.error.details.field).toBe('ingredients.0.quantity');
    const longNote = await create(admin, { name: '测试', ingredients: [ing('鸡', '', 'x'.repeat(DISH_LIMITS.purchaseNote + 1))] });
    expect(longNote.body.error.details.field).toBe('ingredients.0.purchaseNote');

    const max = Array.from({ length: DISH_LIMITS.ingredients }, (_, i) => ing(`料${i}`));
    expect((await create(admin, { name: '满', ingredients: max })).status).toBe(201);
    const tooMany = await create(admin, { name: '超', ingredients: [...max, ing('多一个')] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details.field).toBe('ingredients');
  });

  it('validates sections, serving and purchase note lengths', async () => {
    const admin = await env.admin();
    const many = Array.from({ length: DISH_LIMITS.sections + 1 }, (_, i) => `分区${i}`);
    expect((await create(admin, { name: 'a', sections: many })).body.error.details.field).toBe('sections');
    const long = await create(admin, { name: 'a', sections: ['x'.repeat(DISH_LIMITS.section + 1)] });
    expect(long.body.error.details.field).toBe('sections.0');
    const serving = await create(admin, { name: 'a', servingText: 'x'.repeat(DISH_LIMITS.servingText + 1) });
    expect(serving.body.error.details.field).toBe('servingText');
    const note = await create(admin, { name: 'a', shoppingNote: 'x'.repeat(DISH_LIMITS.shoppingNote + 1) });
    expect(note.body.error.details.field).toBe('shoppingNote');
    expect((await create(admin, { name: 'a', sections: 'x' })).status).toBe(400);
    expect(env.ctx.repos.catalog.listDishes(false)).toHaveLength(0);
  });
});

describe('dish details: editing', () => {
  it('edits multiple sections and clears every optional value with explicit []/null/""', async () => {
    const admin = await env.admin();
    const dish = (await create(admin, FULL)).body.data;
    const moved = await update(admin, dish.id, { ...FULL, sections: ['汤羹', '配饭菜'] });
    expect(moved.body.data.sections).toEqual(['汤羹', '配饭菜']);
    expect(moved.body.data.category).toBe('汤羹');

    const cleared = await update(admin, dish.id, {
      name: dish.name,
      sections: [],
      tags: [],
      description: '',
      recipeUrl: null,
      ingredients: [],
      totalMinutes: null,
      activeMinutes: '',
      servingText: '',
      shoppingNote: null,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({
      category: '',
      sections: [],
      tags: [],
      description: '',
      recipeUrl: null,
      ingredients: [],
      totalMinutes: null,
      activeMinutes: null,
      servingText: '',
      shoppingNote: '',
    });
    const raw = env.ctx.db.prepare('SELECT category, sections_json FROM dishes WHERE id = ?').get(dish.id);
    expect(raw).toEqual({ category: '', sections_json: '[]' });

    // A cached old page saving with its stale blank category does not bring anything back.
    const old = await update(admin, dish.id, oldClientBody(dish.name, ''));
    expect(old.body.data.sections).toEqual([]);
  });

  it('keeps the new fields an older client does not send', async () => {
    const admin = await env.admin();
    const dish = (await create(admin, FULL)).body.data;
    const res = await update(admin, dish.id, oldClientBody('土豆烧鸡（改）', '配饭菜'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: '土豆烧鸡（改）',
      description: '旧页面保存',
      sections: FULL.sections,
      ingredients: FULL.ingredients,
      totalMinutes: 50,
      activeMinutes: 20,
      servingText: FULL.servingText,
      shoppingNote: FULL.shoppingNote,
    });
  });

  it('never lets a legacy category wipe a multi-section dish', async () => {
    const admin = await env.admin();
    const dish = (await create(admin, { ...FULL, sections: ['配饭菜', '汤羹', '家常'] })).body.data;
    for (const category of ['', '   ', '配饭菜', '汤羹']) {
      const res = await update(admin, dish.id, oldClientBody(dish.name, category));
      expect(res.body.data.sections).toEqual(['配饭菜', '汤羹', '家常']);
    }
    // A new category from an old page replaces only the first section it displayed.
    const changed = await update(admin, dish.id, oldClientBody(dish.name, '下酒菜'));
    expect(changed.body.data.sections).toEqual(['下酒菜', '汤羹', '家常']);
    // Explicit sections win over a category sent alongside.
    const explicit = await update(admin, dish.id, { ...oldClientBody(dish.name, '家常'), sections: [] });
    expect(explicit.body.data.sections).toEqual([]);
  });

  it('checks active <= total against the stored value when only one time is sent', async () => {
    const admin = await env.admin();
    const dish = (await create(admin, { name: '炖肉', totalMinutes: 60, activeMinutes: 15 })).body.data;
    const bad = await update(admin, dish.id, { name: '炖肉', totalMinutes: 10 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('activeMinutes');
    const ok = await update(admin, dish.id, { name: '炖肉', activeMinutes: 60 });
    expect(ok.body.data).toMatchObject({ totalMinutes: 60, activeMinutes: 60 });
  });

  it('accepts an older client creating with a category as one unsplit section; explicit sections win', async () => {
    const admin = await env.admin();
    const legacy = await create(admin, oldClientBody('红烧肉', '  家常 下饭 '));
    expect(legacy.body.data.sections).toEqual(['家常 下饭']);
    expect(legacy.body.data.category).toBe('家常 下饭');
    const blank = await create(admin, oldClientBody('白粥', ''));
    expect(blank.body.data.sections).toEqual([]);
    const both = await create(admin, { ...oldClientBody('清蒸鱼', '家常'), sections: [] });
    expect(both.body.data.sections).toEqual([]);
    const wins = await create(admin, { ...oldClientBody('汤面', '家常'), sections: ['饭面简餐'] });
    expect(wins.body.data.sections).toEqual(['饭面简餐']);
  });

  it('keeps the photo and recipe link flow working alongside the new fields', async () => {
    const admin = await env.admin();
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e85d3f' } }).png().toBuffer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'dish.png');
    const uploaded = await admin.request('POST', '/bistro/api/admin/media', { body: form });
    expect(uploaded.status).toBe(201);
    const imageAssetId = uploaded.body.data.id as string;

    const dish = (await create(admin, { ...FULL, imageAssetId })).body.data;
    expect(dish).toMatchObject({ imageAssetId, recipeUrl: FULL.recipeUrl });
    const kept = await update(admin, dish.id, { ...oldClientBody(dish.name, '配饭菜'), imageAssetId });
    expect(kept.body.data).toMatchObject({ imageAssetId, recipeUrl: FULL.recipeUrl, sections: FULL.sections });
    const removed = await update(admin, dish.id, { ...FULL, imageAssetId: null, recipeUrl: null });
    expect(removed.body.data).toMatchObject({ imageAssetId: null, recipeUrl: null, ingredients: FULL.ingredients });
    const badRecipe = await update(admin, dish.id, { ...FULL, recipeUrl: 'javascript:alert(1)' });
    expect(badRecipe.body.error.details.field).toBe('recipeUrl');
  });

  it('returns 404 for an unknown dish before applying the body', async () => {
    const admin = await env.admin();
    const res = await update(admin, '00000000-0000-4000-8000-000000000999', { name: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('dish details: plan snapshots and isolation', () => {
  it('freezes every detail into a new plan; later catalog edits never change it', async () => {
    const admin = await env.admin();
    const guest = await env.guest();
    const dish = (await create(admin, FULL)).body.data;
    const plan = (await guest.post('/bistro/api/plans', homePlan([dish.id]), idem())).body.data;
    const frozen = {
      id: dish.id,
      name: FULL.name,
      category: '配饭菜',
      sections: FULL.sections,
      imageAssetId: null,
      tags: FULL.tags,
      description: FULL.description,
      recipeUrl: FULL.recipeUrl,
      ingredients: FULL.ingredients,
      totalMinutes: 50,
      activeMinutes: 20,
      servingText: FULL.servingText,
      shoppingNote: FULL.shoppingNote,
    };
    expect(plan.dishes).toEqual([frozen]);

    await update(admin, dish.id, {
      name: '改名了',
      sections: ['汤羹'],
      ingredients: [ing('牛肉')],
      totalMinutes: 5,
      activeMinutes: 5,
      servingText: '一人份',
      shoppingNote: '',
      recipeUrl: null,
    });
    await admin.patch(`${DISHES}/${dish.id}/active`, { active: false });
    expect((await guest.get(`/bistro/api/plans/${plan.id}`)).body.data.dishes).toEqual([frozen]);
    expect((await guest.get('/bistro/api/plans')).body.data[0].dishes).toEqual([frozen]);
  });

  it('keeps admin dish routes off the public listener and behind the Origin guard', async () => {
    const guest = await env.guest();
    for (const [method, body] of [
      ['GET', undefined],
      ['POST', FULL],
    ] as const) {
      const res = await guest.request(method, DISHES, { json: body });
      expect(res.status).toBe(404);
    }
    const admin = env.adminClient();
    const res = await admin.request('POST', DISHES, { json: FULL, origin: 'https://evil.test' });
    expect(res.status).toBe(403);
    expect(env.ctx.repos.catalog.listDishes(false)).toHaveLength(0);
  });
});
