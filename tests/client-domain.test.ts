import { describe, expect, it } from 'vitest';
import type { Catalog, Plan } from '../shared/types.js';
import { draftToInput } from '../web/src/lib/drafts.js';
import { drawOne, randomIndex } from '../web/src/lib/draw.js';
import { cloneToDraft } from '../web/src/lib/planView.js';

describe('restaurant draw', () => {
  it('cannot draw from an empty basket and returns the only candidate', () => {
    expect(drawOne([])).toBeNull();
    expect(drawOne(['a', 'a'])).toBe('a');
  });

  it('draws uniformly among de-duplicated candidates', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 6000; i += 1) counts[drawOne(['a', 'a', 'a', 'b', 'c'])!]! += 1;
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThan(1700);
      expect(n).toBeLessThan(2300);
    }
  });

  it('randomIndex stays in range', () => {
    for (let i = 0; i < 1000; i += 1) {
      const v = randomIndex(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});

const basePlan: Plan = {
  id: 'p1',
  shortId: 'ABC234',
  status: 'active',
  version: 3,
  date: '2030-01-01',
  mealLabel: '晚餐',
  localTime: '19:00',
  timeZone: 'Asia/Shanghai',
  instant: '2030-01-01T11:00:00Z',
  mode: 'home',
  note: '少辣',
  dishes: [
    { id: 'd1', name: '番茄炒蛋', category: '', imageAssetId: null },
    { id: 'd2', name: '已下架的菜', category: '', imageAssetId: null },
  ],
  candidates: [],
  selectedRestaurant: null,
  sourcePlanId: null,
  createdAt: '',
  updatedAt: '',
  cancelledAt: null,
  notification: null,
};

describe('再来一顿 clone', () => {
  it('copies the meal into a fresh draft and drops unavailable items', () => {
    const catalog: Catalog = {
      dishes: [{ id: 'd1', name: '番茄炒蛋', imageAssetId: null, category: '', tags: [], description: '', recipeUrl: null, active: true, createdAt: '', updatedAt: '' }],
      restaurants: [],
    };
    const { draft, dropped } = cloneToDraft(basePlan, catalog, '2030-02-01');
    expect(dropped).toEqual(['已下架的菜']);
    expect(draft).toMatchObject({ date: '2030-02-01', mealLabel: '晚餐', dishIds: ['d1'], sourcePlanId: 'p1', planId: null });
    expect(draft.key).toMatch(/^new-/);
    const input = draftToInput(draft);
    expect(input).toMatchObject({ mode: 'home', dishIds: ['d1'], candidateIds: [], selectedRestaurantId: null });
  });

  it('never carries over a previous draw for restaurant plans', () => {
    const plan: Plan = {
      ...basePlan,
      mode: 'restaurant',
      dishes: [],
      candidates: [{ id: 'r1', name: 'A', cuisine: '', imageAssetId: null, budgetText: '', address: '', mapUrl: null }],
      selectedRestaurant: { id: 'r1', name: 'A', cuisine: '', imageAssetId: null, budgetText: '', address: '', mapUrl: null },
    };
    const catalog: Catalog = {
      dishes: [],
      restaurants: [{ id: 'r1', name: 'A', imageAssetId: null, cuisine: '', tags: [], budgetText: '', address: '', mapUrl: null, note: '', active: true, createdAt: '', updatedAt: '' }],
    };
    const { draft } = cloneToDraft(plan, catalog, '2030-02-01');
    expect(draft.candidateIds).toEqual(['r1']);
    expect(draft.selectedRestaurantId).toBeNull();
  });
});
