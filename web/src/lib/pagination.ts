/**
 * Client-side paging of an already filtered list. Filtering always runs over the whole catalog
 * first; only the result is cut into pages, so a match beyond the first page is never missed.
 */

/** Admin 店铺 list. */
export const SHOP_PAGE_SIZE = 10;

export interface PageSlice<T> {
  items: T[];
  /** The page actually shown: clamped to 1..totalPages. */
  page: number;
  /** At least 1, even for an empty list. */
  totalPages: number;
  total: number;
  /** 1-based position of the first / last shown item; both 0 when the list is empty. */
  first: number;
  last: number;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** A page past the end (e.g. the last item of the final page was deleted) becomes the last page. */
export function clampPage(page: number, total: number, pageSize: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), pageCount(total, pageSize));
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const total = items.length;
  const current = clampPage(page, total, pageSize);
  const start = (current - 1) * pageSize;
  const shown = items.slice(start, start + pageSize);
  return {
    items: shown,
    page: current,
    totalPages: pageCount(total, pageSize),
    total,
    first: shown.length ? start + 1 : 0,
    last: start + shown.length,
  };
}

export interface PagedFilter<F> {
  filter: F;
  page: number;
}

/** A changed filter starts again on page 1; re-applying the same filter keeps the page. */
export function changeFilter<F>(state: PagedFilter<F>, next: F, same: (a: F, b: F) => boolean): PagedFilter<F> {
  return same(state.filter, next) ? state : { filter: next, page: 1 };
}

/** Paging never touches the filter. */
export function changePage<F>(state: PagedFilter<F>, page: number): PagedFilter<F> {
  return page === state.page ? state : { ...state, page };
}
