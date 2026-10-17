import { ClipboardList, Dices, Send, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { formatDateLabel } from '../../../../shared/time';
import type { Catalog } from '../../../../shared/types';
import { OUTING_LABEL, outingKind } from '../../../../shared/venue';
import { OutingIcon, outingClass } from '../../components/OutingIcon';
import { drawOne } from '../../lib/draw';
import type { Draft } from '../../lib/drafts';
import { drawableCandidates } from '../../lib/outing';

interface Props {
  draft: Draft;
  catalog: Catalog;
  /** Names for ids no longer in the active catalog (from the saved plan snapshot). */
  snapshotNames: Map<string, string>;
  onChange: (patch: Partial<Draft>) => void;
  onReview: () => void;
  /** Opens the read-only shopping checklist preview (home meals). */
  onShoppingPreview: () => void;
  disabled?: boolean;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SelectionSummary({ draft, catalog, snapshotNames, onChange, onReview, onShoppingPreview, disabled }: Props) {
  const [drawCount, setDrawCount] = useState(0);
  const [rolling, setRolling] = useState(false);
  const dishName = new Map(catalog.dishes.map((d) => [d.id, d.name]));
  const restaurantName = new Map(catalog.restaurants.map((r) => [r.id, r.name]));
  const ids = draft.mode === 'home' ? draft.dishIds : draft.candidateIds;
  const names = draft.mode === 'home' ? dishName : restaurantName;

  const remove = (id: string) => {
    if (draft.mode === 'home') onChange({ dishIds: draft.dishIds.filter((x) => x !== id) });
    else onChange({ candidateIds: draft.candidateIds.filter((x) => x !== id), selectedRestaurantId: null });
  };

  const draw = () => {
    const pick = () => {
      // Only candidates that are still offered and fit this outing's purpose can be drawn.
      onChange({ selectedRestaurantId: drawOne(drawable) });
      setDrawCount((n) => n + 1);
      setRolling(false);
    };
    if (prefersReducedMotion()) return pick();
    setRolling(true);
    window.setTimeout(pick, 220);
  };

  const selectedName = draft.selectedRestaurantId
    ? restaurantName.get(draft.selectedRestaurantId) ?? snapshotNames.get(draft.selectedRestaurantId)
    : null;
  const drawable = drawableCandidates(draft.candidateIds, catalog.restaurants, draft.purpose);
  const candidateCount = drawable.length;
  const kind = outingKind(draft);

  return (
    <div className="summary">
      <div className="summary-head">
        <span className={`summary-mode ${outingClass(draft)}`} aria-hidden="true">
          <OutingIcon plan={draft} />
        </span>
        <div>
          <p className="summary-title">{draft.mealLabel || '还没起名的一餐'}</p>
          <p className="muted small">
            {formatDateLabel(draft.date)}
            {draft.localTime ? ` · ${draft.localTime}` : ''} · {OUTING_LABEL[kind]}
          </p>
        </div>
      </div>

      <h3 className="summary-subtitle">{draft.mode === 'home' ? `已选的菜（${ids.length}）` : `候选店铺（${ids.length}）`}</h3>
      {ids.length === 0 ? (
        <p className="muted small summary-empty">
          {draft.mode === 'home' ? '点菜单卡片把想吃的菜加进来。' : '把想去的店加入候选，再随机抽一家。'}
        </p>
      ) : (
        <ul className="summary-list">
          {ids.map((id) => {
            const name = names.get(id);
            return (
              <li key={id} className={name ? '' : 'is-unavailable'}>
                <span>
                  {name ?? snapshotNames.get(id) ?? '未知项目'}
                  {!name && <span className="badge badge-bad">已下架，请移除</span>}
                </span>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`移除 ${name ?? snapshotNames.get(id) ?? ''}`} onClick={() => remove(id)}>
                  <Trash2 aria-hidden="true" />
                </button>
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
                {candidateCount === 0 ? '还没有候选，不能抽签' : candidateCount === 1 ? '只有一家，直接选它吧' : '候选准备好啦，抽一家吧'}
              </span>
            )}
          </div>
          {candidateCount === 1 ? (
            <button
              type="button"
              className="btn btn-butter btn-block"
              onClick={() => onChange({ selectedRestaurantId: drawable[0] ?? null })}
              disabled={draft.selectedRestaurantId === drawable[0]}
            >
              <Wand2 aria-hidden="true" />
              就选它
            </button>
          ) : (
            <button type="button" className="btn btn-butter btn-block" onClick={draw} disabled={candidateCount < 2 || rolling}>
              <Dices aria-hidden="true" />
              {selectedName ? '再抽一次' : '随机抽一家'}
            </button>
          )}
        </div>
      )}

      {draft.note && (
        <div className="summary-note">
          <h3 className="summary-subtitle">备注</h3>
          <p>{draft.note}</p>
        </div>
      )}

      <button type="button" className="btn btn-primary btn-block summary-submit" onClick={onReview} disabled={disabled}>
        <Send aria-hidden="true" />
        检查并提交
      </button>
      <p className="muted small center">提交前会再确认一次，草稿会自动保存在本机。</p>
    </div>
  );
}
