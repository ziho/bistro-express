import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, ListChecks, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LIMITS } from '../../../../shared/constants';
import { isPastDate } from '../../../../shared/time';
import type { Catalog, Plan } from '../../../../shared/types';
import { OUTING_CHOICE_LABEL, outingFromKind, PURPOSE_LABEL, type OutingKind } from '../../../../shared/venue';
import { api, ApiError, newIdempotencyKey } from '../../api/client';
import { keys, useCatalog, usePlan } from '../../api/queries';
import { Loading } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { deleteDraft, draftToInput, saveDraft, type Draft } from '../../lib/drafts';
import { useMediaQuery, useToday } from '../../lib/hooks';
import { isEditable } from '../../lib/planView';
import { draftOuting, incompatibleCandidates, withOuting } from '../../lib/outing';
import { DishPicker } from './DishPicker';
import { MealMetaForm, timeProblem } from './MealMetaForm';
import { RestaurantPicker } from './RestaurantPicker';
import { ReviewDialog } from './ReviewDialog';
import { SelectionSummary } from './SelectionSummary';
import { ShoppingPreviewSheet } from './ShoppingPreviewSheet';
import { useEditorDraft } from './useEditorDraft';

const PICKER_TITLE: Record<OutingKind, string> = {
  home: '今天在家吃什么',
  restaurant: '想去哪几家',
  treat: '想去哪家喝点、吃点甜的',
};

type FieldErrors = Partial<Record<'date' | 'mealLabel' | 'localTime', string>>;

function validate(draft: Draft, catalog: Catalog): { fields: FieldErrors; general: string | null } {
  const activeIds = { dishes: new Set(catalog.dishes.map((d) => d.id)), restaurants: new Set(catalog.restaurants.map((r) => r.id)) };
  const fields: FieldErrors = {};
  if (!draft.mealLabel.trim()) fields.mealLabel = '给这一餐起个名字，比如「晚餐」';
  if (isPastDate(draft.date, draft.timeZone)) fields.date = '不能安排已经过去的日期';
  const tp = timeProblem(draft);
  if (tp) fields.localTime = tp;
  let general: string | null = null;
  if (draft.mode === 'home') {
    if (draft.dishIds.length === 0) general = '至少选一道菜';
    else if (draft.dishIds.some((id) => !activeIds.dishes.has(id))) general = '有菜已经下架，请先移除';
  } else if (draft.candidateIds.length === 0) general = '至少加入一家候选餐厅';
  else if (draft.candidateIds.some((id) => !activeIds.restaurants.has(id))) general = '有餐厅已经下架，请先移除';
  else if (incompatibleCandidates(draft.candidateIds, catalog.restaurants, draft.purpose).length) {
    general = `有店不适合「${PURPOSE_LABEL[draft.purpose]}」，请先移除`;
  }
  else if (!draft.selectedRestaurantId || !draft.candidateIds.includes(draft.selectedRestaurantId)) {
    general = draft.candidateIds.length === 1 ? '点「就选它」确定这家餐厅' : '先随机抽一家餐厅';
  }
  return { fields, general };
}

export function EditorPage() {
  const { id: planId } = useParams();
  const today = useToday();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const wide = useMediaQuery('(min-width: 760px)');
  const catalog = useCatalog();
  const plan = usePlan(planId);
  const { draft, update, restored, resetFromPlan, setRestored, discard } = useEditorDraft({ planId, plan: plan.data, today });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Plan | null>(null);
  /** An outing switch that would remove candidates, waiting for the user's confirmation. */
  const [pendingOuting, setPendingOuting] = useState<{ kind: OutingKind; drop: string[] } | null>(null);

  const snapshotNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of plan.data?.dishes ?? []) map.set(d.id, d.name);
    for (const c of plan.data?.candidates ?? []) map.set(c.id, c.name);
    return map;
  }, [plan.data]);

  if (catalog.isPending || (planId && plan.isPending) || !draft) return <Loading />;
  if (catalog.isError) return <p className="error-text page-pad">菜单加载失败：{catalog.error.message}</p>;
  if (planId && (plan.isError || !plan.data)) return <p className="error-text page-pad">找不到这个计划。</p>;
  if (plan.data && !isEditable(plan.data)) {
    return (
      <div className="center-page">
        <h1>这一餐不能再修改了</h1>
        <p className="muted">已经过去或已取消的计划只能查看。</p>
        <Link className="btn btn-primary" to={`/plans/${plan.data.id}`}>
          查看计划
        </Link>
      </div>
    );
  }

  const cat = catalog.data;
  const isEdit = Boolean(planId);
  const outing = draftOuting(draft);
  const restaurantName = new Map(cat.restaurants.map((r) => [r.id, r.name]));

  const changeOuting = (kind: OutingKind) => {
    if (kind === outing) return;
    const drop = kind === 'home' ? [] : incompatibleCandidates(draft.candidateIds, cat.restaurants, outingFromKind(kind).purpose);
    if (drop.length) setPendingOuting({ kind, drop });
    else update(withOuting(draft, kind));
  };

  const toggleDish = (id: string) =>
    update({ dishIds: draft.dishIds.includes(id) ? draft.dishIds.filter((x) => x !== id) : [...draft.dishIds, id] });
  const toggleCandidate = (id: string) =>
    update({
      candidateIds: draft.candidateIds.includes(id) ? draft.candidateIds.filter((x) => x !== id) : [...draft.candidateIds, id],
      // Any change to the candidate basket invalidates a previous draw.
      selectedRestaurantId: null,
    });

  const openReview = () => {
    const { fields, general } = validate(draft, cat);
    setFieldErrors(fields);
    if (Object.keys(fields).length || general) {
      toast(Object.values(fields)[0] ?? general ?? '请检查填写内容', 'error');
      setDrawerOpen(false);
      return;
    }
    setSubmitError(null);
    setDrawerOpen(false);
    setReviewOpen(true);
  };

  const submit = async (override?: Draft) => {
    const d = override ?? draft;
    const input = draftToInput(d);
    const body = isEdit ? { ...input, expectedVersion: d.baseVersion } : input;
    const fingerprint = JSON.stringify(body);
    // Reuse the key when retrying the identical request (e.g. after a network drop).
    const pending = d.pending?.fingerprint === fingerprint ? d.pending : { key: newIdempotencyKey(), fingerprint };
    const withPending = { ...d, pending };
    update({ pending });
    saveDraft(withPending);
    setBusy(true);
    setSubmitError(null);
    try {
      const saved = isEdit
        ? await api<Plan>('PUT', `/plans/${planId}`, { json: body, idempotencyKey: pending.key })
        : await api<Plan>('POST', '/plans', { json: body, idempotencyKey: pending.key });
      discard();
      deleteDraft(d.key);
      queryClient.setQueryData(keys.plan(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      setReviewOpen(false);
      navigate(`/plans/${saved.id}`, { replace: true, state: { justSaved: isEdit ? 'updated' : 'created' } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        const current = (err.details as { current?: Plan } | undefined)?.current ?? null;
        setReviewOpen(false);
        setConflict(current);
      } else if (err instanceof ApiError && err.status === 0) {
        setSubmitError('网络断开了。草稿已保存在本机，恢复网络后再点一次提交即可。');
      } else if (err instanceof ApiError) {
        setSubmitError(err.message);
        if (err.code === 'unavailable_items' || err.code === 'incompatible_purpose') await queryClient.invalidateQueries({ queryKey: keys.catalog });
      } else {
        setSubmitError('提交失败，请稍后再试');
      }
    } finally {
      setBusy(false);
    }
  };

  const openShoppingPreview = () => {
    if (!drawerOpen) return setPreviewOpen(true);
    // Phone: close the summary drawer first (it restores focus) so only one modal is ever open.
    setDrawerOpen(false);
    window.requestAnimationFrame(() => setPreviewOpen(true));
  };

  const summary = (
    <SelectionSummary
      draft={draft}
      catalog={cat}
      snapshotNames={snapshotNames}
      onChange={update}
      onReview={openReview}
      onShoppingPreview={openShoppingPreview}
      disabled={busy}
    />
  );
  const count = draft.mode === 'home' ? draft.dishIds.length : draft.candidateIds.length;

  return (
    <div className="editor">
      <div className="editor-head">
        <Link to={isEdit ? `/plans/${planId}` : '/'} className="back-link">
          <ArrowLeft aria-hidden="true" />
          返回
        </Link>
        <h1>{isEdit ? `修改计划 #${plan.data?.shortId}` : outing === 'treat' ? '喝点 / 吃点甜的' : '安排一顿'}</h1>
      </div>

      {restored && (
        <div className="notice notice-butter small" role="status">
          <RotateCcw aria-hidden="true" />
          <span>已恢复这台设备上未提交的草稿。</span>
          {isEdit && plan.data && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                deleteDraft(draft.key);
                resetFromPlan(plan.data!);
              }}
            >
              放弃草稿，用已保存版本
            </button>
          )}
          {!isEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRestored(false)}>
              知道了
            </button>
          )}
        </div>
      )}

      <div className="editor-grid">
        <section className="editor-meta card" aria-label="这一餐的基本信息">
          <MealMetaForm draft={draft} today={today} onChange={update} onOutingChange={changeOuting} errors={fieldErrors} />
        </section>

        <section className="editor-picker" aria-label={draft.mode === 'home' ? '选菜' : '选店'}>
          <div className="picker-heading">
            <h2 className="section-title">{PICKER_TITLE[outing]}</h2>
            {draft.mode === 'home' && draft.dishIds.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={openShoppingPreview} aria-haspopup="dialog">
                <ClipboardList aria-hidden="true" />
                采购清单
              </button>
            )}
          </div>
          {draft.mode === 'home' ? (
            <DishPicker dishes={cat.dishes} selectedIds={draft.dishIds} onToggle={toggleDish} />
          ) : (
            <RestaurantPicker
              restaurants={cat.restaurants}
              purpose={draft.purpose}
              candidateIds={draft.candidateIds}
              onToggle={toggleCandidate}
            />
          )}
          <div className="field note-field">
            <label className="field-label" htmlFor="meal-note">
              给这一餐的备注 <span className="muted small">（可选）</span>
            </label>
            <textarea
              id="meal-note"
              className="input textarea"
              rows={3}
              maxLength={LIMITS.note}
              placeholder="比如：少放辣、想早点吃、记得买饮料…"
              value={draft.note}
              onChange={(e) => update({ note: e.target.value })}
            />
            <p className="muted small right">
              {draft.note.length}/{LIMITS.note}
            </p>
          </div>
        </section>

        {wide && <aside className="editor-summary card">{summary}</aside>}
      </div>

      {!wide && (
        <>
          <div className="summary-bar">
            <button type="button" className="summary-bar-info" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog">
              <ListChecks aria-hidden="true" />
              <span>
                <strong>{draft.mode === 'home' ? `已选 ${count} 道菜` : `候选 ${count} 家店`}</strong>
                <span className="small muted">查看已选</span>
              </span>
            </button>
            <button type="button" className="btn btn-primary" onClick={openReview} disabled={busy}>
              检查并提交
            </button>
          </div>
          <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title="已选内容" variant="drawer">
            {summary}
          </Sheet>
        </>
      )}

      <ShoppingPreviewSheet
        open={previewOpen && draft.mode === 'home'}
        onClose={() => setPreviewOpen(false)}
        dishIds={draft.dishIds}
        dishes={cat.dishes}
      />

      <ReviewDialog
        open={reviewOpen}
        draft={draft}
        catalog={cat}
        isEdit={isEdit}
        busy={busy}
        error={submitError}
        onClose={() => setReviewOpen(false)}
        onConfirm={() => void submit()}
      />

      <Sheet
        open={pendingOuting !== null}
        onClose={() => setPendingOuting(null)}
        title={`换成「${pendingOuting ? OUTING_CHOICE_LABEL[pendingOuting.kind] : ''}」？`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPendingOuting(null)}>
              先不换
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (pendingOuting) update(withOuting(draft, pendingOuting.kind, pendingOuting.drop));
                setPendingOuting(null);
              }}
            >
              移出 {pendingOuting?.drop.length ?? 0} 家并切换
            </button>
          </>
        }
      >
        <p>下面这些候选不适合「{pendingOuting ? OUTING_CHOICE_LABEL[pendingOuting.kind] : ''}」，切换后会从候选里移出{draft.selectedRestaurantId && pendingOuting?.drop.includes(draft.selectedRestaurantId) ? '，已抽中的结果也会清除' : ''}：</p>
        <ul className="summary-list">
          {pendingOuting?.drop.map((id) => (
            <li key={id}>
              <span>{restaurantName.get(id) ?? '未知店铺'}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">已选的菜不受影响。不想移出的话，可以先不换。</p>
      </Sheet>

      <Sheet open={conflict !== null} onClose={() => setConflict(null)} title="计划在别处被改过了">
        <p>
          这个计划已经在其他设备上{conflict?.status === 'cancelled' ? '取消' : `更新到第 ${conflict?.version} 版`}。你的修改仍保存在本机草稿里，没有丢失。
        </p>
        <div className="stack-actions">
          <Link className="btn btn-ghost" to={`/plans/${planId}`}>
            先看看最新版本
          </Link>
          {conflict?.status === 'active' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const next = { ...draft, baseVersion: conflict.version, pending: null };
                update({ baseVersion: conflict.version, pending: null });
                setConflict(null);
                void submit(next);
              }}
            >
              用我的版本覆盖
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
