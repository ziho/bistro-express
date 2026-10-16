import { Check, ExternalLink, Info, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Dish } from '../../../../shared/types';
import { EmptyPlate } from '../../components/Illustrations';
import { ItemImage } from '../../components/ItemImage';
import { Sheet } from '../../components/Sheet';
import { CatalogFilters, emptyFilter, matchesQuery, type FilterState } from './CatalogFilters';

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
  const categories = useMemo(() => uniqueSorted(dishes.map((d) => d.category)), [dishes]);
  const tags = useMemo(() => uniqueSorted(dishes.flatMap((d) => d.tags)), [dishes]);

  const visible = dishes.filter(
    (d) =>
      (!filter.group || d.category === filter.group) &&
      (!filter.tag || d.tags.includes(filter.tag)) &&
      (!filter.onlySelected || selected.has(d.id)) &&
      matchesQuery(filter.q, [d.name, d.category, d.description, ...d.tags]),
  );

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
        groups={categories}
        tags={tags}
        groupLabel="按分类和标签筛选"
        selectedCount={selected.size}
        placeholder="搜菜名、分类或标签"
      />
      <p className="sr-only" aria-live="polite">
        找到 {visible.length} 道菜
      </p>
      {visible.length === 0 ? (
        <p className="muted empty-filter">没有符合条件的菜，换个关键词试试。</p>
      ) : (
        <ul className="card-grid">
          {visible.map((d) => {
            const isOn = selected.has(d.id);
            return (
              <li key={d.id} className={`food-card ${isOn ? 'is-selected' : ''}`}>
                <button type="button" className="food-card-main" aria-pressed={isOn} onClick={() => onToggle(d.id)}>
                  <ItemImage assetId={d.imageAssetId} name={d.name} />
                  <span className="food-card-text">
                    <span className="food-card-name">{d.name}</span>
                    {d.category && <span className="food-card-meta">{d.category}</span>}
                  </span>
                  <span className="food-card-check" aria-hidden="true">
                    {isOn ? <Check /> : <Plus />}
                  </span>
                  <span className="sr-only">{isOn ? '已选，点击取消' : '点击选择'}</span>
                </button>
                <button type="button" className="food-card-info" onClick={() => setDetail(d)} aria-label={`${d.name} 详情`}>
                  <Info aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <div className="detail">
            <ItemImage assetId={detail.imageAssetId} name={detail.name} variant="full" className="detail-image" />
            <p className="muted">{[detail.category, ...detail.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')}</p>
            {detail.description && <p className="detail-desc">{detail.description}</p>}
            {detail.recipeUrl && (
              <a className="btn btn-ghost" href={detail.recipeUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                查看做法
              </a>
            )}
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
