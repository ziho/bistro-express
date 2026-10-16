import { Check, Info, MapPin, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Restaurant } from '../../../../shared/types';
import { EmptyPlate } from '../../components/Illustrations';
import { ItemImage } from '../../components/ItemImage';
import { Sheet } from '../../components/Sheet';
import { CatalogFilters, emptyFilter, matchesQuery, type FilterState } from './CatalogFilters';

interface Props {
  restaurants: Restaurant[];
  candidateIds: string[];
  onToggle: (id: string) => void;
}

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));

export function RestaurantPicker({ restaurants, candidateIds, onToggle }: Props) {
  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [detail, setDetail] = useState<Restaurant | null>(null);
  const selected = useMemo(() => new Set(candidateIds), [candidateIds]);
  const cuisines = useMemo(() => uniqueSorted(restaurants.map((r) => r.cuisine)), [restaurants]);
  const tags = useMemo(() => uniqueSorted(restaurants.flatMap((r) => r.tags)), [restaurants]);

  const visible = restaurants.filter(
    (r) =>
      (!filter.group || r.cuisine === filter.group) &&
      (!filter.tag || r.tags.includes(filter.tag)) &&
      (!filter.onlySelected || selected.has(r.id)) &&
      matchesQuery(filter.q, [r.name, r.cuisine, r.address, r.note, r.budgetText, ...r.tags]),
  );

  if (restaurants.length === 0) {
    return (
      <div className="empty-state">
        <EmptyPlate className="empty-art" />
        <p>还没有收藏的餐厅。</p>
        <p className="muted small">主厨在后台添加餐厅后，就能挑候选、随机抽一家啦。</p>
      </div>
    );
  }

  return (
    <div className="picker">
      <CatalogFilters
        value={filter}
        onChange={setFilter}
        groups={cuisines}
        tags={tags}
        groupLabel="按菜系和标签筛选"
        selectedCount={selected.size}
        placeholder="搜餐厅、菜系、地址或标签"
      />
      <p className="sr-only" aria-live="polite">
        找到 {visible.length} 家餐厅
      </p>
      {visible.length === 0 ? (
        <p className="muted empty-filter">没有符合条件的餐厅，换个关键词试试。</p>
      ) : (
        <ul className="card-grid">
          {visible.map((r) => {
            const isOn = selected.has(r.id);
            return (
              <li key={r.id} className={`food-card ${isOn ? 'is-selected' : ''}`}>
                <button type="button" className="food-card-main" aria-pressed={isOn} onClick={() => onToggle(r.id)}>
                  <ItemImage assetId={r.imageAssetId} name={r.name} kind="restaurant" />
                  <span className="food-card-text">
                    <span className="food-card-name">{r.name}</span>
                    <span className="food-card-meta">{[r.cuisine, r.budgetText].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="food-card-check" aria-hidden="true">
                    {isOn ? <Check /> : <Plus />}
                  </span>
                  <span className="sr-only">{isOn ? '已加入候选，点击移除' : '加入候选'}</span>
                </button>
                <button type="button" className="food-card-info" onClick={() => setDetail(r)} aria-label={`${r.name} 详情`}>
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
            <ItemImage assetId={detail.imageAssetId} name={detail.name} kind="restaurant" variant="full" className="detail-image" />
            <p className="muted">
              {[detail.cuisine, detail.budgetText, ...detail.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')}
            </p>
            {detail.address && <p>{detail.address}</p>}
            {detail.note && <p className="detail-desc">{detail.note}</p>}
            {detail.mapUrl && (
              <a className="btn btn-ghost" href={detail.mapUrl} target="_blank" rel="noopener noreferrer">
                <MapPin aria-hidden="true" />
                打开地图
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
              {selected.has(detail.id) ? '移出候选' : '加入候选'}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
