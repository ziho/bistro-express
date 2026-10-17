import { useId } from 'react';
import { PANTRY_FILTER_LABELS, PANTRY_FILTERS, type PantryFilter } from '../../../../shared/pantry';
import { PANTRY_CAVEAT } from '../../components/PantryBits';
import { TOTAL_TIME_OPTIONS } from '../../lib/pantryFinder';

interface Props {
  filter: PantryFilter;
  onFilter: (filter: PantryFilter) => void;
  maxMinutes: number | null;
  onMaxMinutes: (minutes: number | null) => void;
  counts: Record<PantryFilter, number>;
}

/** Match filters (with counts) and the optional recorded-total-time limit of the pantry finder. */
export function PantryFilters({ filter, onFilter, maxMinutes, onMaxMinutes, counts }: Props) {
  const timeId = useId();
  return (
    <div className="pantry-filters">
      <div className="chip-scroller" role="group" aria-label="按现有食材筛选">
        {PANTRY_FILTERS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {PANTRY_FILTER_LABELS[f]}
            <span className="pantry-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="pantry-time">
        <label htmlFor={timeId} className="field-label">
          总耗时
        </label>
        <select
          id={timeId}
          className="input pantry-time-select"
          value={maxMinutes ?? ''}
          onChange={(e) => onMaxMinutes(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">不限</option>
          {TOTAL_TIME_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} 分钟以内
            </option>
          ))}
        </select>
        {maxMinutes !== null && <span className="muted small">没记录总耗时的菜不会显示</span>}
      </div>
      <p className="muted small pantry-caveat">按「主料齐了 → 缺得少 → 已有得多」排序。{PANTRY_CAVEAT}</p>
    </div>
  );
}
