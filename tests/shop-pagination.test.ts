import { describe, expect, it } from 'vitest';
import type { Restaurant, TreatType, VenuePurpose } from '../shared/types.js';
import { emptyVenueFilter, filterVenues, sameVenueFilter, type VenueFilter } from '../shared/venueFilter.js';
import { changeFilter, changePage, clampPage, pageSlice, SHOP_PAGE_SIZE, type PagedFilter } from '../web/src/lib/pagination.js';

function shop(i: number, purposes: VenuePurpose[] = ['meal'], tags: string[] = [], treatTypes: TreatType[] = []): Restaurant {
  return {
    id: `s${i}`,
    name: `店 ${i}`,
    imageAssetId: null,
    review: '',
    tags,
    budgetText: '',
    address: '',
    mapUrl: null,
    links: [],
    note: '',
    location: { country: '', countryCode: '', region: '', city: '', source: '' },
    purposes,
    treatTypes,
    active: true,
    createdAt: '',
    updatedAt: '',
  };
}

describe('page slices', () => {
  it('cuts a list into pages of 10 with the shown range', () => {
    const items = Array.from({ length: 23 }, (_, i) => i + 1);
    expect(SHOP_PAGE_SIZE).toBe(10);
    expect(pageSlice(items, 1, 10)).toMatchObject({ page: 1, totalPages: 3, total: 23, first: 1, last: 10 });
    expect(pageSlice(items, 3, 10)).toMatchObject({ items: [21, 22, 23], page: 3, first: 21, last: 23 });
    expect(pageSlice(Array.from({ length: 10 }, (_, i) => i), 2, 10)).toMatchObject({ page: 1, totalPages: 1 });
  });

  it('clamps past-the-end, invalid and empty pages', () => {
    expect(pageSlice([], 4, 10)).toEqual({ items: [], page: 1, totalPages: 1, total: 0, first: 0, last: 0 });
    expect(clampPage(0, 30, 10)).toBe(1);
    expect(clampPage(-2, 30, 10)).toBe(1);
    expect(clampPage(Number.NaN, 30, 10)).toBe(1);
    expect(clampPage(2.7, 30, 10)).toBe(2);
    expect(clampPage(99, 30, 10)).toBe(3);
    // Deleting the only shop on page 3 (21 → 20 shops) lands on page 2.
    const before = Array.from({ length: 21 }, (_, i) => i);
    expect(pageSlice(before, 3, 10).items).toEqual([20]);
    expect(pageSlice(before.slice(0, 20), 3, 10)).toMatchObject({ page: 2, first: 11, last: 20 });
  });
});

describe('admin shop list: filter the whole catalog, then page', () => {
  // 25 shops; the only matches are beyond the first 10 (positions 12, 18 and 24).
  const SHOPS = Array.from({ length: 25 }, (_, i) =>
    [12, 18, 24].includes(i + 1) ? shop(i + 1, ['treat'], ['约会'], ['coffee']) : shop(i + 1, ['meal'], ['川菜']),
  );

  it('finds matches beyond the first page for search, tags, types and purpose', () => {
    const page = (f: Partial<VenueFilter>) => pageSlice(filterVenues(SHOPS, { ...emptyVenueFilter(null), ...f }), 1, SHOP_PAGE_SIZE);
    const want = ['s12', 's18', 's24'];
    expect(page({ tags: ['约会'] }).items.map((s) => s.id)).toEqual(want);
    expect(page({ treatTypes: ['coffee'] }).items.map((s) => s.id)).toEqual(want);
    expect(page({ purpose: 'treat' }).items.map((s) => s.id)).toEqual(want);
    expect(page({ q: '店 24' }).items.map((s) => s.id)).toEqual(['s24']);
    expect(page({ tags: ['约会'] })).toMatchObject({ total: 3, totalPages: 1 });
  });

  it('a changed filter goes back to page 1 at once; paging keeps the filter; the same filter keeps the page', () => {
    const start: PagedFilter<VenueFilter> = { filter: emptyVenueFilter(null), page: 1 };
    const onPage3 = changePage(start, 3);
    expect(onPage3).toEqual({ filter: start.filter, page: 3 });
    const typed = changeFilter(onPage3, { ...onPage3.filter, q: '店' }, sameVenueFilter);
    expect(typed.page).toBe(1);
    const tagged = changeFilter(changePage(typed, 2), { ...typed.filter, tags: ['约会'] }, sameVenueFilter);
    expect(tagged).toEqual({ filter: { ...typed.filter, tags: ['约会'] }, page: 1 });
    // Every criterion counts as a change.
    for (const patch of [{ tagMode: 'all' }, { places: ['unknown'] }, { purpose: 'meal' }, { treatTypes: ['cake'] }, { onlySelected: true }] as Partial<VenueFilter>[]) {
      expect(changeFilter(onPage3, { ...onPage3.filter, ...patch }, sameVenueFilter).page).toBe(1);
    }
    // Re-applying an identical filter (e.g. closing the drawer without changes) is not a change.
    const same = changeFilter(onPage3, { ...onPage3.filter, tags: [...onPage3.filter.tags] }, sameVenueFilter);
    expect(same).toBe(onPage3);
  });
});
