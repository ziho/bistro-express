import { CheckCircle2, Globe2 } from 'lucide-react';
import { formatDateLabel, resolveLocalDateTime } from '../../../../shared/time';
import type { Catalog } from '../../../../shared/types';
import { Sheet } from '../../components/Sheet';
import { viewerTimeZone, type Draft } from '../../lib/drafts';

interface Props {
  open: boolean;
  draft: Draft;
  catalog: Catalog;
  isEdit: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

function viewerTimeNote(draft: Draft): string | null {
  if (!draft.localTime || draft.timeZone === viewerTimeZone()) return null;
  const r = resolveLocalDateTime(draft.date, draft.localTime, draft.timeZone);
  if (!r.ok) return null;
  const local = new Date(r.instant).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  return `相当于你当前时区的 ${local}`;
}

export function ReviewDialog({ open, draft, catalog, isEdit, busy, error, onClose, onConfirm }: Props) {
  const dishes = catalog.dishes.filter((d) => draft.dishIds.includes(d.id));
  const candidates = catalog.restaurants.filter((r) => draft.candidateIds.includes(r.id));
  const selected = catalog.restaurants.find((r) => r.id === draft.selectedRestaurantId);
  const zoneNote = viewerTimeNote(draft);

  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isEdit ? '确认修改' : '确认这一餐'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            再改改
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            <CheckCircle2 aria-hidden="true" />
            {busy ? '提交中…' : isEdit ? '保存修改' : '提交计划'}
          </button>
        </>
      }
    >
      <dl className="review-list">
        <div>
          <dt>日期</dt>
          <dd>
            {formatDateLabel(draft.date)}（{draft.date}）
          </dd>
        </div>
        <div>
          <dt>这一餐</dt>
          <dd>
            {draft.mealLabel}
            {draft.localTime ? ` · ${draft.localTime}` : ' · 不定时间'}
          </dd>
        </div>
        <div>
          <dt>时区</dt>
          <dd>
            <Globe2 aria-hidden="true" className="inline-icon" /> {draft.timeZone}
            {zoneNote && <span className="muted small block">{zoneNote}</span>}
          </dd>
        </div>
        {draft.mode === 'home' ? (
          <div>
            <dt>在家吃</dt>
            <dd>{dishes.map((d) => d.name).join('、')}</dd>
          </div>
        ) : (
          <>
            <div>
              <dt>去餐厅</dt>
              <dd>
                <strong>{selected?.name}</strong>
              </dd>
            </div>
            {candidates.length > 1 && (
              <div>
                <dt>候选</dt>
                <dd>{candidates.map((r) => r.name).join('、')}</dd>
              </div>
            )}
          </>
        )}
        {draft.note && (
          <div>
            <dt>备注</dt>
            <dd className="pre-wrap">{draft.note}</dd>
          </div>
        )}
      </dl>
      <p className="muted small">提交后会保存并尝试推送一条通知给主厨；推送成功不代表对方已读。</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
