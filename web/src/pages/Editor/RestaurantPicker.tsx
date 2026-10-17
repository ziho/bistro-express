import { Check, Info, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { Restaurant, VenuePurpose } from '../../../../shared/types';
import { filterVenues, placeTree, tagChoices, type VenueFilter } from '../../../../shared/venueFilter';
import { EmptyPlate } from '../../components/Illustrations';
import { ItemImage } from '../../components/ItemImage';
import { LocationLine, MapLinkButton, PurposeBadges, RestaurantLinkRows, RestaurantQuickLinks, TagList } from '../../components/RestaurantBits';
import { Sheet } from '../../components/Sheet';
import { collectPlaceKeys, VenueFilters } from '../../components/VenueFilters';
import { loadVenueFilter, saveVenueFilter } from '../../lib/venueFilterStore';

interface Props {
  restaurants: Restaurant[];
  /** Only venues serving this purpose are offered (a mixed venue appears for both). */
  purpose: VenuePurpose;
  candidateIds: string[];
  onToggle: (id: string) => void;
}

/** The remembered filters of this purpose, limited to tags and places that still exist. */
function initialFilter(purpose: VenuePurpose, venues: Restaurant[]): VenueFilter {
  return loadVenueFilter(purpose, {
    tags: new Set(tagChoices(venues).map((t) => t.tag)),
    places: collectPlaceKeys(placeTree(venues).nodes, new Set(['unknown'])),
  });
}

export function RestaurantPicker({ restaurants, purpose, candidateIds, onToggle }: Props) {
  const idPrefix = useId();
  const offered = useMemo(() => restaurants.filter((r) => r.purposes.includes(purpose)), [restaurants, purpose]);
  const [filter, setFilter] = useState<VenueFilter>(() => initialFilter(purpose, offered));
  const [detail, setDetail] = useState<Restaurant | null>(null);
  const selected = useMemo(() => new Set(candidateIds), [candidateIds]);

  // Switching between 去吃饭 and 饮品甜品 brings back that purpose's own remembered filters.
  useEffect(() => {
    setFilter((f) => (f.purpose === purpose ? f : initialFilter(purpose, offered)));
  }, [purpose, offered]);

  const applyFilter = (next: VenueFilter) => {
    setFilter(next);
    saveVenueFilter(purpose, next);
  };

  const visible = filterVenues(offered, { ...filter, purpose }, selected);
  const noun = purpose === 'treat' ? '饮品甜品店' : '餐厅';

  if (offered.length === 0) {
    return (
      <div className="empty-state">
        <EmptyPlate className="empty-art" />
        <p>还没有收藏的{noun}。</p>
        <p className="muted small">
          {purpose === 'treat'
            ? '主厨在后台把店标记为「饮品甜品」后，就能在这里挑候选。'
            : '主厨在后台添加餐厅后，就能挑候选、随机抽一家啦。'}
        </p>
      </div>
    );
  }

  return (
    <div className="picker">
      <VenueFilters
        venues={offered}
        value={filter}
        onChange={applyFilter}
        selected={selected}
        placeholder="搜店名、点评、标签、地区、地址或预算"
      />
      <p className="sr-only" aria-live="polite">
        找到 {visible.length} 家{noun}
      </p>
      {visible.length === 0 ? (
        <p className="muted empty-filter">没有符合条件的{noun}，换个关键词或减少筛选条件试试。</p>
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
          <LocationLine location={r.location} className="rest-card-meta" />
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
      <PurposeBadges purposes={r.purposes} />
      <LocationLine location={r.location} />
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
