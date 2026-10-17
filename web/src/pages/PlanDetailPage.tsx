import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Clock, Globe2, PartyPopper, Pencil, Repeat2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { formatDateLabel } from '../../../shared/time';
import { hasDishExtras } from '../../../shared/dish';
import type { DishSnapshot, Plan, RestaurantSnapshot } from '../../../shared/types';
import { OUTING_LABEL, outingKind } from '../../../shared/venue';
import { OutingIcon, outingClass } from '../components/OutingIcon';
import { api, ApiError, newIdempotencyKey } from '../api/client';
import { keys, useCatalog, usePlan } from '../api/queries';
import { DishInfo, dishSummaryLines, SectionLabels } from '../components/DishBits';
import { ItemImage } from '../components/ItemImage';
import { Loading } from '../components/Loading';
import { NotificationBadge, SavedBadge } from '../components/NotificationBadge';
import { LocationLine, MapLinkButton, RestaurantLinkRows, TagList } from '../components/RestaurantBits';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { saveDraft } from '../lib/drafts';
import { useToday } from '../lib/hooks';
import { cloneToDraft, isEditable, planDisplay } from '../lib/planView';
import { NotFoundPage } from './NotFoundPage';
import { PlanCalendar } from './PlanCalendar';
import { ShoppingSection } from './Shopping/ShoppingSection';

/** The restaurant as it was frozen in the plan; the photo is shown only when there is one. */
function ChosenRestaurant({ restaurant: r }: { restaurant: RestaurantSnapshot }) {
  const meta = [r.budgetText, r.address].filter(Boolean).join(' · ');
  return (
    <div className="chosen-restaurant">
      {r.imageAssetId && <ItemImage assetId={r.imageAssetId} name={r.name} kind="restaurant" />}
      <div className="chosen-text">
        <strong className="chosen-name">{r.name}</strong>
        {r.review && <p className="chosen-review">{r.review}</p>}
        <LocationLine location={r.location} className="small" />
        <TagList tags={r.tags} />
        {meta && <p className="muted small">{meta}</p>}
        <RestaurantLinkRows links={r.links} name={r.name} />
        {r.mapUrl && (
          <div className="link-actions">
            <MapLinkButton mapUrl={r.mapUrl} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One dish as frozen in the plan: text-first, a small photo only when there is one. Recorded
 * ingredients, purchase notes, description and recipe link sit behind a per-dish disclosure.
 */
function PlanDishRow({ dish: d }: { dish: DishSnapshot }) {
  const { ingredients, facts } = dishSummaryLines(d);
  const hasMore = hasDishExtras(d);
  return (
    <li className="plan-dish">
      <div className="plan-dish-head">
        {d.imageAssetId && <ItemImage assetId={d.imageAssetId} name={d.name} className="plan-dish-photo" />}
        <div className="plan-dish-text">
          <h3 className="plan-dish-name">{d.name}</h3>
          <SectionLabels sections={d.sections} />
          {ingredients && <p className="plan-dish-line">{ingredients}</p>}
          {facts && <p className="plan-dish-line muted">{facts}</p>}
        </div>
      </div>
      {hasMore && (
        <details className="plan-dish-more">
          <summary>
            查看详情<span className="sr-only">：{d.name}</span>
          </summary>
          <DishInfo dish={d} heading="h4" compact />
        </details>
      )}
    </li>
  );
}

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
      toast('安排已取消，会发送通知', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toast('这次安排刚在别处改过，已换成最新内容', 'error');
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
        返回安排
      </Link>

      {justSaved && (
        <div className="saved-celebration" role="status">
          <PartyPopper aria-hidden="true" />
          <span>
            {justSaved === 'updated' ? '改好啦。' : '安排好啦，好吃的有着落了。'}
            {p.notification?.status === 'unconfigured' ? '通知渠道还没配置，主厨暂时收不到推送。' : '通知正在安排发送。'}
          </span>
        </div>
      )}

      <header className="plan-detail-head card">
        <div className={`plan-detail-mode ${outingClass(p)}`} aria-hidden="true">
          <OutingIcon plan={p} />
        </div>
        <div className="plan-detail-title">
          <p className="muted small">
            #{p.shortId} · 第 {p.version} 版
          </p>
          <h1>
            {p.mealLabel}
            <span className="muted"> · {OUTING_LABEL[outingKind(p)]}</span>
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
          <ul className="plan-dish-list">
            {p.dishes.map((d, index) => (
              <PlanDishRow key={`${index}-${d.id}`} dish={d} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="card" aria-labelledby="rest-title">
          <h2 id="rest-title" className="section-title">
            {outingKind(p) === 'treat' ? '选中的店' : '选中的餐厅'}
          </h2>
          {p.selectedRestaurant && <ChosenRestaurant restaurant={p.selectedRestaurant} />}
          {p.candidates.length > 1 && (
            <p className="muted small wrap-anywhere">候选：{p.candidates.map((c) => c.name).join('、')}</p>
          )}
        </section>
      )}

      {p.note && (
        <section className="card">
          <h2 className="section-title">备注</h2>
          <p className="pre-wrap">{p.note}</p>
        </section>
      )}

      {p.mode === 'home' && <ShoppingSection plan={p} />}

      <PlanCalendar plan={p} />

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
        这里先记想吃的，还不算打卡记录。保存于 {new Date(p.updatedAt).toLocaleString('zh-CN')}
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
