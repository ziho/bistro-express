import { describe, expect, it } from 'vitest';
import {
  applyShoppingStates,
  countShopping,
  deriveShopping,
  manualItemErrors,
  readStoredManualItems,
  readStoredShoppingStates,
  reconcileShoppingStates,
  shoppingKey,
  withShoppingStatus,
  type ShoppingDishInput,
  type ShoppingStateEntry,
} from '../shared/shopping.js';

const row = (name: string, quantity = '', purchaseNote = '') => ({ name, quantity, purchaseNote });
const dish = (id: string, name: string, ingredients: ReturnType<typeof row>[], shoppingNote = ''): ShoppingDishInput => ({
  id,
  name,
  ingredients,
  shoppingNote,
});
const manual = (id: string, name: string, quantity = '', note = '') => ({ id, name, quantity, note });

const sigOf = (dishes: ShoppingDishInput[], m: ReturnType<typeof manual>[] = [], key: string) =>
  deriveShopping(dishes, m).groups.find((g) => g.key === key)?.signature;

describe('shopping keys and grouping', () => {
  it('only trims, collapses whitespace and ignores English case', () => {
    expect(shoppingKey('  Green   Onion ')).toBe('green onion');
    expect(shoppingKey('TOFU')).toBe(shoppingKey('tofu'));
    expect(shoppingKey('番茄')).not.toBe(shoppingKey('西红柿'));
    expect(shoppingKey('嫩豆腐')).not.toBe(shoppingKey('老豆腐'));
    expect(shoppingKey('鸡蛋（土）')).not.toBe(shoppingKey('鸡蛋'));
    expect(shoppingKey('   ')).toBe('');
  });

  it('groups by first appearance and keeps every source quantity and purchase note', () => {
    const { groups } = deriveShopping([
      dish('d1', '番茄炒蛋', [row('番茄', '2颗', '要熟一点'), row('鸡蛋', '2颗')]),
      dish('d2', '西红柿蛋汤', [row('西红柿', '1颗'), row('Egg', '1个'), row(' 鸡蛋 ', '2颗', '土鸡蛋')]),
      dish('d3', 'Tofu Soup', [row('egg', '半个'), row('嫩豆腐', '1盒'), row('老豆腐', '1块')]),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['番茄', '鸡蛋', '西红柿', 'Egg', '嫩豆腐', '老豆腐']);
    const egg = groups.find((g) => g.key === '鸡蛋')!;
    // Two identical "2颗" requirements stay two sources; nothing is summed or de-duplicated.
    expect(egg.sources).toEqual([
      { kind: 'dish', dishId: 'd1', dishName: '番茄炒蛋', name: '鸡蛋', quantity: '2颗', purchaseNote: '' },
      { kind: 'dish', dishId: 'd2', dishName: '西红柿蛋汤', name: '鸡蛋', quantity: '2颗', purchaseNote: '土鸡蛋' },
    ]);
    const english = groups.find((g) => g.key === 'egg')!;
    expect(english.sources.map((s) => [s.name, s.quantity])).toEqual([
      ['Egg', '1个'],
      ['egg', '半个'],
    ]);
  });

  it('keeps differing free-text units side by side without conversion', () => {
    const { groups } = deriveShopping([
      dish('a', 'A', [row('牛肉', '约300g')]),
      dish('b', 'B', [row('牛肉', '半斤')]),
      dish('c', 'C', [row('牛肉', '适量')]),
      dish('d', 'D', [row('牛肉')]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sources.map((s) => s.quantity)).toEqual(['约300g', '半斤', '适量', '']);
  });

  it('lists dish notes separately and names dishes without main ingredients', () => {
    const derived = deriveShopping([
      dish('a', '番茄炒蛋', [row('番茄')], '番茄挑软一点'),
      dish('b', '白粥', []),
      dish('c', '凉拌菜', [], '看市场有什么新鲜的'),
      dish('d', '空行', [row('   ')]),
    ]);
    expect(derived.dishNotes).toEqual([
      { dishId: 'a', dishName: '番茄炒蛋', note: '番茄挑软一点' },
      { dishId: 'c', dishName: '凉拌菜', note: '看市场有什么新鲜的' },
    ]);
    expect(derived.dishesWithoutIngredients).toEqual(['白粥', '凉拌菜', '空行']);
    expect(derived.groups.map((g) => g.key)).toEqual(['番茄']);
    // A note is never turned into a grocery entry or a status.
    expect(deriveShopping([dish('c', '凉拌菜', [], '家里有葱')]).groups).toEqual([]);
  });

  it('groups name-only manual items with recipe sources and keeps the manual source identified', () => {
    const { groups } = deriveShopping([dish('a', '葱油面', [row('小葱', '一把')])], [manual('m1', ' 小葱 '), manual('m2', '可乐', '2瓶', '无糖')]);
    expect(groups.map((g) => g.key)).toEqual(['小葱', '可乐']);
    expect(groups[0]!.sources).toEqual([
      { kind: 'dish', dishId: 'a', dishName: '葱油面', name: '小葱', quantity: '一把', purchaseNote: '' },
      { kind: 'manual', manualId: 'm1', name: '小葱', quantity: '', note: '' },
    ]);
    expect(groups[1]!.sources[0]).toMatchObject({ kind: 'manual', quantity: '2瓶', note: '无糖' });
  });
});

describe('requirement signatures', () => {
  const base = [dish('a', '番茄炒蛋', [row('番茄', '2颗'), row('鸡蛋', '3个')]), dish('b', '蛋汤', [row('鸡蛋', '2个')])];

  it('ignores dish order, ingredient order, display case/space and dish renames', () => {
    const egg = sigOf(base, [], '鸡蛋');
    expect(sigOf([...base].reverse(), [], '鸡蛋')).toBe(egg);
    expect(sigOf([dish('a', '番茄炒蛋', [row('鸡蛋', '3个'), row('番茄', '2颗')]), base[1]!], [], '鸡蛋')).toBe(egg);
    expect(sigOf([dish('a', '改名了', [row('番茄', '2颗'), row(' 鸡蛋 ', '3个')]), base[1]!], [], '鸡蛋')).toBe(egg);
    const en = sigOf([dish('a', 'A', [row('Egg', '1')])], [], 'egg');
    expect(sigOf([dish('a', 'A', [row('egg', '1')])], [], 'egg')).toBe(en);
  });

  it('changes with quantity, purchase note, the dish shopping note, sources and manual items', () => {
    const egg = sigOf(base, [], '鸡蛋');
    expect(sigOf([dish('a', '番茄炒蛋', [row('鸡蛋', '4个')]), base[1]!], [], '鸡蛋')).not.toBe(egg);
    expect(sigOf([dish('a', '番茄炒蛋', [row('鸡蛋', '3个', '土鸡蛋')]), base[1]!], [], '鸡蛋')).not.toBe(egg);
    expect(sigOf([dish('a', '番茄炒蛋', [row('鸡蛋', '3个')], '去菜场买'), base[1]!], [], '鸡蛋')).not.toBe(egg);
    expect(sigOf([base[0]!], [], '鸡蛋')).not.toBe(egg);
    expect(sigOf(base, [manual('m1', '鸡蛋')], '鸡蛋')).not.toBe(egg);
    expect(sigOf(base, [manual('m1', '鸡蛋', '6个')], '鸡蛋')).not.toBe(sigOf(base, [manual('m1', '鸡蛋')], '鸡蛋'));
  });

  it('keeps duplicate occurrences and distinct manual ids apart', () => {
    const once = sigOf([dish('a', 'A', [row('葱', '1根')])], [], '葱');
    const twice = sigOf([dish('a', 'A', [row('葱', '1根'), row('葱', '1根')])], [], '葱');
    expect(twice).not.toBe(once);
    const oneManual = sigOf([], [manual('m1', '葱', '1根')], '葱');
    const twoManual = sigOf([], [manual('m1', '葱', '1根'), manual('m2', '葱', '1根')], '葱');
    expect(twoManual).not.toBe(oneManual);
    expect(sigOf([], [manual('m2', '葱', '1根')], '葱')).not.toBe(oneManual);
  });
});

describe('status reconciliation', () => {
  const entry = (key: string, status: ShoppingStateEntry['status'], signature: string, needsReview = false) => ({
    key,
    status,
    signature,
    needsReview,
  });

  it('sets explicit statuses, reversibly, and confirming clears review', () => {
    const group = { key: '鸡蛋', signature: 's1' };
    let states = withShoppingStatus([], group, 'have');
    expect(states).toEqual([entry('鸡蛋', 'have', 's1')]);
    states = withShoppingStatus(states, group, 'bought');
    expect(states).toEqual([entry('鸡蛋', 'bought', 's1')]);
    states = withShoppingStatus(states, group, 'pending');
    expect(states).toEqual([]);
    expect(withShoppingStatus([entry('鸡蛋', 'pending', 's1', true)], group, 'pending')).toEqual([]);
  });

  it('keeps unchanged groups, resets changed ones for review and drops removed ones', () => {
    const states = [entry('a', 'have', 's1'), entry('b', 'bought', 's2'), entry('c', 'have', 's3'), entry('d', 'pending', 's4', true)];
    const result = reconcileShoppingStates(states, [
      { key: 'a', signature: 's1' },
      { key: 'b', signature: 'changed' },
      { key: 'd', signature: 'changed-too' },
    ]);
    expect(result).toEqual([entry('a', 'have', 's1'), entry('b', 'pending', 'changed', true), entry('d', 'pending', 'changed-too', true)]);
    // Re-adding a removed group never brings back its old status.
    const readded = reconcileShoppingStates(result, [{ key: 'c', signature: 's3' }]);
    expect(readded).toEqual([]);
    expect(applyShoppingStates([{ key: 'c', name: 'c', sources: [], signature: 's3' }], readded)[0]).toMatchObject({
      status: 'pending',
      needsReview: false,
    });
  });

  it('counts by distinct group', () => {
    expect(countShopping([{ status: 'pending' }, { status: 'have' }, { status: 'have' }, { status: 'bought' }])).toEqual({
      pending: 1,
      have: 2,
      bought: 1,
    });
  });

  it('reads stored rows of any quality', () => {
    expect(readStoredShoppingStates([entry('a', 'have', 's'), { key: 'b', status: 'eaten', signature: 's' }, null, 'x'])).toEqual([
      entry('a', 'have', 's'),
    ]);
    expect(readStoredShoppingStates({})).toEqual([]);
    expect(readStoredManualItems([{ id: 'm1', name: ' 可乐 ' }, { id: 'm1', name: '重复' }, { name: '无编号' }, 5])).toEqual([
      { id: 'm1', name: '可乐', quantity: '', note: '', createdAt: '', updatedAt: '' },
    ]);
  });
});

describe('manual item validation', () => {
  it('requires a name and rejects over-long fields without truncating', () => {
    expect(manualItemErrors({ name: '可乐', quantity: '', note: '' })).toEqual({});
    expect(manualItemErrors({ name: '   ', quantity: '2瓶', note: '' })).toEqual({ name: '请填写要买的东西' });
    expect(manualItemErrors({ name: 'x'.repeat(41), quantity: 'y'.repeat(61), note: 'z'.repeat(161) })).toEqual({
      name: '名称不能超过 40 个字',
      quantity: '数量不能超过 60 个字',
      note: '备注不能超过 160 个字',
    });
    // Measured after collapsing whitespace, exactly like the server.
    expect(manualItemErrors({ name: `${'x'.repeat(20)}    ${'x'.repeat(19)}`, quantity: '', note: '' })).toEqual({});
  });
});
