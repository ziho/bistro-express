import { describe, expect, it } from 'vitest';
import { PANTRY_LIMITS } from '../shared/constants.js';
import {
  addToPantry,
  catalogIngredientNames,
  clearPantry,
  countPantryFilters,
  EMPTY_PANTRY,
  matchDishIngredients,
  matchesPantryFilter,
  pantryCandidates,
  pantryKeySet,
  pantryMatchKey,
  pantrySuggestions,
  rankByPantryMatch,
  readPantry,
  removeFromPantry,
  sameIngredient,
  serializePantry,
  splitPantryInput,
  splitShoppingByPantry,
  withinTotalMinutes,
  type Pantry,
} from '../shared/pantry.js';
import { deriveShopping } from '../shared/shopping.js';
import type { DishIngredient, ShoppingItem } from '../shared/types.js';

const NOW = new Date('2030-01-15T12:00:00Z');
const ing = (name: string, quantity = '', purchaseNote = ''): DishIngredient => ({ name, quantity, purchaseNote });
const pantryOf = (...names: string[]): Pantry => ({ names, updatedAt: NOW.toISOString() });

describe('ingredient matching keys', () => {
  it('matches exact names after whitespace and English-case normalization only', () => {
    expect(sameIngredient('  Egg ', 'egg')).toBe(true);
    expect(sameIngredient('小  葱', '小 葱')).toBe(true);
    expect(sameIngredient('鸡蛋', '鸡蛋 ')).toBe(true);
    expect(sameIngredient('', '')).toBe(false);
  });

  it('folds only the explicit synonym groups', () => {
    expect(sameIngredient('番茄', '西红柿')).toBe(true);
    expect(sameIngredient('土豆', '马铃薯')).toBe(true);
    expect(sameIngredient('西兰花', '青花菜')).toBe(true);
    expect(sameIngredient('卷心菜', '包菜')).toBe(true);
    expect(pantryMatchKey('西红柿')).toBe(pantryMatchKey('番茄'));
  });

  it('never merges variants by substring, fuzziness or category', () => {
    const separate: [string, string][] = [
      ['豆腐', '嫩豆腐'],
      ['嫩豆腐', '老豆腐'],
      ['豆腐', '豆腐皮'],
      ['牛肉', '肥牛'],
      ['牛肉', '牛肉末'],
      ['猪肉', '五花肉'],
      ['辣椒', '小米辣'],
      ['辣椒', '青椒'],
      ['干辣椒', '辣椒'],
      ['番茄', '番茄酱'],
      ['土豆', '土豆粉'],
      ['鸡蛋', '鸭蛋'],
      ['egg', 'eggs'],
    ];
    for (const [a, b] of separate) expect(sameIngredient(a, b), `${a} vs ${b}`).toBe(false);
  });
});

describe('matching a dish', () => {
  it('counts distinct recorded main ingredient kinds and keeps every original row', () => {
    const have = pantryKeySet(['西红柿', 'EGG']);
    const match = matchDishIngredients(
      [ing('番茄', '2颗', '要熟一点'), ing('egg', '3个'), ing('Egg', '1个', '土鸡蛋'), ing('小葱', '一把')],
      have,
    );
    expect(match.state).toBe('missing');
    expect(match.matched.map((k) => k.name)).toEqual(['番茄', 'egg']);
    expect(match.missing.map((k) => k.name)).toEqual(['小葱']);
    // Quantities and notes are carried untouched, never summed or parsed.
    expect(match.matched[1]!.rows).toEqual([ing('egg', '3个'), ing('Egg', '1个', '土鸡蛋')]);
    expect(match.matched[0]!.rows).toEqual([ing('番茄', '2颗', '要熟一点')]);
  });

  it('is ready only when every kind is on the list, and unknown without recorded ingredients', () => {
    const have = pantryKeySet(['鸡蛋', '番茄']);
    expect(matchDishIngredients([ing('番茄'), ing('鸡蛋')], have).state).toBe('ready');
    expect(matchDishIngredients([], have).state).toBe('unknown');
    expect(matchDishIngredients([ing('   ')], have).state).toBe('unknown');
  });

  it('never calls a dish ready against an empty list', () => {
    const empty = pantryKeySet([]);
    expect(matchDishIngredients([ing('番茄')], empty)).toMatchObject({ state: 'missing', matched: [] });
    expect(matchDishIngredients([], empty).state).toBe('unknown');
  });

  it('keeps 嫩豆腐 missing when only 豆腐 is at home', () => {
    const match = matchDishIngredients([ing('嫩豆腐', '一盒'), ing('牛肉末', '100g')], pantryKeySet(['豆腐', '牛肉']));
    expect(match.state).toBe('missing');
    expect(match.matched).toEqual([]);
    expect(match.missing.map((k) => k.name)).toEqual(['嫩豆腐', '牛肉末']);
  });
});

describe('filters and ranking', () => {
  const have = pantryKeySet(['番茄', '鸡蛋', '土豆']);
  const dishes = [
    { id: 'none', ingredients: [ing('牛肉'), ing('洋葱')] },
    { id: 'unknown', ingredients: [] },
    { id: 'miss2', ingredients: [ing('番茄'), ing('牛肉'), ing('洋葱')] },
    { id: 'ready', ingredients: [ing('西红柿'), ing('鸡蛋')] },
    { id: 'miss1-few', ingredients: [ing('番茄'), ing('葱')] },
    { id: 'miss1-more', ingredients: [ing('土豆'), ing('鸡蛋'), ing('葱')] },
    { id: 'ready2', ingredients: [ing('土豆')] },
  ];
  const matches = new Map(dishes.map((d) => [d.id, matchDishIngredients(d.ingredients, have)]));
  const matchOf = (d: { id: string }) => matches.get(d.id)!;

  it('ranks ready, then fewest missing, then most matched; zero hits and unknown last; stable', () => {
    expect(rankByPantryMatch(dishes, matchOf).map((d) => d.id)).toEqual([
      'ready',
      'ready2',
      'miss1-more',
      'miss1-few',
      'miss2',
      'none',
      'unknown',
    ]);
  });

  it('filters by state and exact missing count', () => {
    const ids = (filter: Parameters<typeof matchesPantryFilter>[1]) => dishes.filter((d) => matchesPantryFilter(matchOf(d), filter)).map((d) => d.id);
    expect(ids('ready')).toEqual(['ready', 'ready2']);
    expect(ids('missing1')).toEqual(['miss1-few', 'miss1-more']);
    expect(ids('missing2')).toEqual(['none', 'miss2']);
    expect(ids('unknown')).toEqual(['unknown']);
    expect(ids('all')).toHaveLength(dishes.length);
    expect(countPantryFilters(dishes.map(matchOf))).toEqual({ all: 7, ready: 2, missing1: 2, missing2: 2, unknown: 1 });
  });

  it('never lets an unknown total time pass a time limit', () => {
    expect(withinTotalMinutes(null, null)).toBe(true);
    expect(withinTotalMinutes(null, 30)).toBe(false);
    expect(withinTotalMinutes(0, 30)).toBe(true);
    expect(withinTotalMinutes(30, 30)).toBe(true);
    expect(withinTotalMinutes(31, 30)).toBe(false);
  });
});

describe('adding and removing names', () => {
  it('splits on commas, Chinese commas, 顿号, semicolons and line breaks', () => {
    expect(splitPantryInput('鸡蛋,番茄，土豆、 小 葱 ;牛肉；\r\n洋葱\n\n , ')).toEqual(['鸡蛋', '番茄', '土豆', '小 葱', '牛肉', '洋葱']);
  });

  it('adds new names in order, reports duplicates and keeps original spelling', () => {
    const first = addToPantry(EMPTY_PANTRY, 'Egg、西红柿', NOW);
    expect(first.added).toEqual(['Egg', '西红柿']);
    expect(first.pantry).toEqual({ names: ['Egg', '西红柿'], updatedAt: NOW.toISOString() });
    const again = addToPantry(first.pantry, 'egg\n番茄', new Date('2030-01-16T00:00:00Z'));
    // egg is the same name; 番茄 is a synonym but stays as its own entry (aliases never rename).
    expect(again.duplicates).toEqual(['egg']);
    expect(again.added).toEqual(['番茄']);
    expect(again.pantry.names).toEqual(['Egg', '西红柿', '番茄']);
  });

  it('refuses over-long names and names beyond the limit instead of cutting them', () => {
    const long = 'x'.repeat(PANTRY_LIMITS.name + 1);
    const result = addToPantry(EMPTY_PANTRY, `鸡蛋\n${long}`, NOW);
    expect(result.added).toEqual(['鸡蛋']);
    expect(result.rejected).toEqual([{ value: long, reason: 'too_long' }]);
    expect(addToPantry(EMPTY_PANTRY, 'x'.repeat(PANTRY_LIMITS.name), NOW).added).toHaveLength(1);

    const almostFull = pantryOf(...Array.from({ length: PANTRY_LIMITS.names - 1 }, (_, i) => `食材${i}`));
    const over = addToPantry(almostFull, '甲、乙、丙', NOW);
    expect(over.added).toEqual(['甲']);
    expect(over.rejected).toEqual([
      { value: '乙', reason: 'full' },
      { value: '丙', reason: 'full' },
    ]);
    expect(over.pantry.names).toHaveLength(PANTRY_LIMITS.names);
  });

  it('refuses an oversized paste whole and leaves the list untouched', () => {
    const text = '鸡蛋,'.repeat(PANTRY_LIMITS.pasteChars);
    const result = addToPantry(EMPTY_PANTRY, text, NOW);
    expect(result.pantry).toBe(EMPTY_PANTRY);
    expect(result.rejected).toEqual([{ value: text, reason: 'paste_too_long' }]);
  });

  it('does not touch updatedAt when nothing was added or removed', () => {
    const pantry = pantryOf('鸡蛋');
    expect(addToPantry(pantry, '鸡蛋', new Date('2031-01-01T00:00:00Z')).pantry).toBe(pantry);
    expect(removeFromPantry(pantry, '牛肉', new Date('2031-01-01T00:00:00Z'))).toBe(pantry);
    expect(removeFromPantry(pantry, ' 鸡蛋 ', NOW).names).toEqual([]);
    expect(clearPantry(NOW)).toEqual({ names: [], updatedAt: NOW.toISOString() });
  });
});

describe('stored list validation', () => {
  it('round-trips a valid list', () => {
    const pantry = pantryOf('鸡蛋', 'Egg Noodles');
    expect(readPantry(serializePantry(pantry))).toEqual({ status: 'ok', pantry });
    expect(readPantry(null)).toEqual({ status: 'empty', pantry: EMPTY_PANTRY });
  });

  it('treats anything unexpected as corrupt rather than half-reading it', () => {
    const valid = { v: 1, names: ['鸡蛋'], updatedAt: NOW.toISOString() };
    const corrupt = [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ ...valid, v: 2 }),
      JSON.stringify({ ...valid, names: '鸡蛋' }),
      JSON.stringify({ ...valid, names: [1] }),
      JSON.stringify({ ...valid, names: [''] }),
      JSON.stringify({ ...valid, names: [' 鸡蛋'] }),
      JSON.stringify({ ...valid, names: ['鸡蛋', 'Egg', 'egg'] }),
      JSON.stringify({ ...valid, names: ['x'.repeat(PANTRY_LIMITS.name + 1)] }),
      JSON.stringify({ ...valid, names: Array.from({ length: PANTRY_LIMITS.names + 1 }, (_, i) => `n${i}`) }),
      JSON.stringify({ ...valid, updatedAt: 'yesterday' }),
      JSON.stringify({ v: 1, names: ['鸡蛋'] }),
    ];
    for (const raw of corrupt) {
      const read = readPantry(raw);
      expect(read.status, raw.slice(0, 60)).toBe('corrupt');
      expect(read.pantry.names).toEqual([]);
    }
  });
});

describe('suggestions', () => {
  const dishes = [
    { ingredients: [ing('番茄', '2颗'), ing('鸡蛋')] },
    { ingredients: [ing('番茄 '), ing('鸡腿'), ing('Egg')] },
  ];

  it('offers distinct catalog names for the part being typed, never ones already on the list', () => {
    const names = catalogIngredientNames(dishes);
    expect(names).toEqual(['番茄', '鸡蛋', '鸡腿', 'Egg']);
    expect(pantrySuggestions(names, '番茄、鸡', EMPTY_PANTRY)).toEqual(['鸡蛋', '鸡腿']);
    expect(pantrySuggestions(names, '鸡', pantryOf('鸡蛋'))).toEqual(['鸡腿']);
    expect(pantrySuggestions(names, 'eg', EMPTY_PANTRY)).toEqual(['Egg']);
    expect(pantrySuggestions(names, '番茄，', EMPTY_PANTRY)).toEqual([]);
  });
});

describe('shopping hints', () => {
  it('splits preview groups without changing grouping, keys or quantities', () => {
    const { groups } = deriveShopping([
      { id: 'a', name: '番茄炒蛋', shoppingNote: '', ingredients: [ing('番茄', '2颗'), ing('鸡蛋', '2颗')] },
      { id: 'b', name: '西红柿汤', shoppingNote: '', ingredients: [ing('西红柿', '1颗'), ing('嫩豆腐', '半盒')] },
    ]);
    // Existing rule: synonyms stay separate shopping items.
    expect(groups.map((g) => g.key)).toEqual(['番茄', '鸡蛋', '西红柿', '嫩豆腐']);
    const { maybeHave, need } = splitShoppingByPantry(groups, pantryKeySet(['番茄', '豆腐']));
    expect(maybeHave.map((g) => g.key)).toEqual(['番茄', '西红柿']);
    expect(need.map((g) => g.key)).toEqual(['鸡蛋', '嫩豆腐']);
    expect(maybeHave[1]).toBe(groups[2]);
    expect(maybeHave[1]!.sources[0]).toMatchObject({ name: '西红柿', quantity: '1颗' });
  });

  it('suggests only pending saved items', () => {
    const item = (key: string, status: ShoppingItem['status']): ShoppingItem => ({ key, name: key, sources: [], status, needsReview: false });
    const items = [item('番茄', 'pending'), item('鸡蛋', 'bought'), item('西红柿', 'have'), item('小葱', 'pending')];
    expect(pantryCandidates(items, pantryKeySet(['西红柿', '鸡蛋'])).map((i) => i.key)).toEqual(['番茄']);
    expect(pantryCandidates(items, pantryKeySet([]))).toEqual([]);
  });
});
