import { Check, Info, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Dish } from '../../../../shared/types';
import { DishInfo, dishSummaryLines, SectionLabels } from '../../components/DishBits';
import { EmptyPlate } from '../../components/Illustrations';
import { ItemImage } from '../../components/ItemImage';
import { Sheet } from '../../components/Sheet';
import { dishSectionOptions, filterDishes } from '../../lib/dishes';
import { CatalogFilters, emptyFilter, type FilterState } from './CatalogFilters';

interface Props {
  dishes: Dish[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));

export function DishPicker({ dishes, selectedIds, onToggle }: Props) {
  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [detail, setDetail] = useState<Dish | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sections = useMemo(() => dishSectionOptions(dishes), [dishes]);
  const tags = useMemo(() => uniqueSorted(dishes.flatMap((d) => d.tags)), [dishes]);

  const visible = filterDishes(dishes, filter, selected);

  if (dishes.length === 0) {
    return (
      <div className="empty-state">
        <EmptyPlate className="empty-art" />
        <p>菜单里还没有可选的菜。</p>
        <p className="muted small">主厨上新之后，这里会出现可以点的菜。</p>
      </div>
    );
  }

  return (
    <div className="picker">
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
        <p className="muted empty-filter">没有符合条件的菜，换个关键词试试。</p>
      ) : (
        <ul className="dish-grid">
          {visible.map((d) => (
            <DishCard
              key={d.id}
              dish={d}
              selected={selected.has(d.id)}
              onToggle={() => onToggle(d.id)}
              onDetail={() => setDetail(d)}
            />
          ))}
        </ul>
      )}

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <div className="detail">
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
  onToggle: () => void;
  onDetail: () => void;
}

/**
 * Compact text-first card. The whole text area toggles the dish; 详情 is a separate button.
 * A small thumbnail appears only when the dish has a photo.
 */
function DishCard({ dish: d, selected, onToggle, onDetail }: CardProps) {
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
