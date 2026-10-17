import { Check, ClipboardList, Dices, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDateLabel } from '../../../../shared/time';
import type { Catalog } from '../../../../shared/types';
import { OUTING_LABEL, PURPOSE_LABEL, outingKind } from '../../../../shared/venue';
import { OutingIcon, outingClass } from '../../components/OutingIcon';
import { drawOne } from '../../lib/draw';
import type { Draft } from '../../lib/drafts';
import { basketSignature, candidateState, choosePatch, dishAvailable, drawCommit, type CandidateState } from '../../lib/editorFlow';
import { motionAllowed } from '../../lib/motion';
import { drawableCandidates } from '../../lib/outing';

interface Props {
  draft: Draft;
  catalog: Catalog;
  /** Names for ids no longer in the active catalog (from the saved plan snapshot). */
  snapshotNames: Map<string, string>;
  onChange: (patch: Partial<Draft>) => void;
  /** Removing a candidate goes through the page so the final venue follows the basket rules. */
  onRemoveCandidate: (id: string) => void;
  /** Opens the read-only shopping checklist preview (home meals). */
  onShoppingPreview: () => void;
  /** The step 2 problem to show after a blocked "下一步" (null when nothing is blocking). */
  issue?: string | null;
  disabled?: boolean;
}

const DRAW_MS = 220;

/** Step 2's basket: what is picked, what cannot be used, and the final venue (draw or choose). */
export function SelectionSummary({ draft, catalog, snapshotNames, onChange, onRemoveCandidate, onShoppingPreview, issue, disabled }: Props) {
  const [drawCount, setDrawCount] = useState(0);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const latestCatalog = useRef(catalog);
  latestCatalog.current = catalog;
  const signature = basketSignature(draft);

  // A changed basket (or leaving the page) cancels a draw still rolling; it never lands late.
  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setRolling(false);
    };
  }, [signature]);

  const dishName = new Map(catalog.dishes.map((d) => [d.id, d.name]));
  const restaurantName = new Map(catalog.restaurants.map((r) => [r.id, r.name]));
  const drawable = drawableCandidates(draft.candidateIds, catalog.restaurants, draft.purpose);
  const kind = outingKind(draft);
  const ids = draft.mode === 'home' ? draft.dishIds : draft.candidateIds;
  const nameOf = (id: string) =>
    (draft.mode === 'home' ? dishName.get(id) : restaurantName.get(id)) ?? snapshotNames.get(id) ?? '未知项目';
  const stateOf = (id: string): CandidateState =>
    draft.mode === 'home' ? (dishAvailable(id, catalog) ? 'ok' : 'unavailable') : candidateState(id, catalog.restaurants, draft.purpose);

  const remove = (id: string) => {
    if (draft.mode === 'home') onChange({ dishIds: draft.dishIds.filter((x) => x !== id) });
    else onRemoveCandidate(id);
  };

  const draw = () => {
    const startedFor = signature;
    const pick = () => {
      timer.current = null;
      setRolling(false);
      // Only candidates that are still offered and fit this outing's purpose can be drawn.
      const pool = drawableCandidates(latest.current.candidateIds, latestCatalog.current.restaurants, latest.current.purpose);
      const patch = drawCommit(startedFor, latest.current, drawOne(pool));
      if (!patch) return;
      onChange(patch);
      setDrawCount((n) => n + 1);
    };
    if (!motionAllowed()) return pick();
    setRolling(true);
    timer.current = window.setTimeout(pick, DRAW_MS);
  };

  const choose = (id: string) => {
    const patch = choosePatch(draft, catalog, id);
    if (patch) onChange(patch);
  };

  const selectedName = draft.selectedRestaurantId ? nameOf(draft.selectedRestaurantId) : null;
  const multiple = drawable.length > 1;

  return (
    <div className="summary">
      <div className="summary-head">
        <span className={`summary-mode ${outingClass(draft)}`} aria-hidden="true">
          <OutingIcon plan={draft} />
        </span>
        <div className="summary-head-text">
          <p className="summary-title">{draft.mealLabel.trim() || '还没起名的一餐'}</p>
          <p className="muted small">
            {formatDateLabel(draft.date)}
            {draft.localTime ? ` · ${draft.localTime}` : ''} · {OUTING_LABEL[kind]}
          </p>
        </div>
      </div>

      {issue && (
        <p className="field-error summary-issue" role="alert">
          {issue}
        </p>
      )}

      <h3 className="summary-subtitle">{draft.mode === 'home' ? `已选的菜（${ids.length}）` : `候选店铺（${ids.length}）`}</h3>
      {ids.length === 0 ? (
        <p className="muted small summary-empty">
          {draft.mode === 'home' ? '点菜单卡片，把想吃的菜加进来。' : '把想去的店加入候选，一家就直接定，几家可以抽一家。'}
        </p>
      ) : (
        <ul className="summary-list">
          {ids.map((id) => {
            const name = nameOf(id);
            const state = stateOf(id);
            const isChosen = draft.mode === 'restaurant' && draft.selectedRestaurantId === id;
            return (
              <li key={id} className={`${state === 'ok' ? '' : 'is-unavailable'}${isChosen ? ' is-chosen' : ''}`}>
                <span className="summary-item-name">
                  {name}
                  {state === 'unavailable' && <span className="badge badge-bad">已下架，请移除</span>}
                  {state === 'incompatible' && <span className="badge badge-bad">不适合「{PURPOSE_LABEL[draft.purpose]}」，请移除</span>}
                </span>
                <span className="summary-item-actions">
                  {draft.mode === 'restaurant' && multiple && state === 'ok' && (
                    <button
                      type="button"
                      className={`btn btn-sm ${isChosen ? 'btn-butter' : 'btn-ghost'}`}
                      aria-pressed={isChosen}
                      aria-label={isChosen ? `已选定 ${name}` : `选定 ${name}`}
                      onClick={() => choose(id)}
                      disabled={disabled || rolling}
                    >
                      {isChosen ? <Check aria-hidden="true" /> : null}
                      {isChosen ? '已选' : '选这家'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-label={`移除 ${name}`}
                    onClick={() => remove(id)}
                    disabled={disabled || rolling}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {draft.mode === 'home' && ids.length > 0 && (
        <button type="button" className="btn btn-ghost btn-block" onClick={onShoppingPreview} aria-haspopup="dialog">
          <ClipboardList aria-hidden="true" />
          采购清单预览
        </button>
      )}

      {draft.mode === 'restaurant' && (
        <div className="draw-box">
          <div className="draw-result" aria-live="polite">
            {rolling ? (
              <span className="draw-rolling">
                <Dices aria-hidden="true" /> 抽签中…
              </span>
            ) : selectedName ? (
              <span key={drawCount} className="draw-picked">
                <span className="muted small">就去这家：</span>
                <strong>{selectedName}</strong>
              </span>
            ) : (
              <span className="muted small">
                {drawable.length === 0 ? '还没有能去的候选' : '抽一家，或者在上面直接选定'}
              </span>
            )}
          </div>
          {multiple && (
            <button type="button" className="btn btn-butter btn-block" onClick={draw} disabled={disabled || rolling}>
              <Dices aria-hidden="true" />
              {selectedName ? '再抽一次' : '随机抽一家'}
            </button>
          )}
          {drawable.length === 1 && <p className="muted small center">只有一家候选，已经帮你定好。</p>}
        </div>
      )}
    </div>
  );
}
