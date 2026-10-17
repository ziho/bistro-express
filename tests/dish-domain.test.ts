import { describe, expect, it } from 'vitest';
import { DISH_LIMITS } from '../shared/constants.js';
import {
  dishFactsText,
  dishIngredientLine,
  dishSearchFields,
  dishTimeError,
  formatMinutes,
  hasDishExtras,
  legacySections,
  normalizeSections,
  orderSections,
  readDishSnapshot,
  readDishSnapshots,
  readStoredIngredients,
  safeRecipeUrl,
  snapshotOfDish,
} from '../shared/dish.js';
import type { Dish } from '../shared/types.js';
import { mergeLegacyCategory } from '../server/lib/dishValidation.js';
import {
  collectDishDetails,
  collectIngredients,
  newIngredientRow,
  parseMinutesInput,
  toDishFormState,
  toIngredientRows,
} from '../web/src/lib/dishForm.js';
import { dishSectionOptions, filterDishes } from '../web/src/lib/dishes.js';

const dish = (id: string, patch: Partial<Dish> = {}): Dish => ({
  id,
  name: id,
  imageAssetId: null,
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
  active: true,
  createdAt: '',
  updatedAt: '',
  ...patch,
});

describe('section normalizers', () => {
  it('trims, collapses spaces, drops blanks and duplicates, keeps order', () => {
    expect(normalizeSections([' 汤羹 ', '配饭菜', '汤羹', '  ', '小食\n甜品'])).toEqual(['汤羹', '配饭菜', '小食 甜品']);
  });

  it('turns a legacy category into one unsplit section', () => {
    expect(legacySections('  家常 下饭 ')).toEqual(['家常 下饭']);
    expect(legacySections('   ')).toEqual([]);
    expect(legacySections(undefined)).toEqual([]);
  });

  it('orders suggested sections first, then others', () => {
    expect(orderSections(['家常', '汤羹', '配饭菜', '早餐'])).toEqual(['配饭菜', '汤羹', '家常', '早餐']);
  });

  it('merges an older client category without wiping other sections', () => {
    expect(mergeLegacyCategory(['配饭菜', '汤羹'], '')).toEqual(['配饭菜', '汤羹']);
    expect(mergeLegacyCategory(['配饭菜', '汤羹'], '汤羹')).toEqual(['配饭菜', '汤羹']);
    expect(mergeLegacyCategory(['配饭菜', '汤羹'], '家常')).toEqual(['家常', '汤羹']);
    expect(mergeLegacyCategory([], '家常')).toEqual(['家常']);
    expect(mergeLegacyCategory([], '')).toEqual([]);
  });
});

describe('stored data readers', () => {
  it('reads ingredients of any quality', () => {
    expect(readStoredIngredients('nope')).toEqual([]);
    expect(
      readStoredIngredients([null, 3, { name: '' }, { name: ' 鸡腿 ', quantity: 5 }, { name: '土豆', quantity: '两个', purchaseNote: '黄心' }]),
    ).toEqual([
      { name: '鸡腿', quantity: '', purchaseNote: '' },
      { name: '土豆', quantity: '两个', purchaseNote: '黄心' },
    ]);
  });

  it('reads an old snapshot with empty defaults and its category as the one section', () => {
    const old = { id: 'd1', name: '番茄炒蛋', category: '家常', imageAssetId: null };
    const copy = structuredClone(old);
    expect(readDishSnapshot(old)).toEqual({
      id: 'd1',
      name: '番茄炒蛋',
      category: '家常',
      sections: ['家常'],
      imageAssetId: null,
      tags: [],
      description: '',
      recipeUrl: null,
      ingredients: [],
      totalMinutes: null,
      activeMinutes: null,
      servingText: '',
      shoppingNote: '',
    });
    expect(old).toEqual(copy); // the input is not modified
  });

  it('prefers explicit sections over a stale category and drops invalid minutes', () => {
    const s = readDishSnapshot({ id: 'd', name: 'x', category: '家常', sections: [], totalMinutes: -5, activeMinutes: 0 });
    expect(s).toMatchObject({ sections: [], category: '', totalMinutes: null, activeMinutes: 0 });
    expect(readDishSnapshots([null, 'x', { id: 'a', name: 'A' }])).toHaveLength(1);
    expect(readDishSnapshots('not an array')).toEqual([]);
  });

  it('snapshots are deep copies', () => {
    const d = dish('d1', { sections: ['汤羹'], ingredients: [{ name: '排骨', quantity: '', purchaseNote: '' }], tags: ['暖'] });
    const snap = snapshotOfDish(d);
    d.sections.push('改');
    d.ingredients[0]!.name = '改';
    d.tags.push('改');
    expect(snap).toMatchObject({ sections: ['汤羹'], ingredients: [{ name: '排骨' }], tags: ['暖'], category: '汤羹' });
  });
});

describe('display helpers', () => {
  it('formats minutes, time and serving', () => {
    expect(formatMinutes(0)).toBe('0 分钟');
    expect(formatMinutes(45)).toBe('45 分钟');
    expect(formatMinutes(60)).toBe('1 小时');
    expect(formatMinutes(90)).toBe('1 小时 30 分钟');
    expect(dishFactsText({ totalMinutes: 40, activeMinutes: 15, servingText: '一人份' })).toBe('共 40 分钟 · 动手 15 分钟 · 一人份');
    expect(dishFactsText({ totalMinutes: null, activeMinutes: 0, servingText: '' })).toBe('动手 0 分钟');
    expect(dishFactsText({ totalMinutes: null, activeMinutes: null, servingText: '' })).toBe('');
  });

  it('shortens the ingredient line', () => {
    const rows = ['鸡腿', '土豆', '青椒', '洋葱', '姜'].map((name) => ({ name, quantity: '', purchaseNote: '' }));
    expect(dishIngredientLine(rows)).toBe('鸡腿、土豆、青椒、洋葱 等 5 样');
    expect(dishIngredientLine(rows.slice(0, 2))).toBe('鸡腿、土豆');
    expect(dishIngredientLine([])).toBe('');
  });

  it('checks time order and recipe link safety', () => {
    expect(dishTimeError(10, 11)).toBeTruthy();
    expect(dishTimeError(10, 10)).toBeNull();
    expect(dishTimeError(null, 30)).toBeNull();
    expect(safeRecipeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeRecipeUrl('https://user:pw@example.com/')).toBeNull();
    expect(safeRecipeUrl(null)).toBeNull();
  });

  it('only reports extra details when there is more than the summary line', () => {
    expect(hasDishExtras(dish('a', { totalMinutes: 10, servingText: '一盘', sections: ['汤羹'] }))).toBe(false);
    expect(hasDishExtras(dish('a', { shoppingNote: '买嫩豆腐' }))).toBe(true);
    expect(hasDishExtras(dish('a', { recipeUrl: 'javascript:alert(1)' }))).toBe(false);
  });
});

describe('dish filtering', () => {
  const dishes = [
    dish('土豆烧鸡', { sections: ['配饭菜', '饭面简餐'], ingredients: [{ name: '鸡腿', quantity: '', purchaseNote: '去骨' }] }),
    dish('紫菜蛋花汤', { sections: ['汤羹'], tags: ['快手'] }),
    dish('白粥', { description: '清淡' }),
    dish('家常豆腐', { sections: ['家常'] }),
  ];
  const none = new Set<string>();
  const names = (list: Dish[]) => list.map((d) => d.name);
  const filter = (patch: Partial<{ q: string; group: string; tag: string; onlySelected: boolean }>, selected = none) =>
    names(filterDishes(dishes, { q: '', group: '', tag: '', onlySelected: false, ...patch }, selected));

  it('finds a dish under each of its sections (array membership)', () => {
    expect(filter({ group: '配饭菜' })).toEqual(['土豆烧鸡']);
    expect(filter({ group: '饭面简餐' })).toEqual(['土豆烧鸡']);
    expect(filter({ group: '家常' })).toEqual(['家常豆腐']);
  });

  it('includes unclassified dishes by default and searches sections, ingredients and notes', () => {
    expect(filter({})).toHaveLength(4);
    expect(filter({ q: '饭面' })).toEqual(['土豆烧鸡']);
    expect(filter({ q: '鸡腿' })).toEqual(['土豆烧鸡']);
    expect(filter({ q: '去骨' })).toEqual(['土豆烧鸡']);
    expect(filter({ q: '清淡' })).toEqual(['白粥']);
    expect(filter({ q: '汤' })).toEqual(['紫菜蛋花汤']);
  });

  it('keeps tag and "selected" filters', () => {
    expect(filter({ tag: '快手' })).toEqual(['紫菜蛋花汤']);
    expect(filter({ onlySelected: true }, new Set(['白粥']))).toEqual(['白粥']);
    expect(filter({ group: '汤羹', tag: '快手', q: '紫菜' })).toEqual(['紫菜蛋花汤']);
  });

  it('offers only sections that dishes use, suggested ones first', () => {
    expect(dishSectionOptions(dishes)).toEqual(['配饭菜', '饭面简餐', '汤羹', '家常']);
    expect(dishSectionOptions([])).toEqual([]);
    expect(dishSearchFields(dishes[0]!)).toEqual(expect.arrayContaining(['配饭菜', '饭面简餐', '鸡腿', '去骨']));
  });
});

describe('admin dish form helpers', () => {
  it('starts with one blank ingredient row and stable keys', () => {
    const rows = toIngredientRows([]);
    expect(rows).toHaveLength(1);
    const again = toIngredientRows([{ name: '鸡蛋', quantity: '3个', purchaseNote: '' }]);
    expect(again[0]!.key).not.toBe(rows[0]!.key);
    expect(again[0]).toMatchObject({ name: '鸡蛋', quantity: '3个' });
  });

  it('collects ingredients like the server: trims, drops blank rows, flags orphan metadata', () => {
    const ok = newIngredientRow({ name: ' 鸡腿 ', quantity: ' 约300g ', purchaseNote: '' });
    const blank = newIngredientRow({ name: ' ', quantity: '', purchaseNote: '  ' });
    const orphan = newIngredientRow({ name: '', quantity: '半盒', purchaseNote: '' });
    const long = newIngredientRow({ name: '鸡'.repeat(DISH_LIMITS.ingredientName + 1), quantity: '', purchaseNote: '' });
    const { ingredients, errors } = collectIngredients([ok, blank, orphan, long]);
    expect(ingredients).toEqual([{ name: '鸡腿', quantity: '约300g', purchaseNote: '' }]);
    expect(Object.keys(errors)).toEqual([orphan.key, long.key]);
    expect(errors[orphan.key]!.name).toContain('主料名称');
  });

  it('parses minute fields: blank, zero, full-width digits and errors', () => {
    expect(parseMinutesInput('', '总耗时')).toEqual({ value: null, error: null });
    expect(parseMinutesInput(' 0 ', '总耗时')).toEqual({ value: 0, error: null });
    expect(parseMinutesInput('３０', '总耗时')).toEqual({ value: 30, error: null });
    expect(parseMinutesInput('1441', '总耗时').error).toBeTruthy();
    expect(parseMinutesInput('12.5', '总耗时').error).toBeTruthy();
    expect(parseMinutesInput('-1', '总耗时').error).toBeTruthy();
    expect(parseMinutesInput('半小时', '总耗时').error).toBeTruthy();
  });

  it('collects every detail field so cleared values are sent as empty', () => {
    const state = toDishFormState(
      dish('x', {
        sections: ['汤羹'],
        ingredients: [{ name: '排骨', quantity: '', purchaseNote: '' }],
        totalMinutes: 0,
        servingText: '一锅',
      }),
    );
    expect(state).toMatchObject({ totalMinutes: '0', activeMinutes: '', servingText: '一锅' });
    const cleared = collectDishDetails({ ...state, sections: [], ingredientRows: [newIngredientRow()], totalMinutes: '', servingText: ' ' });
    expect(cleared.errors).toEqual({});
    expect(cleared.details).toEqual({
      sections: [],
      ingredients: [],
      totalMinutes: null,
      activeMinutes: null,
      servingText: '',
      shoppingNote: '',
    });
    const bad = collectDishDetails({ ...state, totalMinutes: '10', activeMinutes: '20' });
    expect(bad.errors.activeMinutes).toBe('动手时间不能超过总耗时');
  });
});
