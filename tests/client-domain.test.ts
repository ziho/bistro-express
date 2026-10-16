import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_LABEL } from '../shared/constants.js';
import { isSafeExternalUrl, restaurantLink, splitTags } from '../shared/restaurant.js';
import type { Catalog, Plan, Restaurant, RestaurantSnapshot } from '../shared/types.js';
import { draftToInput } from '../web/src/lib/drafts.js';
import { drawOne, randomIndex } from '../web/src/lib/draw.js';
import { cloneToDraft } from '../web/src/lib/planView.js';
import { filterRestaurants } from '../web/src/lib/restaurants.js';

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

const snapshot: RestaurantSnapshot = {
  id: 'r1',
  name: 'A',
  imageAssetId: null,
  review: '',
  tags: [],
  budgetText: '',
  address: '',
  mapUrl: null,
  linkUrl: null,
  linkLabel: '',
};

const restaurant = (patch: Partial<Restaurant> = {}): Restaurant => ({
  id: 'r1',
  name: 'A',
  imageAssetId: null,
  review: '',
  tags: [],
  budgetText: '',
  address: '',
  mapUrl: null,
  linkUrl: null,
  linkLabel: '',
  note: '',
  active: true,
  createdAt: '',
  updatedAt: '',
  ...patch,
});

describe('restaurant link and search helpers', () => {
  it('shows a link action only for a safe http(s) URL, with a default label', () => {
    expect(restaurantLink({ linkUrl: 'https://example.com/menu', linkLabel: '' })).toEqual({
      href: 'https://example.com/menu',
      label: DEFAULT_LINK_LABEL,
    });
    expect(restaurantLink({ linkUrl: 'https://example.com', linkLabel: ' 看菜单 ' })?.label).toBe('看菜单');
    expect(restaurantLink({ linkUrl: null, linkLabel: '看菜单' })).toBeNull();
    expect(restaurantLink({ linkUrl: 'javascript:alert(1)', linkLabel: '' })).toBeNull();
  });

  it('accepts only browser-safe external URLs', () => {
    for (const ok of ['https://example.com', 'http://example.com/menu?a=1#x', 'https://例子.中国/菜单']) {
      expect(isSafeExternalUrl(ok), ok).toBe(true);
    }
    for (const bad of ['', 'example.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'https://user:pw@example.com', 'https://exa mple.com', 'https://example.com/\n', '//example.com']) {
      expect(isSafeExternalUrl(bad), bad).toBe(false);
    }
  });

  it('splits tags on the same separators as the admin form', () => {
    expect(splitTags(' 川菜、火锅,约会 #川菜 ')).toEqual(['川菜', '火锅', '约会']);
    expect(splitTags('   ')).toEqual([]);
  });

  it('searches by tag, review, address, note, budget and name; filters by tag', () => {
    const list = [
      restaurant({ id: 'a', name: 'Golden Noodle', tags: ['面', '快手'], review: '牛肉面很香', address: '中山路', budgetText: '人均 40' }),
      restaurant({ id: 'b', name: '小酒馆', tags: ['约会'], note: '要提前订位' }),
    ];
    const ids = (q: string, tag = '') => filterRestaurants(list, { q, tag, onlySelected: false }, new Set()).map((r) => r.id);
    expect(ids('golden')).toEqual(['a']);
    expect(ids('牛肉')).toEqual(['a']);
    expect(ids('中山')).toEqual(['a']);
    expect(ids('40')).toEqual(['a']);
    expect(ids('订位')).toEqual(['b']);
    expect(ids('约会')).toEqual(['b']);
    expect(ids('', '快手')).toEqual(['a']);
    expect(filterRestaurants(list, { q: '', tag: '', onlySelected: true }, new Set(['b'])).map((r) => r.id)).toEqual(['b']);
  });
});

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
      candidates: [snapshot],
      selectedRestaurant: snapshot,
    };
    const catalog: Catalog = { dishes: [], restaurants: [restaurant()] };
    const { draft } = cloneToDraft(plan, catalog, '2030-02-01');
    expect(draft.candidateIds).toEqual(['r1']);
    expect(draft.selectedRestaurantId).toBeNull();
  });
});
