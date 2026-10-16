import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Clock, Globe2, Home, MapPin, PartyPopper, Pencil, Repeat2, Store } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { formatDateLabel } from '../../../shared/time';
import type { Plan } from '../../../shared/types';
import { api, ApiError, newIdempotencyKey } from '../api/client';
import { keys, useCatalog, usePlan } from '../api/queries';
import { ItemImage } from '../components/ItemImage';
import { Loading } from '../components/Loading';
import { NotificationBadge, SavedBadge } from '../components/NotificationBadge';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { saveDraft } from '../lib/drafts';
import { useToday } from '../lib/hooks';
import { cloneToDraft, isEditable, planDisplay } from '../lib/planView';
import { NotFoundPage } from './NotFoundPage';

export function PlanDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const today = useToday();
  const plan = usePlan(id);
  const catalog = useCatalog();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelKey] = useState(newIdempotencyKey);
  const justSaved = (location.state as { justSaved?: string } | null)?.justSaved;

  if (plan.isPending) return <Loading />;
  if (plan.isError || !plan.data) {
    if (plan.error instanceof ApiError && plan.error.status === 404) return <NotFoundPage />;
    return <p className="error-text page-pad">加载失败：{plan.error?.message}</p>;
  }
  const p = plan.data;
  const view = planDisplay(p);
  const editable = isEditable(p);

  const cancel = async () => {
    setBusy(true);
    try {
      const updated = await api<Plan>('POST', `/plans/${p.id}/cancel`, {
        json: { expectedVersion: p.version },
        idempotencyKey: cancelKey,
      });
      queryClient.setQueryData(keys.plan(p.id), updated);
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast('计划已取消，会通知主厨', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toast('这个计划刚在别处被改过，已刷新到最新版本', 'error');
        await queryClient.invalidateQueries({ queryKey: keys.plan(p.id) });
      } else {
        toast(err instanceof ApiError ? err.message : '取消失败', 'error');
      }
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  const again = () => {
    if (!catalog.data) return;
    const { draft, dropped } = cloneToDraft(p, catalog.data, today);
    saveDraft(draft);
    if (dropped.length) toast(`${dropped.join('、')} 已下架，没有带过来`, 'info');
    navigate(`/plans/new?draft=${encodeURIComponent(draft.key)}`);
  };

  return (
    <article className="plan-detail">
      <Link to="/" className="back-link">
        <ArrowLeft aria-hidden="true" />
        返回计划
      </Link>

      {justSaved && (
        <div className="saved-celebration" role="status">
          <PartyPopper aria-hidden="true" />
          <span>
            {justSaved === 'updated' ? '修改已保存！' : '已保存！'}
            {p.notification?.status === 'unconfigured' ? '通知渠道还没配置，主厨暂时收不到推送。' : '通知会在后台发送。'}
          </span>
        </div>
      )}

      <header className="plan-detail-head card">
        <div className={`plan-detail-mode mode-${p.mode}`} aria-hidden="true">
          {p.mode === 'home' ? <Home /> : <Store />}
        </div>
        <div className="plan-detail-title">
          <p className="muted small">
            #{p.shortId} · 第 {p.version} 版
          </p>
          <h1>
            {p.mealLabel}
            <span className="muted"> · {p.mode === 'home' ? '在家吃' : '去餐厅'}</span>
          </h1>
          <p className="plan-detail-when">
            {formatDateLabel(view.date)}
            {view.time && (
              <span>
                <Clock aria-hidden="true" className="inline-icon" /> {view.time}
              </span>
            )}
          </p>
          {view.originDetail && (
            <p className="muted small">
              <Globe2 aria-hidden="true" className="inline-icon" /> {view.originDetail}
            </p>
          )}
          <div className="badge-row">
            <SavedBadge cancelled={p.status === 'cancelled'} />
            <NotificationBadge notification={p.notification} />
            {!editable && p.status === 'active' && <span className="badge badge-off">已过去 · 只读</span>}
          </div>
        </div>
      </header>

      {p.mode === 'home' ? (
        <section className="card" aria-labelledby="dishes-title">
          <h2 id="dishes-title" className="section-title">
            想吃的菜（{p.dishes.length}）
          </h2>
          <ul className="snapshot-grid">
            {p.dishes.map((d) => (
              <li key={d.id} className="snapshot-item">
                <ItemImage assetId={d.imageAssetId} name={d.name} />
                <span>
                  <strong>{d.name}</strong>
                  {d.category && <span className="muted small block">{d.category}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card" aria-labelledby="rest-title">
          <h2 id="rest-title" className="section-title">
            选中的餐厅
          </h2>
          {p.selectedRestaurant && (
            <div className="chosen-restaurant">
              <ItemImage assetId={p.selectedRestaurant.imageAssetId} name={p.selectedRestaurant.name} kind="restaurant" />
              <div>
                <strong className="chosen-name">{p.selectedRestaurant.name}</strong>
                <p className="muted small">
                  {[p.selectedRestaurant.cuisine, p.selectedRestaurant.budgetText].filter(Boolean).join(' · ')}
                </p>
                {p.selectedRestaurant.address && <p className="small">{p.selectedRestaurant.address}</p>}
                {p.selectedRestaurant.mapUrl && (
                  <a className="btn btn-ghost btn-sm" href={p.selectedRestaurant.mapUrl} target="_blank" rel="noopener noreferrer">
                    <MapPin aria-hidden="true" /> 打开地图
                  </a>
                )}
              </div>
            </div>
          )}
          {p.candidates.length > 1 && (
            <p className="muted small">候选：{p.candidates.map((c) => c.name).join('、')}</p>
          )}
        </section>
      )}

      {p.note && (
        <section className="card">
          <h2 className="section-title">备注</h2>
          <p className="pre-wrap">{p.note}</p>
        </section>
      )}

      <div className="detail-actions">
        {editable && (
          <>
            <Link className="btn btn-primary" to={`/plans/${p.id}/edit`}>
              <Pencil aria-hidden="true" /> 修改
            </Link>
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirmCancel(true)}>
              <Ban aria-hidden="true" /> 取消这一餐
            </button>
          </>
        )}
        <button type="button" className="btn btn-butter" onClick={again} disabled={!catalog.data}>
          <Repeat2 aria-hidden="true" /> 再来一顿
        </button>
      </div>
      <p className="muted small">
        计划记录的是想吃什么，不代表已经吃过或去过。保存于 {new Date(p.updatedAt).toLocaleString('zh-CN')}
      </p>

      <Sheet
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="取消这一餐？"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)} disabled={busy}>
              再想想
            </button>
            <button type="button" className="btn btn-primary btn-danger-solid" onClick={() => void cancel()} disabled={busy}>
              {busy ? '取消中…' : '确定取消'}
            </button>
          </>
        }
      >
        <p>取消后会通知主厨，计划会保留在记录里但不能再修改。</p>
      </Sheet>
    </article>
  );
}
