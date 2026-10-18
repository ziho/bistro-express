import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListPlus, Pencil, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import { keys, useVenueTags } from '../api/queries';
import { reconcileVenueTagFilter } from '../../../shared/tagManagement';
import { dishSearchFields } from '../../../shared/dish';
import { dishSummaryLines, SectionLabels } from '../components/DishBits';
import { Cloche } from '../components/Illustrations';
import { ItemImage } from '../components/ItemImage';
import { Loading } from '../components/Loading';
import { LocationLine, PurposeBadges, TagList } from '../components/RestaurantBits';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { dishSectionOptions } from '../lib/dishes';
import { restaurantSearchFields } from '../lib/restaurants';
import type { Restaurant } from '../../../shared/types';
import { activeFilterCount, emptyVenueFilter, filterVenues, sameVenueFilter, type VenueFilter } from '../../../shared/venueFilter';
import { VenueFilters } from '../components/VenueFilters';
import { ItemForm, type CatalogItem, type ItemKind } from './ItemForm';
import { ListPager, usePageFocus } from './ListPager';
import { changeFilter, changePage, clampPage, pageSlice, SHOP_PAGE_SIZE, type PagedFilter } from '../lib/pagination';
import { venueLocationOptions } from '../lib/venueForm';

const TEXT = {
  dish: {
    path: '/admin/dishes',
    noun: '菜品',
    unit: '道',
    add: '添加菜品',
    searchHint: '搜索菜名、分区、标签、介绍或主料',
    searchFields: (i: CatalogItem) => ('review' in i ? [i.name, ...i.tags] : dishSearchFields(i)),
  },
  restaurant: {
    path: '/admin/restaurants',
    noun: '店铺',
    unit: '家',
    add: '添加店铺',
    searchHint: '搜索店名、点评、标签、地区、地址或备注',
    searchFields: (i: CatalogItem) => ('review' in i ? restaurantSearchFields(i) : [i.name, ...i.tags]),
  },
};

function BulkImportLink() {
  return (
    <Link to="/admin/restaurants/import" className="btn btn-butter">
      <ListPlus aria-hidden="true" />
      批量导入
    </Link>
  );
}

function ItemSummary({ item }: { item: CatalogItem }) {
  if (!('review' in item)) {
    const { ingredients, facts } = dishSummaryLines(item);
    const tags = item.tags.map((x) => `#${x}`).join(' ');
    if (!item.sections.length && !ingredients && !facts && !tags) {
      return <span className="muted small">还没有分区、标签或主料</span>;
    }
    return (
      <>
        <SectionLabels sections={item.sections} />
        {ingredients && <span className="small admin-item-line">{ingredients}</span>}
        {(facts || tags) && <span className="muted small admin-item-line">{[facts, tags].filter(Boolean).join(' · ')}</span>}
      </>
    );
  }
  return (
    <>
      {item.review && <span className="small admin-item-review">{item.review}</span>}
      <span className="admin-item-line">
        <PurposeBadges purposes={item.purposes} />
      </span>
      <LocationLine location={item.location} className="small muted" />
      {item.tags.length > 0 ? <TagList tags={item.tags} className="tag-list-compact" /> : <span className="muted small">还没有分类标签</span>}
    </>
  );
}

export function CatalogAdmin({ kind }: { kind: ItemKind }) {
  const t = TEXT[kind];
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', kind], queryFn: () => api<CatalogItem[]>('GET', t.path), refetchInterval: kind === 'restaurant' ? 30_000 : false, refetchIntervalInBackground: false });
  const tagIndex = useVenueTags(kind === 'restaurant');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [section, setSection] = useState('');
  // Filter and page change together, so a new filter is on page 1 in the same render.
  const [venueList, setVenueList] = useState<PagedFilter<VenueFilter>>(() => ({ filter: emptyVenueFilter(null), page: 1 }));
  const venueFilter = venueList.filter;
  const setVenueFilter = (next: VenueFilter) => setVenueList((s) => changeFilter(s, next, sameVenueFilter));
  useEffect(() => {
    if (!tagIndex.data) return;
    setVenueList((s) => changeFilter(s, reconcileVenueTagFilter(s.filter, tagIndex.data.aliases), sameVenueFilter));
  }, [tagIndex.data]);
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', kind] });
    await queryClient.invalidateQueries({ queryKey: keys.catalog });
    if (kind === 'restaurant') await queryClient.invalidateQueries({ queryKey: keys.venueTags });
  };

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing && editing !== 'new'
        ? api<CatalogItem>('PUT', `${t.path}/${editing.id}`, { json: payload })
        : api<CatalogItem>('POST', t.path, { json: payload }),
    onSuccess: async () => {
      setEditing(null);
      toast('已保存', 'success');
      await refresh();
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const toggle = useMutation({
    mutationFn: (item: CatalogItem) => api('PATCH', `${t.path}/${item.id}/active`, { json: { active: !item.active } }),
    onSuccess: refresh,
    onError: (err) => toast(err instanceof ApiError ? err.message : '操作失败', 'error'),
  });

  const remove = useMutation({
    mutationFn: (item: CatalogItem) => api('DELETE', `${t.path}/${item.id}`),
    onSuccess: async () => {
      setDeleting(null);
      toast('已删除', 'success');
      await refresh();
    },
    onError: (err) => {
      setDeleting(null);
      toast(err instanceof ApiError ? err.message : '删除失败', 'error');
    },
  });

  const items = list.data ?? [];
  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags))].sort(), [items]);
  const allSections = useMemo(() => dishSectionOptions(items.flatMap((i) => ('review' in i ? [] : [i]))), [items]);
  const needle = q.trim().toLowerCase();
  const restaurants = useMemo(() => items.filter((i): i is Restaurant => 'review' in i), [items]);
  const locationOptions = useMemo(() => venueLocationOptions(restaurants), [restaurants]);
  // Every shop is filtered first; only the matches are cut into pages.
  const matchingVenues = useMemo(() => filterVenues(restaurants, venueFilter), [restaurants, venueFilter]);
  const venuePage = pageSlice(matchingVenues, venueList.page, SHOP_PAGE_SIZE);
  const pageFocus = usePageFocus<HTMLDivElement>(venuePage.page);
  const visible: CatalogItem[] = kind === 'restaurant' ? venuePage.items : items.filter(
    (i) =>
      (!section || ('sections' in i && i.sections.includes(section))) &&
      (!tag || i.tags.includes(tag)) &&
      (!needle || t.searchFields(i).some((f) => f.toLowerCase().includes(needle))),
  );
  const activeCount = items.filter((i) => i.active).length;

  // A deletion (or refresh) that empties the final page lands on the new last page.
  useEffect(() => {
    if (venuePage.page !== venueList.page) setVenueList((s) => changePage(s, venuePage.page));
  }, [venuePage.page, venueList.page]);

  const goToPage = (page: number) => {
    const next = clampPage(page, matchingVenues.length, SHOP_PAGE_SIZE);
    if (next === venuePage.page) return;
    pageFocus.request();
    setVenueList((s) => changePage(s, next));
  };
  const hasVenueCriteria = venueFilter.q.trim() !== '' || activeFilterCount(venueFilter) > 0 || venueFilter.purpose !== null;

  const openEditor = (item: CatalogItem | 'new') => {
    setFormError(null);
    setEditing(item);
  };

  if (list.isPending) return <Loading />;
  if (list.isError) return <p className="error-text">加载失败：{list.error.message}</p>;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{t.noun}</h1>
          <p className="muted small">
            共 {items.length} {t.unit}，上架 {activeCount} {t.unit}
          </p>
        </div>
        <div className="head-actions">
          {kind === 'restaurant' && <><Link to="/admin/restaurants/tags" className="btn btn-ghost"><Tags aria-hidden="true" />标签管理</Link><BulkImportLink /></>}
          <button type="button" className="btn btn-primary" onClick={() => openEditor('new')}>
            <Plus aria-hidden="true" />
            {t.add}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="onboarding card">
          <Cloche className="onboarding-art" />
          <h2>{kind === 'dish' ? '还没有菜品，先上几道拿手菜吧' : '还没有店铺，把想去的餐厅、饮品甜品店收藏进来吧'}</h2>
          <ol className="onboarding-steps">
            <li>点「{t.add}」，填写名字（必填），可以拍照上传。</li>
            <li>
              {kind === 'dish'
                ? '可以选几个菜单分区（如「配饭菜」「汤羹」）、加些标签（如「快手」「下饭」）；主料、耗时和采购提醒都能以后再补。'
                : '前台入口决定店铺出现在哪儿；分类标签只填一遍，例如「日料」「咖啡」「约会」。地区、菜单和照片可以之后再补。'}
            </li>
            <li>暂时不想被选到的，可以随时「下架」，历史记录不受影响。</li>
            {kind === 'restaurant' && <li>收藏了很多 Google 地图链接？用「批量导入」一次粘贴最多 100 个。</li>}
          </ol>
          <div className="head-actions">
            <button type="button" className="btn btn-primary" onClick={() => openEditor('new')}>
              <Plus aria-hidden="true" />
              {t.add}
            </button>
            {kind === 'restaurant' && <BulkImportLink />}
          </div>
        </div>
      ) : (
        <>
          {kind === 'restaurant' ? (
            <VenueFilters venues={restaurants} value={venueFilter} onChange={setVenueFilter} placeholder={t.searchHint} purposeChoice />
          ) : (
            <div className="filters">
              <div className="search-box">
                <Search aria-hidden="true" />
                <label htmlFor="admin-search" className="sr-only">
                  搜索{t.noun}
                </label>
                <input id="admin-search" type="search" className="input" placeholder={t.searchHint} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {allTags.length + allSections.length > 0 && (
                <div className="chip-scroller" role="group" aria-label={kind === 'dish' ? '按菜单分区和标签筛选' : '按标签筛选'}>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={!tag && !section}
                    onClick={() => {
                      setTag('');
                      setSection('');
                    }}
                  >
                    全部
                  </button>
                  {allSections.map((s) => (
                    <button key={`s-${s}`} type="button" className="chip" aria-pressed={section === s} onClick={() => setSection(section === s ? '' : s)}>
                      {s}
                    </button>
                  ))}
                  {allTags.map((tg) => (
                    <button key={tg} type="button" className="chip chip-tag" aria-pressed={tag === tg} onClick={() => setTag(tag === tg ? '' : tg)}>
                      #{tg}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div
            ref={pageFocus.target}
            className="list-page-region"
            tabIndex={-1}
            role={kind === 'restaurant' ? 'region' : undefined}
            aria-label={kind === 'restaurant' ? `店铺列表，第 ${venuePage.page} / ${venuePage.totalPages} 页` : undefined}
          >
            <ul className="admin-list">
              {visible.map((item) => {
                // Text-first: no placeholder thumbnail when there is no real photo.
                const showThumb = item.imageAssetId !== null;
                return (
                  <li key={item.id} className={`admin-item card ${item.active ? '' : 'is-inactive'} ${showThumb ? '' : 'no-thumb'}`}>
                    {showThumb && <ItemImage assetId={item.imageAssetId} name={item.name} kind={kind} className="admin-thumb" />}
                    <div className="admin-item-text">
                      <strong>{item.name}</strong>
                      <ItemSummary item={item} />
                    </div>
                    <label className="switch-row compact">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={item.active}
                        onChange={() => toggle.mutate(item)}
                        aria-label={`${item.name} ${item.active ? '上架中' : '已下架'}`}
                      />
                      <span className="switch" aria-hidden="true" />
                      <span className="small">{item.active ? '上架' : '下架'}</span>
                    </label>
                    <div className="admin-item-actions">
                      <button type="button" className="icon-btn" aria-label={`编辑 ${item.name}`} onClick={() => openEditor(item)}>
                        <Pencil aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`删除 ${item.name}`} onClick={() => setDeleting(item)}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          {kind === 'restaurant' ? (
            <>
              {venuePage.total === 0 && (
                <div className="empty-filter">
                  <p className="muted">
                    {hasVenueCriteria ? `${items.length} 家店铺里没有符合当前搜索和筛选的，换个关键词或减少条件试试。` : `没有符合条件的${t.noun}。`}
                  </p>
                  {hasVenueCriteria && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVenueFilter(emptyVenueFilter(null))}>
                      清除搜索和筛选
                    </button>
                  )}
                </div>
              )}
              {venuePage.total > 0 && <ListPager slice={venuePage} label="店铺列表分页" unit={t.unit} onGo={goToPage} />}
            </>
          ) : (
            visible.length === 0 && <p className="muted">没有符合条件的{t.noun}。</p>
          )}
        </>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t.add : `编辑${t.noun}`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="submit" form="item-form" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {editing !== null && (
          <ItemForm
            key={editing === 'new' ? 'new' : editing.id}
            kind={kind}
            item={editing === 'new' ? null : editing}
            busy={save.isPending}
            serverError={formError}
            tagSuggestions={allTags}
            sectionSuggestions={allSections}
            locationOptions={locationOptions}
            onSubmit={(payload) => {
              setFormError(null);
              save.mutate(payload);
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`删除「${deleting?.name ?? ''}」？`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary btn-danger-solid" onClick={() => deleting && remove.mutate(deleting)} disabled={remove.isPending}>
              删除
            </button>
          </>
        }
      >
        <p>只有从没出现在任何计划里的{t.noun}可以彻底删除。出现过的请改为「下架」，历史记录会保留原样。</p>
      </Sheet>
    </div>
  );
}
