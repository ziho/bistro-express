import { Check, Info, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Restaurant } from '../../../../shared/types';
import { EmptyPlate } from '../../components/Illustrations';
import { ItemImage } from '../../components/ItemImage';
import { MapLinkButton, RestaurantLinkRows, RestaurantQuickLinks, TagList } from '../../components/RestaurantBits';
import { Sheet } from '../../components/Sheet';
import { filterRestaurants } from '../../lib/restaurants';
import { CatalogFilters, emptyFilter, type FilterState } from './CatalogFilters';

interface Props {
  restaurants: Restaurant[];
  candidateIds: string[];
  onToggle: (id: string) => void;
}

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));

export function RestaurantPicker({ restaurants, candidateIds, onToggle }: Props) {
  const idPrefix = useId();
  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [detail, setDetail] = useState<Restaurant | null>(null);
  const selected = useMemo(() => new Set(candidateIds), [candidateIds]);
  const tags = useMemo(() => uniqueSorted(restaurants.flatMap((r) => r.tags)), [restaurants]);

  const visible = filterRestaurants(restaurants, filter, selected);

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
        groups={[]}
        tags={tags}
        groupLabel="按分类标签筛选"
        selectedCount={selected.size}
        placeholder="搜店名、点评、标签、地址或预算"
      />
      <p className="sr-only" aria-live="polite">
        找到 {visible.length} 家餐厅
      </p>
      {visible.length === 0 ? (
        <p className="muted empty-filter">没有符合条件的餐厅，换个关键词试试。</p>
      ) : (
        <ul className="rest-grid">
          {visible.map((r) => (
            <RestaurantCard
              key={r.id}
              restaurant={r}
              nameId={`${idPrefix}-${r.id}`}
              selected={selected.has(r.id)}
              onToggle={() => onToggle(r.id)}
              onDetail={() => setDetail(r)}
            />
          ))}
        </ul>
      )}

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <RestaurantDetail
            restaurant={detail}
            selected={selected.has(detail.id)}
            onToggle={() => {
              onToggle(detail.id);
              setDetail(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

const metaText = (r: Restaurant) => [r.budgetText, r.address].filter(Boolean).join(' · ');

interface CardProps {
  restaurant: Restaurant;
  nameId: string;
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

/** Text-first card: the name may wrap over several lines; a photo is shown only when one exists. */
function RestaurantCard({ restaurant: r, nameId, selected, onToggle, onDetail }: CardProps) {
  const meta = metaText(r);
  return (
    <li className={`rest-card ${selected ? 'is-selected' : ''}`}>
      <div className="rest-card-body">
        {r.imageAssetId && <ItemImage assetId={r.imageAssetId} name={r.name} kind="restaurant" className="rest-card-photo" />}
        <div className="rest-card-text">
          <h3 id={nameId} className="rest-card-name">
            {r.name}
          </h3>
          {r.review && <p className="rest-card-review">{r.review}</p>}
          <TagList tags={r.tags} />
          {meta && <p className="rest-card-meta">{meta}</p>}
        </div>
      </div>
      <RestaurantQuickLinks links={r.links} name={r.name} onShowAll={onDetail} />
      <div className="rest-card-actions">
        <button
          type="button"
          className={`btn btn-sm btn-wrap rest-card-select ${selected ? 'btn-primary' : ''}`}
          aria-pressed={selected}
          aria-describedby={nameId}
          onClick={onToggle}
        >
          {selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          <span>{selected ? '已加入候选' : '加入候选'}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" aria-describedby={nameId} onClick={onDetail}>
          <Info aria-hidden="true" />
          详情
        </button>
      </div>
    </li>
  );
}

function RestaurantDetail({ restaurant: r, selected, onToggle }: { restaurant: Restaurant; selected: boolean; onToggle: () => void }) {
  return (
    <div className="detail">
      {r.imageAssetId && <ItemImage assetId={r.imageAssetId} name={r.name} kind="restaurant" variant="full" className="detail-image detail-photo" />}
      {r.review && <p className="detail-review">{r.review}</p>}
      <TagList tags={r.tags} />
      {(r.budgetText || r.address) && (
        <dl className="detail-facts">
          {r.budgetText && (
            <div>
              <dt>预算</dt>
              <dd>{r.budgetText}</dd>
            </div>
          )}
          {r.address && (
            <div>
              <dt>地址</dt>
              <dd>{r.address}</dd>
            </div>
          )}
        </dl>
      )}
      {r.note && (
        <div>
          <h3 className="detail-subtitle">备注</h3>
          <p className="detail-desc">{r.note}</p>
        </div>
      )}
      {r.links.length > 0 && (
        <div>
          <h3 className="detail-subtitle">相关链接</h3>
          <RestaurantLinkRows links={r.links} name={r.name} />
        </div>
      )}
      {r.mapUrl && (
        <div className="link-actions">
          <MapLinkButton mapUrl={r.mapUrl} className="btn btn-ghost" />
        </div>
      )}
      <button type="button" className={`btn ${selected ? 'btn-ghost' : 'btn-primary'} btn-block`} onClick={onToggle}>
        {selected ? '移出候选' : '加入候选'}
      </button>
    </div>
  );
}
