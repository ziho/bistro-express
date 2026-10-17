import { Globe2, Pencil } from 'lucide-react';
import { formatDateLabel, resolveLocalDateTime } from '../../../../shared/time';
import type { Catalog } from '../../../../shared/types';
import { formatLocation, OUTING_LABEL, outingKind } from '../../../../shared/venue';
import { viewerTimeZone, type Draft, type EditorStep } from '../../lib/drafts';
import { candidateState, dishAvailable, timeIsAmbiguous } from '../../lib/editorFlow';

interface Props {
  draft: Draft;
  catalog: Catalog;
  /** Names for ids no longer in the active catalog (from the saved plan snapshot). */
  snapshotNames: Map<string, string>;
  onEdit: (step: EditorStep) => void;
  disabled?: boolean;
}

function viewerTimeNote(draft: Draft): string | null {
  if (!draft.localTime || draft.timeZone === viewerTimeZone()) return null;
  const r = resolveLocalDateTime(draft.date, draft.localTime, draft.timeZone);
  if (!r.ok) return null;
  const local = new Date(r.instant).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  return `相当于你当前时区的 ${local}`;
}

function EditLink({ step, label, onEdit, disabled }: { step: EditorStep; label: string; onEdit: Props['onEdit']; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm review-edit" onClick={() => onEdit(step)} disabled={disabled}>
      <Pencil aria-hidden="true" />
      {label}
    </button>
  );
}

/** Step 3: read-only summary of what will be saved, with a way back to each step. */
export function ReviewDetails({ draft, catalog, snapshotNames, onEdit, disabled }: Props) {
  const dishName = new Map(catalog.dishes.map((d) => [d.id, d.name]));
  const venues = new Map(catalog.restaurants.map((r) => [r.id, r]));
  const nameOf = (id: string, names: Map<string, string>) => names.get(id) ?? snapshotNames.get(id) ?? '未知项目';
  const venueName = (id: string) => venues.get(id)?.name ?? snapshotNames.get(id) ?? '未知店铺';
  const selected = draft.selectedRestaurantId ? venues.get(draft.selectedRestaurantId) : undefined;
  const zoneNote = viewerTimeNote(draft);
  const kind = outingKind(draft);

  return (
    <div className="review">
      <section className="review-group card" aria-labelledby="review-meta">
        <div className="review-group-head">
          <h3 id="review-meta">日子和吃法</h3>
          <EditLink step={1} label="修改日期和吃法" onEdit={onEdit} disabled={disabled} />
        </div>
        <dl className="review-list">
          <div>
            <dt>日期</dt>
            <dd>
              {formatDateLabel(draft.date)}
              <span className="muted small block">{draft.date}</span>
            </dd>
          </div>
          <div>
            <dt>这一餐</dt>
            <dd>
              {draft.mealLabel.trim()}
              {draft.localTime ? ` · ${draft.localTime}` : ' · 不定时间'}
              {timeIsAmbiguous(draft) && <span className="muted small block">夏令时切换当天，按第一次出现的时间计算</span>}
            </dd>
          </div>
          <div>
            <dt>时区</dt>
            <dd>
              <Globe2 aria-hidden="true" className="inline-icon" /> {draft.timeZone}
              {zoneNote && <span className="muted small block">{zoneNote}</span>}
            </dd>
          </div>
          <div>
            <dt>吃法</dt>
            <dd>{OUTING_LABEL[kind]}</dd>
          </div>
        </dl>
      </section>

      <section className="review-group card" aria-labelledby="review-picks">
        <div className="review-group-head">
          <h3 id="review-picks">{draft.mode === 'home' ? '菜品' : '店铺'}</h3>
          <EditLink step={2} label={draft.mode === 'home' ? '修改菜品' : '修改店铺'} onEdit={onEdit} disabled={disabled} />
        </div>
        <dl className="review-list">
          {draft.mode === 'home' ? (
            <div>
              <dt>{draft.dishIds.length} 道菜</dt>
              <dd>
                <ul className="review-items">
                  {draft.dishIds.map((id) => (
                    <li key={id}>
                      {nameOf(id, dishName)}
                      {!dishAvailable(id, catalog) && <span className="badge badge-bad">已下架</span>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : (
            <>
              <div>
                <dt>就去这家</dt>
                <dd>
                  <strong>{draft.selectedRestaurantId ? venueName(draft.selectedRestaurantId) : '还没选定'}</strong>
                  {selected && formatLocation(selected.location) && (
                    <span className="muted small block">{formatLocation(selected.location)}</span>
                  )}
                </dd>
              </div>
              {draft.candidateIds.length > 1 && (
                <div>
                  <dt>候选</dt>
                  <dd>
                    <ul className="review-items">
                      {draft.candidateIds.map((id) => {
                        const state = candidateState(id, catalog.restaurants, draft.purpose);
                        return (
                          <li key={id}>
                            {venueName(id)}
                            {state === 'unavailable' && <span className="badge badge-bad">已下架</span>}
                            {state === 'incompatible' && <span className="badge badge-bad">不适合这次</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
