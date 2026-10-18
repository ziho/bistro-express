import { ArrowLeft, Merge, Pencil, Search, Tags } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import type { VenueTagChange, VenueTagPreview, VenueTagResult } from '../../../shared/tagManagement';
import { api, ApiError } from '../api/client';
import { keys, useVenueTags } from '../api/queries';
import { Loading } from '../components/Loading';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { pageSlice } from '../lib/pagination';
import { ListPager, usePageFocus } from './ListPager';

function TagChangeDialog({ sources, initialTarget, tags, onClose, onSaved }: {
  sources: string[]; initialTarget: string; tags: string[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [target, setTarget] = useState(initialTarget);
  const currentTarget = useRef(target); currentTarget.current = target;
  const [preview, setPreview] = useState<VenueTagPreview | null>(null);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<{ key: string; json: VenueTagChange & { expectedFingerprint: string } } | null>(null);
  const rename = sources.length === 1;
  const inspect = useMutation({
    mutationFn: (change: VenueTagChange) => api<VenueTagPreview>('POST', '/admin/restaurant-tags/preview', { json: change }),
    onSuccess: (p, sent) => { if (currentTarget.current.trim() === sent.target) { setPreview(p); setError(''); } },
    onError: (e, sent) => { if (currentTarget.current.trim() === sent.target) setError(e instanceof ApiError ? e.message : '暂时无法查看影响范围，请重试'); },
  });
  const apply = useMutation({
    mutationFn: (sent: NonNullable<typeof request>) => api<VenueTagResult>('POST', '/admin/restaurant-tags/apply', { json: sent.json, idempotencyKey: sent.key }),
    onSuccess: async (result) => { await onSaved(); toast(`已更新 ${result.affected} 家店铺的标签`, 'success'); onClose(); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'tags_changed') { setPreview(null); setRequest(null); }
      // An unanswered write keeps the exact key/body. Retrying cannot apply a second change.
      setError(e instanceof ApiError ? e.message : '结果还没确认，请重新提交同一次修改');
    },
  });
  const submit = () => {
    if (!preview || apply.isPending) return;
    const sent = request ?? { key: crypto.randomUUID(), json: { sources, target: preview.target, expectedFingerprint: preview.fingerprint } };
    setRequest(sent); apply.mutate(sent);
  };
  const locked = apply.isPending || request !== null;
  return <Sheet open onClose={() => { if (!apply.isPending) onClose(); }} title={rename ? '重命名标签' : '合并标签'} footer={<>
    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={apply.isPending}>取消</button>
    {preview ? <button type="button" className="btn btn-primary" onClick={submit} disabled={apply.isPending}>
      {apply.isPending ? '更新中…' : request ? '重新提交' : preview.targetCount > 0 || !rename ? '确认合并' : '确认重命名'}
    </button> : <button type="button" className="btn btn-primary" disabled={!target.trim() || sources.every((s) => s === target.trim()) || inspect.isPending} onClick={() => { setError(''); inspect.mutate({ sources, target: target.trim() }); }}>
      {inspect.isPending ? '计算中…' : '查看影响'}
    </button>}
  </>}>
    <p className="small muted">{rename ? '当前标签' : '已选标签'}：{sources.join('、')}</p>
    <div className="field">
      <label className="field-label" htmlFor="tag-change-target">{rename ? '新名称' : '合并后的名称'}</label>
      <input id="tag-change-target" className="input" value={target} maxLength={LIMITS.tag} list="tag-target-options" disabled={locked}
        onChange={(e) => { setTarget(e.target.value); setPreview(null); setError(''); }} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (target.trim() && !locked && !inspect.isPending) inspect.mutate({ sources, target: target.trim() }); }
        }} />
      <datalist id="tag-target-options">{tags.map((tag) => <option key={tag} value={tag} />)}</datalist>
      <p className="field-hint">可以用已有标签，也可以起新名称。选已有名称会合并，店铺里相同标签只保留一个。</p>
    </div>
    {preview && <div className="tag-change-preview" role="status">
      <strong>将更新 {preview.affected} 家店铺{preview.inactive ? `（其中 ${preview.inactive} 家已下架）` : ''}</strong>
      <p>修改后，使用「{preview.target}」的共 {preview.resultCount} 家{preview.overlap ? `；${preview.overlap} 家原本已同时使用，会自动去重` : ''}。</p>
      <ul>{preview.shops.map((shop) => <li key={shop.id}>{shop.name}{shop.active ? '' : '（已下架）'}</li>)}</ul>
      {preview.moreShops > 0 && <p className="small muted">另有 {preview.moreShops} 家。</p>}
      <p className="small muted">已有筛选会跟着新名称更新；以后输入旧名称，也会自动使用新名称。历史安排保留当时的记录。</p>
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </Sheet>;
}

export function VenueTagsAdmin() {
  const index = useVenueTags();
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ sources: string[]; target: string } | null>(null);
  const tags = index.data?.tags ?? [];
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => tags.filter((tag) => [tag.name, ...tag.oldNames].some((name) => name.toLowerCase().includes(needle))), [tags, needle]);
  const slice = pageSlice(filtered, page, 20);
  const focus = usePageFocus<HTMLDivElement>(slice.page);
  const wanted = selected.filter((name) => tags.some((tag) => tag.name === name));
  const toggle = (name: string) => setSelected((list) => list.includes(name) ? list.filter((tag) => tag !== name) : list.length < 50 ? [...list, name] : list);
  const refresh = async () => {
    setSelected([]);
    await Promise.all([
      client.invalidateQueries({ queryKey: keys.venueTags }), client.invalidateQueries({ queryKey: ['admin', 'restaurant'] }),
      client.invalidateQueries({ queryKey: keys.catalog }),
    ]);
  };
  return <div className="admin-page tag-admin">
    <Link className="back-link" to="/admin/restaurants"><ArrowLeft aria-hidden="true" />返回店铺</Link>
    <div className="admin-page-head"><div><h1><Tags aria-hidden="true" />标签管理</h1><p className="muted small">共 {tags.length} 个标签。重命名或合并后，相关店铺和标签筛选一起更新。</p></div></div>
    <div className="search-box"><Search aria-hidden="true" /><label className="sr-only" htmlFor="tag-manager-search">搜索标签或旧名称</label>
      <input id="tag-manager-search" type="search" className="input" placeholder="搜索标签或旧名称" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
    <div className="tag-admin-toolbar"><span className="small muted">已选 {wanted.length} 个{wanted.length >= 50 ? '（最多 50 个）' : ''}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!wanted.length} onClick={() => setSelected([])}>取消选择</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={!wanted.length} onClick={() => setEdit({ sources: wanted, target: '' })}><Merge aria-hidden="true" />合并已选</button>
    </div>
    {index.isPending ? <Loading /> : index.isError ? <p className="error-text" role="alert">标签加载失败，请刷新重试。</p> : <>
      <div ref={focus.target} tabIndex={-1} role="region" aria-label="标签列表" className="tag-admin-list list-page-region">
        {slice.items.length === 0 && <p className="muted">{tags.length ? '没有找到这个标签。' : '还没有店铺标签，可以先在店铺里添加。'}</p>}
        {slice.items.map((tag) => <div key={tag.name} className="tag-admin-row">
          <label className="tag-admin-choice"><input type="checkbox" checked={wanted.includes(tag.name)} disabled={wanted.length >= 50 && !wanted.includes(tag.name)} onChange={() => toggle(tag.name)} />
            <span><strong>{tag.name}</strong><span className="small muted">{tag.count} 家店铺 · {tag.activeCount} 家上架</span>
              {tag.oldNames.length > 0 && <span className="small muted">旧名称：{tag.oldNames.join('、')}</span>}
            </span>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`重命名标签 ${tag.name}`} onClick={() => setEdit({ sources: [tag.name], target: tag.name })}><Pencil aria-hidden="true" /><span>重命名</span></button>
        </div>)}
      </div>
      <ListPager slice={slice} label="标签列表分页" unit="个" onGo={(next) => { focus.request(); setPage(next); }} />
    </>}
    {edit && <TagChangeDialog key={edit.sources.join('\0')} sources={edit.sources} initialTarget={edit.target} tags={tags.map((tag) => tag.name)} onClose={() => setEdit(null)} onSaved={refresh} />}
  </div>;
}
