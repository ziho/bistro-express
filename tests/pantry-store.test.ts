import { describe, expect, it } from 'vitest';
import { PANTRY_STORAGE_KEY, pantryKeySet, serializePantry } from '../shared/pantry.js';
import type { Dish } from '../shared/types.js';
import { applyPantryFinder, pantryMatchLabel } from '../web/src/lib/pantryFinder.js';
import { createPantryStore } from '../web/src/lib/pantryStore.js';

/** Minimal Storage shared by two "tabs"; `failWrites` / `failReads` simulate blocked or full storage. */
class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    if (this.failReads) throw new Error('SecurityError');
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
}

const clock = () => new Date('2030-01-15T12:00:00Z');

describe('pantry store', () => {
  it('persists changes and notifies subscribers in the same window immediately', () => {
    const storage = new MemoryStorage();
    const store = createPantryStore({ storage: () => storage, now: clock });
    let calls = 0;
    const unsubscribe = store.subscribe(() => (calls += 1));
    expect(store.getSnapshot()).toMatchObject({ storage: 'ok', pantry: { names: [] } });

    const before = store.getSnapshot();
    store.add('鸡蛋、番茄');
    expect(calls).toBe(1);
    // A new immutable snapshot, never a mutated one.
    expect(store.getSnapshot()).not.toBe(before);
    expect(before.pantry.names).toEqual([]);
    expect(JSON.parse(storage.data.get(PANTRY_STORAGE_KEY)!)).toEqual({ v: 1, names: ['鸡蛋', '番茄'], updatedAt: '2030-01-15T12:00:00.000Z' });

    store.remove('鸡蛋');
    // Blank input changes nothing, so nobody is notified.
    store.add('  ，  ');
    expect(calls).toBe(2);
    unsubscribe();
    store.clear();
    expect(calls).toBe(2);
    expect(store.getSnapshot().pantry.names).toEqual([]);
  });

  it('picks up changes made in another tab through the storage event', () => {
    const storage = new MemoryStorage();
    const tabA = createPantryStore({ storage: () => storage, now: clock });
    const tabB = createPantryStore({ storage: () => storage, now: clock });
    let notified = 0;
    tabB.subscribe(() => (notified += 1));
    tabA.add('土豆');
    tabB.handleStorageEvent('some-other-key');
    expect(notified).toBe(0);
    tabB.handleStorageEvent(PANTRY_STORAGE_KEY);
    expect(tabB.getSnapshot().pantry.names).toEqual(['土豆']);
    storage.clear();
    tabB.handleStorageEvent(null);
    expect(tabB.getSnapshot().pantry.names).toEqual([]);
    expect(notified).toBe(2);
  });

  it('keeps working in memory when storage is blocked or full, and says so', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const store = createPantryStore({ storage: () => storage, now: clock });
    const result = store.add('鸡蛋');
    expect(result.added).toEqual(['鸡蛋']);
    expect(store.getSnapshot()).toMatchObject({ storage: 'blocked', pantry: { names: ['鸡蛋'] } });

    // A read failure in another-tab sync does not wipe the in-memory list.
    storage.failReads = true;
    store.handleStorageEvent(PANTRY_STORAGE_KEY);
    expect(store.getSnapshot().pantry.names).toEqual(['鸡蛋']);

    const noStorage = createPantryStore({ storage: () => null, now: clock });
    expect(noStorage.getSnapshot().storage).toBe('blocked');
    noStorage.add('番茄');
    expect(noStorage.getSnapshot()).toMatchObject({ storage: 'blocked', pantry: { names: ['番茄'] } });
    noStorage.reset();
    expect(noStorage.getSnapshot().pantry.names).toEqual([]);
  });

  it('shows corrupt data as an empty list until the next change overwrites it', () => {
    const storage = new MemoryStorage();
    storage.data.set(PANTRY_STORAGE_KEY, '{"v":1,"names":[42],"updatedAt":"2030-01-01T00:00:00Z"}');
    const store = createPantryStore({ storage: () => storage, now: clock });
    expect(store.getSnapshot()).toMatchObject({ storage: 'corrupt', pantry: { names: [] } });
    // Reading never rewrites storage.
    expect(storage.data.get(PANTRY_STORAGE_KEY)).toContain('[42]');
    store.add('鸡蛋');
    expect(store.getSnapshot()).toMatchObject({ storage: 'ok', pantry: { names: ['鸡蛋'] } });
    expect(storage.data.get(PANTRY_STORAGE_KEY)).toBe(serializePantry(store.getSnapshot().pantry));
  });
});

const dish = (id: string, ingredients: string[], totalMinutes: number | null = null): Dish => ({
  id,
  name: id,
  imageAssetId: null,
  category: '',
  sections: [],
  tags: [],
  description: '',
  recipeUrl: null,
  active: true,
  createdAt: '',
  updatedAt: '',
  ingredients: ingredients.map((name) => ({ name, quantity: '', purchaseNote: '' })),
  totalMinutes,
  activeMinutes: null,
  servingText: '',
  shoppingNote: '',
});

describe('pantry finder over already-filtered dishes', () => {
  const dishes = [dish('牛肉面', ['牛肉', '面条'], 40), dish('番茄炒蛋', ['西红柿', '鸡蛋'], 15), dish('白粥', [], 60), dish('炒土豆丝', ['土豆'])];
  const have = pantryKeySet(['番茄', '鸡蛋', '土豆']);

  it('ranks and counts only the dishes it is given', () => {
    const result = applyPantryFinder(dishes, have, 'all', null);
    expect(result.visible.map((d) => d.id)).toEqual(['番茄炒蛋', '炒土豆丝', '牛肉面', '白粥']);
    expect(result.counts).toEqual({ all: 4, ready: 2, missing1: 0, missing2: 1, unknown: 1 });
    expect(pantryMatchLabel(result.matches.get('牛肉面')!)).toBe('还缺 2 种');
    expect(applyPantryFinder(dishes.slice(0, 1), have, 'all', null).visible).toHaveLength(1);
  });

  it('drops dishes without a recorded time from a time limit, including ready ones', () => {
    const result = applyPantryFinder(dishes, have, 'ready', 30);
    expect(result.visible.map((d) => d.id)).toEqual(['番茄炒蛋']);
    expect(result.counts).toEqual({ all: 1, ready: 1, missing1: 0, missing2: 0, unknown: 0 });
    expect(applyPantryFinder(dishes, have, 'unknown', 60).visible.map((d) => d.id)).toEqual(['白粥']);
  });
});
