import { Search, X } from 'lucide-react';
import { useId } from 'react';

export interface FilterState {
  q: string;
  group: string;
  tag: string;
  onlySelected: boolean;
}

export const emptyFilter: FilterState = { q: '', group: '', tag: '', onlySelected: false };

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  groups: string[];
  tags: string[];
  groupLabel: string;
  selectedCount: number;
  placeholder: string;
}

export function matchesQuery(q: string, fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export function CatalogFilters({ value, onChange, groups, tags, groupLabel, selectedCount, placeholder }: Props) {
  const searchId = useId();
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="filters">
      <div className="search-box">
        <Search aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          搜索
        </label>
        <input
          id={searchId}
          type="search"
          className="input"
          placeholder={placeholder}
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          enterKeyHint="search"
        />
        {value.q && (
          <button type="button" className="icon-btn" aria-label="清除搜索" onClick={() => set({ q: '' })}>
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="chip-scroller" role="group" aria-label={groupLabel}>
        <button type="button" className="chip" aria-pressed={!value.group && !value.tag && !value.onlySelected} onClick={() => onChange({ ...value, group: '', tag: '', onlySelected: false })}>
          全部
        </button>
        <button type="button" className="chip" aria-pressed={value.onlySelected} onClick={() => set({ onlySelected: !value.onlySelected })}>
          已选 {selectedCount}
        </button>
        {groups.map((g) => (
          <button key={`g-${g}`} type="button" className="chip" aria-pressed={value.group === g} onClick={() => set({ group: value.group === g ? '' : g })}>
            {g}
          </button>
        ))}
        {tags.map((t) => (
          <button key={`t-${t}`} type="button" className="chip chip-tag" aria-pressed={value.tag === t} onClick={() => set({ tag: value.tag === t ? '' : t })}>
            #{t}
          </button>
        ))}
      </div>
    </div>
  );
}
