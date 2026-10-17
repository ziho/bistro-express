import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, ListChecks, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LIMITS } from '../../../../shared/constants';
import type { Plan } from '../../../../shared/types';
import { outingFromKind, type OutingKind } from '../../../../shared/venue';
import { api, ApiError, newIdempotencyKey } from '../../api/client';
import { keys, useCatalog, usePlan } from '../../api/queries';
import { Loading } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { clampEditorStep, deleteDraft, draftToInput, saveDraft, type Draft } from '../../lib/drafts';
import {
  autoChoicePatch,
  checkBefore,
  firstMetaError,
  META_FIELD_ORDER,
  metaErrors,
  selectionIssue,
  stepForServerError,
  withCandidates,
  type EditorStep,
  type MetaErrors,
  type MetaField,
  type StepCheck,
} from '../../lib/editorFlow';
import { useMediaQuery, useToday } from '../../lib/hooks';
import { isEditable } from '../../lib/planView';
import { draftOuting, incompatibleCandidates, withOuting } from '../../lib/outing';
import { DishPicker } from './DishPicker';
import { ConflictSheet, OutingSwitchSheet } from './EditorSheets';
import { EditorStepper } from './EditorStepper';
import { MealMetaForm } from './MealMetaForm';
import { RestaurantPicker } from './RestaurantPicker';
import { ReviewDetails } from './ReviewDetails';
import { SelectionSummary } from './SelectionSummary';
import { ShoppingPreviewSheet } from './ShoppingPreviewSheet';
import { useEditorDraft } from './useEditorDraft';
import { useStepTransition, type FocusTarget } from './useStepTransition';

const PICK_TITLE: Record<OutingKind, string> = {
  home: '今日食乜？',
  restaurant: '出街搵好嘢',
  treat: '想饮啲乜？',
};

const PICK_LEAD: Record<OutingKind, string> = {
  home: '想吃的菜直接点，也可以按家里现有的食材来找。',
  restaurant: '先加候选店，再选一家；拿不定主意就抽签。',
  treat: '奶茶、咖啡、糖水、甜品，想去的先加进来。',
};

const FIELD_ID: Record<MetaField, string> = {
  date: 'meal-date',
  mealLabel: 'meal-label',
  localTime: 'meal-time',
  timeZone: 'meal-zone',
};

type Blocked = Exclude<StepCheck, { ok: true }>;

export function EditorPage() {
  const { id: planId } = useParams();
  const today = useToday();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const wide = useMediaQuery('(min-width: 760px)');
  const catalog = useCatalog();
  const plan = usePlan(planId);
  const { draft, update, setStep, restored, resetFromPlan, setRestored, discard } = useEditorDraft({ planId, plan: plan.data, today });
  const step: EditorStep = clampEditorStep(draft?.editorStep) ?? 1;
  const { top, heading, issue, focusStep } = useStepTransition(step);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MetaErrors>({});
  /** Step 2's blocking problem, shown after a blocked 下一步 or a rejected submit. */
  const [stepIssue, setStepIssue] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Plan | null>(null);
  /** An outing switch that would remove candidates, waiting for the user's confirmation. */
  const [pendingOuting, setPendingOuting] = useState<{ kind: OutingKind; drop: string[] } | null>(null);

  const snapshotNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of plan.data?.dishes ?? []) map.set(d.id, d.name);
    for (const c of plan.data?.candidates ?? []) map.set(c.id, c.name);
    return map;
  }, [plan.data]);

  // A basket with one usable candidate needs no draw: also covers restored drafts and catalog refreshes.
  useEffect(() => {
    if (!draft || !catalog.data) return;
    const patch = autoChoicePatch(draft, catalog.data);
    if (patch) update(patch);
  }, [draft, catalog.data, update]);

  // Shown errors follow the fields as they are corrected; nothing is shown before the first attempt.
  const metaKey = draft ? JSON.stringify([draft.date, draft.mealLabel, draft.localTime, draft.timeZone]) : '';
  useEffect(() => {
    if (draft) setFieldErrors((prev) => (Object.keys(prev).length ? metaErrors(draft) : prev));
    // Keyed on the step 1 fields only, so a server message stays until those fields change.
  }, [metaKey]);
  const basketKey = draft
    ? JSON.stringify([draft.mode, draft.purpose, draft.dishIds, draft.candidateIds, draft.selectedRestaurantId])
    : '';
  useEffect(() => {
    if (draft && catalog.data) setStepIssue((prev) => (prev === null ? prev : selectionIssue(draft, catalog.data)?.message ?? null));
  }, [basketKey, catalog.data]);

  if (catalog.isError) return <p className="error-text page-pad">菜单加载失败：{catalog.error.message}</p>;
  if (planId && plan.isError) return <p className="error-text page-pad">找不到这次安排。</p>;
  if (catalog.isPending || (planId && plan.isPending) || !draft) return <Loading />;
  if (planId && !plan.data) return <p className="error-text page-pad">找不到这次安排。</p>;
  if (plan.data && !isEditable(plan.data)) {
    return (
      <div className="center-page">
        <h1>这一餐不能再修改了</h1>
        <p className="muted">已经过去或已取消的安排只能查看。</p>
        <Link className="btn btn-primary" to={`/plans/${plan.data.id}`}>
          查看安排
        </Link>
      </div>
    );
  }

  const cat = catalog.data;
  const isEdit = Boolean(planId);
  const outing = draftOuting(draft);
  const restaurantName = new Map(cat.restaurants.map((r) => [r.id, r.name]));
  const nameOf = (id: string) => restaurantName.get(id) ?? snapshotNames.get(id) ?? '未知店铺';

  const moveTo = (target: EditorStep, focus: FocusTarget = 'heading') => {
    if (target !== 2) {
      setDrawerOpen(false);
      setPreviewOpen(false);
    }
    setStep(target);
    focusStep(focus);
  };

  const showBlocked = (check: Blocked) => {
    if (check.step === 1) {
      setFieldErrors(check.fields);
      const first = firstMetaError(check.fields);
      moveTo(1, first ? { id: FIELD_ID[first] } : 'heading');
    } else {
      setStepIssue(check.message);
      moveTo(2, 'issue');
    }
  };

  /** Back is always allowed; forward runs every check up to the target step. */
  const goTo = (target: EditorStep) => {
    if (busyRef.current) return;
    if (target <= step) return moveTo(target);
    const check = checkBefore(target, draft, cat);
    if (!check.ok) return showBlocked(check);
    moveTo(target);
  };

  const changeOuting = (kind: OutingKind) => {
    if (kind === outing) return;
    const drop = kind === 'home' ? [] : incompatibleCandidates(draft.candidateIds, cat.restaurants, outingFromKind(kind).purpose);
    if (drop.length) setPendingOuting({ kind, drop });
    else update(withOuting(draft, kind));
  };

  const toggleDish = (id: string) =>
    update({ dishIds: draft.dishIds.includes(id) ? draft.dishIds.filter((x) => x !== id) : [...draft.dishIds, id] });
  // Any change to the candidate basket invalidates a previous draw (a single usable candidate is chosen).
  const setCandidates = (ids: string[]) => update(withCandidates(draft, cat, ids));
  const toggleCandidate = (id: string) =>
    setCandidates(draft.candidateIds.includes(id) ? draft.candidateIds.filter((x) => x !== id) : [...draft.candidateIds, id]);

  const handleSubmitError = async (err: unknown, d: Draft) => {
    if (err instanceof ApiError && err.code === 'version_conflict') {
      setConflict((err.details as { current?: Plan } | undefined)?.current ?? null);
      return;
    }
    if (!(err instanceof ApiError)) {
      setSubmitError('提交失败，请稍后再试');
      return focusStep('issue');
    }
    if (err.status === 0) {
      setSubmitError('网络断开了。草稿已保存在本机，恢复网络后再点一次确认即可。');
      return focusStep('issue');
    }
    if (err.code === 'unavailable_items' || err.code === 'incompatible_purpose') await queryClient.invalidateQueries({ queryKey: keys.catalog });
    const field = (err.details as { field?: unknown } | undefined)?.field;
    const target = stepForServerError(err.code, field);
    if (target === 1) {
      const key = META_FIELD_ORDER.find((f) => f === field) ?? 'date';
      setFieldErrors({ ...metaErrors(d), [key]: err.message });
      return moveTo(1, { id: FIELD_ID[key] });
    }
    if (target === 2) {
      setStepIssue(err.message);
      return moveTo(2, 'issue');
    }
    setSubmitError(err.message);
    focusStep('issue');
  };

  const submit = async (override?: Draft) => {
    if (busyRef.current) return;
    const d = override ?? draft;
    // Everything is checked again: a saved plan opens straight on review, and the catalog may have changed.
    const check = checkBefore(3, d, cat);
    if (!check.ok) {
      toast(check.message, 'error');
      return showBlocked(check);
    }
    const input = draftToInput(d);
    const body = isEdit ? { ...input, expectedVersion: d.baseVersion } : input;
    const fingerprint = JSON.stringify(body);
    // Reuse the key when retrying the identical request (e.g. after a network drop).
    const pending = d.pending?.fingerprint === fingerprint ? d.pending : { key: newIdempotencyKey(), fingerprint };
    update({ pending });
    saveDraft({ ...d, pending });
    busyRef.current = true;
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
      navigate(`/plans/${saved.id}`, { replace: true, state: { justSaved: isEdit ? 'updated' : 'created' } });
    } catch (err) {
      await handleSubmitError(err, d);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openShoppingPreview = () => {
    if (!drawerOpen) return setPreviewOpen(true);
    // Phone: close the summary drawer first (it restores focus) so only one modal is ever open.
    setDrawerOpen(false);
    window.requestAnimationFrame(() => setPreviewOpen(true));
  };

  /** Drawer footer: a basket problem is shown right in the drawer; anything else leaves it. */
  const nextFromDrawer = () => {
    const check = checkBefore(3, draft, cat);
    if (!check.ok && check.step === 2) return setStepIssue(check.message);
    setDrawerOpen(false);
    goTo(3);
  };

  const summary = (
    <SelectionSummary
      draft={draft}
      catalog={cat}
      snapshotNames={snapshotNames}
      onChange={update}
      onRemoveCandidate={(id) => setCandidates(draft.candidateIds.filter((x) => x !== id))}
      onShoppingPreview={openShoppingPreview}
      issue={wide ? null : stepIssue}
      disabled={busy}
    />
  );
  const count = draft.mode === 'home' ? draft.dishIds.length : draft.candidateIds.length;
  const reviewCheck = step === 3 ? checkBefore(3, draft, cat) : null;

  return (
    <div className="editor" ref={top}>
      <div className="editor-head">
        <Link to={isEdit ? `/plans/${planId}` : '/'} className="back-link">
          <ArrowLeft aria-hidden="true" />
          返回
        </Link>
        <h1>{isEdit ? `修改安排 #${plan.data?.shortId}` : '安排一顿'}</h1>
      </div>

      <div className="editor-narrow">
        <EditorStepper step={step} onSelect={goTo} disabled={busy} />
        {restored && (
          <div className="notice notice-butter small" role="status">
            <RotateCcw aria-hidden="true" />
            <span>上次没填完的已恢复。</span>
            {isEdit && plan.data && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  deleteDraft(draft.key);
                  setFieldErrors({});
                  setStepIssue(null);
                  setSubmitError(null);
                  resetFromPlan(plan.data!);
                  focusStep('heading');
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
      </div>

      {step === 1 && (
        <section className="editor-step editor-narrow" aria-labelledby="editor-step-title">
          <header className="editor-step-head" data-step-motion="lift">
            <h2 id="editor-step-title" ref={heading} tabIndex={-1}>
              几时开饭，点样食？
            </h2>
            <p className="muted">先选日期和吃法，再挑菜或店铺。</p>
          </header>
          <div className="card editor-meta" data-step-motion="lift">
            <MealMetaForm draft={draft} today={today} onChange={update} onOutingChange={changeOuting} errors={fieldErrors} disabled={busy} />
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="editor-step" aria-labelledby="editor-step-title">
          <header className="editor-step-head editor-step-head-row" data-step-motion="lift">
            <div>
              <h2 id="editor-step-title" ref={heading} tabIndex={-1}>
                {PICK_TITLE[outing]}
              </h2>
              <p className="muted">{PICK_LEAD[outing]}</p>
            </div>
            {draft.mode === 'home' && draft.dishIds.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={openShoppingPreview} aria-haspopup="dialog">
                <ClipboardList aria-hidden="true" />
                采购清单
              </button>
            )}
          </header>
          {stepIssue && (
            <p ref={issue} tabIndex={-1} className="error-text editor-issue" role="alert">
              {stepIssue}
            </p>
          )}
          <div className="editor-pick">
            <div className="editor-picker" data-step-motion="fade">
              {draft.mode === 'home' ? (
                <DishPicker dishes={cat.dishes} selectedIds={draft.dishIds} onToggle={toggleDish} />
              ) : (
                <RestaurantPicker restaurants={cat.restaurants} purpose={draft.purpose} candidateIds={draft.candidateIds} onToggle={toggleCandidate} />
              )}
            </div>
            {wide && (
              <aside className="editor-summary card" aria-label="已选内容" data-step-motion="fade">
                {summary}
              </aside>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="editor-step editor-narrow" aria-labelledby="editor-step-title">
          <header className="editor-step-head" data-step-motion="lift">
            <h2 id="editor-step-title" ref={heading} tabIndex={-1}>
              备注与确认
            </h2>
            <p className="muted">看看有没有漏的，没问题就确认。</p>
          </header>
          {reviewCheck && !reviewCheck.ok && (
            <div className="notice notice-butter small" role="status">
              <span>{reviewCheck.message}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => showBlocked(reviewCheck)} disabled={busy}>
                去修改
              </button>
            </div>
          )}
          <div data-step-motion="lift">
            <ReviewDetails draft={draft} catalog={cat} snapshotNames={snapshotNames} onEdit={goTo} disabled={busy} />
          </div>
          <div className="card field note-field" data-step-motion="lift">
            <label className="field-label" htmlFor="meal-note">
              还有什么想交代的 <span className="muted small">（可选）</span>
            </label>
            <textarea
              id="meal-note"
              className="input textarea"
              rows={3}
              maxLength={LIMITS.note}
              placeholder="少辣、早点吃、顺路买饮料……"
              value={draft.note}
              onChange={(e) => update({ note: e.target.value })}
              disabled={busy}
            />
            <p className="muted small right">
              {draft.note.length}/{LIMITS.note}
            </p>
          </div>
          {submitError && (
            <p ref={issue} tabIndex={-1} className="error-text editor-issue" role="alert">
              {submitError}
            </p>
          )}
          <p className="muted small">确认后保存安排，并尝试发送通知。</p>
        </section>
      )}

      <div className={`editor-actions${step === 2 ? '' : ' is-narrow'}`}>
        <div className="editor-actions-inner">
          {step === 2 && !wide && (
            <button type="button" className="summary-bar-info" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog">
              <ListChecks aria-hidden="true" />
              <span>
                <strong>{draft.mode === 'home' ? `已选 ${count} 道菜` : `候选 ${count} 家店`}</strong>
                <span className="small muted">查看已选</span>
              </span>
            </button>
          )}
          {step > 1 && (wide || step === 3) && (
            <button type="button" className="btn btn-ghost" onClick={() => goTo((step - 1) as EditorStep)} disabled={busy}>
              <ArrowLeft aria-hidden="true" />
              上一步
            </button>
          )}
          {step < 3 ? (
            <button type="button" className="btn btn-primary editor-actions-main" onClick={() => goTo((step + 1) as EditorStep)} disabled={busy}>
              下一步
              <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="btn btn-primary editor-actions-main" onClick={() => void submit()} disabled={busy}>
              <CheckCircle2 aria-hidden="true" />
              {busy ? '提交中…' : isEdit ? '保存修改' : '确认安排'}
            </button>
          )}
        </div>
      </div>

      {!wide && (
        <Sheet
          open={drawerOpen && step === 2}
          onClose={() => setDrawerOpen(false)}
          title="已选内容"
          variant="drawer"
          footer={
            <button type="button" className="btn btn-primary btn-block" onClick={nextFromDrawer} disabled={busy}>
              下一步：备注与确认
              <ArrowRight aria-hidden="true" />
            </button>
          }
        >
          {summary}
        </Sheet>
      )}

      <ShoppingPreviewSheet
        open={previewOpen && step === 2 && draft.mode === 'home'}
        onClose={() => setPreviewOpen(false)}
        dishIds={draft.dishIds}
        dishes={cat.dishes}
      />

      <OutingSwitchSheet
        pending={pendingOuting}
        dropsSelected={Boolean(draft.selectedRestaurantId && pendingOuting?.drop.includes(draft.selectedRestaurantId))}
        nameOf={nameOf}
        onCancel={() => setPendingOuting(null)}
        onConfirm={() => {
          if (pendingOuting) update(withOuting(draft, pendingOuting.kind, pendingOuting.drop));
          setPendingOuting(null);
        }}
      />

      <ConflictSheet
        conflict={conflict}
        planId={planId}
        busy={busy}
        onClose={() => setConflict(null)}
        onOverride={(current) => {
          const next = { ...draft, baseVersion: current.version, pending: null };
          update({ baseVersion: current.version, pending: null });
          setConflict(null);
          void submit(next);
        }}
      />
    </div>
  );
}
