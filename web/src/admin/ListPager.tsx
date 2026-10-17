import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { motionAllowed } from '../lib/motion';
import type { PageSlice } from '../lib/pagination';

interface Props {
  slice: Pick<PageSlice<unknown>, 'page' | 'totalPages' | 'total' | 'first' | 'last'>;
  /** Accessible name of the navigation, e.g. 店铺列表分页. */
  label: string;
  unit: string;
  onGo: (page: number) => void;
}

/** Compact 上一页 / 第 N / M 页 / 下一页 with the shown range; the range is always announced. */
export function ListPager({ slice, label, unit, onGo }: Props) {
  const { page, totalPages, total, first, last } = slice;
  return (
    <nav className="list-pager" aria-label={label}>
      {totalPages > 1 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(page - 1)} disabled={page <= 1}>
          <ChevronLeft aria-hidden="true" /> 上一页
        </button>
      )}
      <p className="list-pager-status" aria-live="polite">
        {totalPages > 1 && `第 ${page} / ${totalPages} 页 · `}
        {total > 0 ? `第 ${first}–${last} ${unit}，共 ${total} ${unit}` : `0 ${unit}`}
      </p>
      {totalPages > 1 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(page + 1)} disabled={page >= totalPages}>
          下一页 <ChevronRight aria-hidden="true" />
        </button>
      )}
    </nav>
  );
}

/**
 * After a page action (never after filtering or a background refresh) the list's region is
 * brought to the top of the view and focused, so keyboard and screen-reader users land on the new
 * page. Smooth scrolling only when motion is allowed; keyboard input and reduced motion jump.
 */
export function usePageFocus<T extends HTMLElement>(page: number) {
  const target = useRef<T>(null);
  const requested = useRef(false);
  useLayoutEffect(() => {
    if (!requested.current) return;
    requested.current = false;
    const el = target.current;
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: motionAllowed() ? 'smooth' : 'auto' });
    el.focus({ preventScroll: true });
  }, [page]);
  return { target, request: () => (requested.current = true) };
}
