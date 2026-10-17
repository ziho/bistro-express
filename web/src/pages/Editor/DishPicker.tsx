import { Check, ChevronDown, Info, Plus, Refrigerator } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { catalogIngredientNames, PANTRY_FILTER_LABELS, type PantryFilter, type PantryMatch } from '../../../../shared/pantry';
import type { Dish } from '../../../../shared/types';
import { DishInfo, dishSummaryLines, SectionLabels } from '../../components/DishBits';
import { EmptyPlate } from '../../components/Illustrations';
import { ItemImage } from '../../components/ItemImage';
import { PantryMatchDetail, PantryMatchLine } from '../../components/PantryBits';
import { Sheet } from '../../components/Sheet';
import { dishSectionOptions, filterDishes } from '../../lib/dishes';
import { applyPantryFinder } from '../../lib/pantryFinder';
import { usePantry } from '../../lib/pantryStore';
import { CatalogFilters, emptyFilter, type FilterState } from './CatalogFilters';
import { PantryFilters } from './PantryFilters';
import { PantryPanel } from './PantryPanel';

interface Props {
  dishes: Dish[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));

export function DishPicker({ dishes, selectedIds, onToggle }: Props) {
  const panelId = useId();
  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [detail, setDetail] = useState<Dish | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [pantryFilter, setPantryFilter] = useState<PantryFilter>('all');
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const { pantry, keys: have } = usePantry();
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sections = useMemo(() => dishSectionOptions(dishes), [dishes]);
  const tags = useMemo(() => uniqueSorted(dishes.flatMap((d) => d.tags)), [dishes]);
  const ingredientNames = useMemo(() => catalogIngredientNames(dishes), [dishes]);

  const base = filterDishes(dishes, filter, selected);
  // The finder only acts while open with at least one remembered name; otherwise the picker is unchanged.
  const finder = finderOpen && pantry.names.length > 0 ? applyPantryFinder(base, have, pantryFilter, maxMinutes) : null;
  const visible = finder ? finder.visible : base;
  const finderNarrowed = finder !== null && (pantryFilter !== 'all' || maxMinutes !== null);

  if (dishes.length === 0) {
    return (
      <div className="empty-state">
        <EmptyPlate className="empty-art" />
        <p>菜单里还没有可选的菜。</p>
        <p className="muted small">后台添加菜品后，这里就能选。</p>
      </div>
    );
  }

  const detailMatch = detail && finder ? finder.matches.get(detail.id) : undefined;

  return (
    <div className="picker">
      <div className={`pantry-finder${finderOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="pantry-toggle"
          aria-expanded={finderOpen}
          aria-controls={panelId}
          onClick={() => setFinderOpen((open) => !open)}
        >
          <Refrigerator aria-hidden="true" />
          <span className="pantry-toggle-text">按现有食材找菜</span>
          {pantry.names.length > 0 && <span className="pantry-toggle-count">已记 {pantry.names.length} 样</span>}
          <ChevronDown aria-hidden="true" className="pantry-toggle-chevron" />
        </button>
        {finderOpen && (
          <div id={panelId} className="pantry-finder-body">
            <PantryPanel catalogNames={ingredientNames} />
            {finder ? (
              <PantryFilters
                filter={pantryFilter}
                onFilter={setPantryFilter}
                maxMinutes={maxMinutes}
                onMaxMinutes={setMaxMinutes}
                counts={finder.counts}
              />
            ) : (
              <p className="notice notice-sky small pantry-empty-hint">
                先记下家里现有的食材，下面的菜会按主料是否齐全排序和筛选。现在显示的是全部菜，没有按食材判断。
              </p>
            )}
          </div>
        )}
      </div>

      <CatalogFilters
        value={filter}
        onChange={setFilter}
        groups={sections}
        tags={tags}
        groupLabel="按菜单分区和标签筛选"
        selectedCount={selected.size}
        placeholder="搜菜名、分区、标签或主料"
      />
      <p className="sr-only" aria-live="polite">
        找到 {visible.length} 道菜
      </p>
      {visible.length === 0 ? (
        finderNarrowed && base.length > 0 ? (
          <div className="muted empty-filter">
            <p>
              没有{pantryFilter !== 'all' ? `「${PANTRY_FILTER_LABELS[pantryFilter]}」` : ''}
              {maxMinutes !== null ? `且记录总耗时在 ${maxMinutes} 分钟以内` : ''}的菜。
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setPantryFilter('all');
                setMaxMinutes(null);
              }}
            >
              显示全部匹配结果
            </button>
          </div>
        ) : (
          <p className="muted empty-filter">没有符合条件的菜，换个关键词试试。</p>
        )
      ) : (
        <ul className="dish-grid">
          {visible.map((d) => (
            <DishCard
              key={d.id}
              dish={d}
              selected={selected.has(d.id)}
              match={finder?.matches.get(d.id)}
              onToggle={() => onToggle(d.id)}
              onDetail={() => setDetail(d)}
            />
          ))}
        </ul>
      )}

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <div className="detail">
            {detailMatch && <PantryMatchDetail match={detailMatch} />}
            <DishInfo dish={detail} />
            <button
              type="button"
              className={`btn ${selected.has(detail.id) ? 'btn-ghost' : 'btn-primary'} btn-block`}
              onClick={() => {
                onToggle(detail.id);
                setDetail(null);
              }}
            >
              {selected.has(detail.id) ? '从这一餐移除' : '加入这一餐'}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

interface CardProps {
  dish: Dish;
  selected: boolean;
  /** Present only while the pantry finder is active. */
  match?: PantryMatch;
  onToggle: () => void;
  onDetail: () => void;
}

/**
 * Compact text-first card. The whole text area toggles the dish; 详情 is a separate button.
 * A small thumbnail appears only when the dish has a photo.
 */
function DishCard({ dish: d, selected, match, onToggle, onDetail }: CardProps) {
  const { ingredients, facts } = dishSummaryLines(d);
  return (
    <li className={`dish-card ${selected ? 'is-selected' : ''}`}>
      <button type="button" className="dish-card-main" aria-pressed={selected} onClick={onToggle}>
        <span className="dish-card-check" aria-hidden="true">
          {selected ? <Check /> : <Plus />}
        </span>
        {d.imageAssetId && <ItemImage as="span" assetId={d.imageAssetId} name={d.name} className="dish-card-photo" />}
        <span className="dish-card-text">
          <span className="dish-card-name">
            {d.name}
          </span>
          <SectionLabels sections={d.sections} as="span" />
          {match && <PantryMatchLine match={match} />}
          {ingredients && <span className="dish-card-line">{ingredients}</span>}
          {facts && <span className="dish-card-line dish-card-facts">{facts}</span>}
        </span>
        <span className="sr-only">{selected ? '，已选，点击取消' : '，点击加入这一餐'}</span>
      </button>
      <button type="button" className="dish-card-info" aria-label={`${d.name} 详情`} onClick={onDetail}>
        <Info aria-hidden="true" />
      </button>
    </li>
  );
}
