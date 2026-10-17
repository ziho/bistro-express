import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { treatTypeChoices, treatTypeLabel, type TreatTypeChoice, type TreatTypeFilter } from '../../../shared/treatType';
import type { Restaurant, VenuePurpose } from '../../../shared/types';
import { PURPOSE_LABEL } from '../../../shared/venue';
import {
  activeFilterCount,
  BLANK_PLACE_LABEL,
  clearVenueCriteria,
  filterVenues,
  placeKeyLabel,
  placeTree,
  tagChoices,
  UNKNOWN_PLACE,
  type PlaceNode,
  type VenueFilter,
} from '../../../shared/venueFilter';
import { useMediaQuery } from '../lib/hooks';
import { Sheet } from './Sheet';

interface Props {
  /** Venues the choices are derived from (already limited to the plan's purpose in the picker). */
  venues: Restaurant[];
  value: VenueFilter;
  onChange: (next: VenueFilter) => void;
  placeholder: string;
  /** Picker only: the 「已选 N」 toggle. */
  selected?: ReadonlySet<string>;
  /** Admin only: choose 吃饭 / 饮品甜品 / 全部. */
  purposeChoice?: boolean;
  /** Offer the drinks / dessert type criterion in the panel (hidden while the purpose is 吃饭). */
  typeChoice?: boolean;
  /** Treat picker: the types also as quick chips above the results, applied at once. */
  quickTypes?: boolean;
  /** Plural noun for counts, e.g. 家. */
  unit?: string;
}

const toggle = <T extends string>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** Type choices to offer: those in use, plus any still selected (so they can be removed). */
function typeChoicesFor(all: TreatTypeChoice[], selected: TreatTypeFilter[]): TreatTypeChoice[] {
  const missing = selected.filter((t) => !all.some((c) => c.value === t)).map((t) => ({ value: t, label: treatTypeLabel(t), count: 0 }));
  return [...all, ...missing];
}

/** Every place key in the tree (for pruning remembered filters). */
export function collectPlaceKeys(nodes: PlaceNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    out.add(n.key);
    collectPlaceKeys(n.children, out);
  }
  return out;
}

/**
 * Search box + 筛选 (purpose, drinks / dessert types, tags ANY/ALL, places) + removable active
 * chips. On phones the criteria open in a sheet and apply with 「查看 N 家」; on wider screens they
 * sit in an inline panel and apply immediately. Quick type chips (treat picker) always apply at
 * once. Choices and counts come from the whole `venues` list. Changing filters never touches the
 * candidate selection.
 */
export function VenueFilters({
  venues,
  value,
  onChange,
  placeholder,
  selected,
  purposeChoice = false,
  typeChoice = false,
  quickTypes = false,
  unit = '家',
}: Props) {
  const wide = useMediaQuery('(min-width: 760px)');
  const searchId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<VenueFilter>(value);
  const tree = useMemo(() => placeTree(venues), [venues]);
  const types = useMemo(() => treatTypeChoices(venues), [venues]);

  // A wide open panel applies immediately. If it becomes a phone drawer (rotation / split view),
  // stage the current applied values rather than the stale snapshot from when it first opened.
  useEffect(() => {
    if (!wide && open) setStaged(value);
  }, [wide, open]);
  const count = activeFilterCount(value) + (purposeChoice && value.purpose ? 1 : 0);
  const stagedCount = filterVenues(venues, staged, selected).length;

  const openPanel = () => {
    setStaged(value);
    setOpen((o) => (wide ? !o : true));
  };
  const set = (patch: Partial<VenueFilter>) => onChange({ ...value, ...patch });
  const clearAll = () => onChange(clearVenueCriteria(value, purposeChoice));

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(purposeChoice && value.purpose ? [{ key: 'purpose', label: PURPOSE_LABEL[value.purpose], remove: () => set({ purpose: null }) }] : []),
    ...value.treatTypes.map((t) => ({
      key: `k-${t}`,
      label: treatTypeLabel(t),
      remove: () => set({ treatTypes: value.treatTypes.filter((x) => x !== t) }),
    })),
    ...value.tags.map((t) => ({ key: `t-${t}`, label: `#${t}`, remove: () => set({ tags: value.tags.filter((x) => x !== t) }) })),
    ...value.places.map((p) => ({ key: `p-${p}`, label: placeKeyLabel(p, tree.nodes), remove: () => set({ places: value.places.filter((x) => x !== p) }) })),
  ];

  return (
    <div className="filters venue-filters">
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
      <div className="filter-bar">
        <button
          type="button"
          className={`chip filter-toggle ${count ? 'is-active' : ''}`}
          aria-expanded={wide ? open : undefined}
          aria-controls={wide ? panelId : undefined}
          aria-haspopup={wide ? undefined : 'dialog'}
          onClick={openPanel}
        >
          <SlidersHorizontal aria-hidden="true" />
          筛选{count ? ` · ${count}` : ''}
          {wide && <ChevronDown aria-hidden="true" className={open ? 'is-flipped' : ''} />}
        </button>
        {selected && (
          <button type="button" className="chip" aria-pressed={value.onlySelected} onClick={() => set({ onlySelected: !value.onlySelected })}>
            已选 {selected.size}
          </button>
        )}
        {value.tags.length > 1 && (
          <span className="muted small">{value.tagMode === 'all' ? '标签全部符合' : '标签任一符合'}</span>
        )}
      </div>
      {quickTypes && types.length > 0 && (
        <div className="chip-scroller type-quick-chips" role="group" aria-label="按类型筛选（可多选，符合任一）">
          <button type="button" className="chip" aria-pressed={value.treatTypes.length === 0} onClick={() => set({ treatTypes: [] })}>
            全部类型
          </button>
          {typeChoicesFor(types, value.treatTypes).map((c) => (
            <button
              key={c.value}
              type="button"
              className="chip"
              aria-pressed={value.treatTypes.includes(c.value)}
              onClick={() => set({ treatTypes: toggle(value.treatTypes, c.value) })}
            >
              {c.label}
              <span className="chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <ul className="active-filters" aria-label="已启用的筛选">
          {chips.map((c) => (
            <li key={c.key}>
              <button type="button" className="chip chip-removable" onClick={c.remove} aria-label={`移除筛选 ${c.label}`}>
                <span>{c.label}</span>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
              清除全部
            </button>
          </li>
        </ul>
      )}

      {wide && open && (
        <div id={panelId} className="filter-panel card" role="region" aria-label="筛选条件">
          <FilterPanel venues={venues} tree={tree} types={typeChoice ? types : []} value={value} onChange={onChange} purposeChoice={purposeChoice} />
          <p className="muted small" aria-live="polite">
            符合条件的有 {filterVenues(venues, value, selected).length} {unit}
          </p>
        </div>
      )}
      {!wide && (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="筛选"
          variant="drawer"
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStaged(clearVenueCriteria(staged, purposeChoice))}
              >
                清除全部
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onChange({ ...staged, q: value.q });
                  setOpen(false);
                }}
              >
                查看 {stagedCount} {unit}
              </button>
            </>
          }
        >
          {open && (
            <FilterPanel venues={venues} tree={tree} types={typeChoice ? types : []} value={staged} onChange={setStaged} purposeChoice={purposeChoice} />
          )}
        </Sheet>
      )}
    </div>
  );
}

interface PanelProps {
  venues: Restaurant[];
  tree: ReturnType<typeof placeTree>;
  /** Drinks / dessert type choices; empty hides the section. */
  types: TreatTypeChoice[];
  value: VenueFilter;
  onChange: (next: VenueFilter) => void;
  purposeChoice: boolean;
}

function FilterPanel({ venues, tree, types, value, onChange, purposeChoice }: PanelProps) {
  const id = useId();
  const [tagQuery, setTagQuery] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const tags = useMemo(() => tagChoices(venues), [venues]);
  const needle = tagQuery.trim().toLowerCase();
  const placeCount = useMemo(() => collectPlaceKeys(tree.nodes).size, [tree.nodes]);
  const shownTags = tags.filter((t) => !needle || t.tag.toLowerCase().includes(needle) || value.tags.includes(t.tag));
  const set = (patch: Partial<VenueFilter>) => onChange({ ...value, ...patch });
  const purposes: (VenuePurpose | null)[] = [null, 'meal', 'treat'];

  return (
    <div className="filter-sections">
      {purposeChoice && (
        <fieldset className="filter-section">
          <legend className="field-label">用途</legend>
          <div className="chip-row">
            {purposes.map((p) => (
              <label key={p ?? 'all'} className="chip chip-radio">
                <input type="radio" name={`${id}-purpose`} checked={value.purpose === p} onChange={() => set({ purpose: p })} />
                <span>{p ? PURPOSE_LABEL[p] : '全部'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {(types.length > 0 || value.treatTypes.length > 0) && value.purpose !== 'meal' && (
        <fieldset className="filter-section">
          <legend className="field-label">
            饮品甜品类型{' '}
            <span className="muted small">
              {value.treatTypes.length > 0 ? `（已选 ${value.treatTypes.length} 个，任一符合）` : '（只看饮品甜品店，可多选）'}
            </span>
          </legend>
          <ul className="check-list">
            {typeChoicesFor(types, value.treatTypes).map((c) => (
              <li key={c.value}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={value.treatTypes.includes(c.value)}
                    onChange={() => set({ treatTypes: toggle(value.treatTypes, c.value) })}
                  />
                  <span>{c.label}</span>
                  <span className="muted small">{c.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <fieldset className="filter-section">
        <legend className="field-label">
          标签 {value.tags.length > 0 && <span className="muted small">（已选 {value.tags.length} 个）</span>}
        </legend>
        {tags.length === 0 ? (
          <p className="muted small">还没有店用过标签。</p>
        ) : (
          <>
            <div className="chip-row" role="radiogroup" aria-label="多个标签时">
              <label className="chip chip-radio">
                <input type="radio" name={`${id}-mode`} checked={value.tagMode === 'any'} onChange={() => set({ tagMode: 'any' })} />
                <span>符合任一</span>
              </label>
              <label className="chip chip-radio">
                <input type="radio" name={`${id}-mode`} checked={value.tagMode === 'all'} onChange={() => set({ tagMode: 'all' })} />
                <span>全部符合</span>
              </label>
            </div>
            {tags.length > 8 && (
              <>
                <label className="sr-only" htmlFor={`${id}-tagq`}>
                  搜索标签
                </label>
                <input
                  id={`${id}-tagq`}
                  className="input input-sm"
                  type="search"
                  placeholder="搜索标签"
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                />
              </>
            )}
            <ul className="check-list">
              {shownTags.map((t) => (
                <li key={t.tag}>
                  <label className="check-row">
                    <input type="checkbox" checked={value.tags.includes(t.tag)} onChange={() => set({ tags: toggle(value.tags, t.tag) })} />
                    <span className="wrap-anywhere">#{t.tag}</span>
                    <span className="muted small">{t.count}</span>
                  </label>
                </li>
              ))}
              {shownTags.length === 0 && <li className="muted small">没有匹配的标签</li>}
            </ul>
          </>
        )}
      </fieldset>

      <fieldset className="filter-section">
        <legend className="field-label">
          地区 {value.places.length > 0 && <span className="muted small">（已选 {value.places.length} 处，任一符合）</span>}
        </legend>
        {placeCount > 8 && (
          <>
            <label className="sr-only" htmlFor={`${id}-placeq`}>
              搜索地区
            </label>
            <input
              id={`${id}-placeq`}
              className="input input-sm"
              type="search"
              placeholder="搜索国家、省/州或城市"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
            />
          </>
        )}
        <ul className="check-list place-tree">
          {tree.nodes.map((n) => (
            <PlaceItem key={n.key} node={n} value={value.places} query={placeQuery.trim().toLowerCase()} onToggle={(k) => set({ places: toggle(value.places, k) })} />
          ))}
          {tree.unknown > 0 && (
            <li>
              <label className="check-row">
                <input type="checkbox" checked={value.places.includes(UNKNOWN_PLACE)} onChange={() => set({ places: toggle(value.places, UNKNOWN_PLACE) })} />
                <span>未填地区</span>
                <span className="muted small">{tree.unknown}</span>
              </label>
            </li>
          )}
          {tree.nodes.length === 0 && tree.unknown === 0 && <li className="muted small">还没有店填写地区。</li>}
        </ul>
        <p className="field-hint">选国家或省/州会包含其下所有城市；同名城市按所在国家和省/州区分。</p>
      </fieldset>
    </div>
  );
}

const nodeMatches = (n: PlaceNode, q: string): boolean => !q || n.label.toLowerCase().includes(q) || n.children.some((c) => nodeMatches(c, q));

function PlaceItem({ node, value, query, onToggle }: { node: PlaceNode; value: string[]; query: string; onToggle: (key: string) => void }) {
  if (!nodeMatches(node, query)) return null;
  // A blank region (city-state, or not recorded) is not a choice of its own: its cities hang under the country.
  const blankRegion = node.level === 'region' && node.label === '';
  const children = node.children.length > 0 && (
    <ul className="check-list place-children">
      {node.children.map((c) => (
        <PlaceItem key={c.key} node={c} value={value} query={query} onToggle={onToggle} />
      ))}
    </ul>
  );
  if (blankRegion) return <>{node.children.map((c) => <PlaceItem key={c.key} node={c} value={value} query={query} onToggle={onToggle} />)}</>;
  return (
    <li>
      <label className="check-row">
        <input type="checkbox" checked={value.includes(node.key)} onChange={() => onToggle(node.key)} />
        <span className="wrap-anywhere">{node.label || BLANK_PLACE_LABEL[node.level]}</span>
        <span className="muted small">{node.count}</span>
      </label>
      {children}
    </li>
  );
}
