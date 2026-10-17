import { Globe2, X } from 'lucide-react';
import { MEAL_SUGGESTIONS, LIMITS } from '../../../../shared/constants';
import { resolveLocalDateTime, TIME_ERROR_MESSAGES } from '../../../../shared/time';
import { OUTING_CHOICE_LABEL, outingKind, TREAT_SUGGESTIONS, type OutingKind } from '../../../../shared/venue';
import { OUTING_ICON } from '../../components/OutingIcon';
import { viewerTimeZone, type Draft } from '../../lib/drafts';

const OUTING_KINDS: OutingKind[] = ['home', 'restaurant', 'treat'];

interface Props {
  draft: Draft;
  today: string;
  onChange: (patch: Partial<Draft>) => void;
  /** Switching outing may need a confirmation (dropping venues that do not fit), so the page decides. */
  onOutingChange: (kind: OutingKind) => void;
  errors: Partial<Record<'date' | 'mealLabel' | 'localTime', string>>;
}

export function timeProblem(draft: Draft): string | null {
  if (!draft.localTime) return null;
  const r = resolveLocalDateTime(draft.date, draft.localTime, draft.timeZone);
  return r.ok ? null : TIME_ERROR_MESSAGES[r.reason];
}

export function timeIsAmbiguous(draft: Draft): boolean {
  if (!draft.localTime) return false;
  const r = resolveLocalDateTime(draft.date, draft.localTime, draft.timeZone);
  return r.ok && r.ambiguous;
}

export function MealMetaForm({ draft, today, onChange, onOutingChange, errors }: Props) {
  const viewerZone = viewerTimeZone();
  const zoneDiffers = draft.timeZone !== viewerZone;
  const timeError = errors.localTime ?? timeProblem(draft);
  const outing = outingKind(draft);
  const suggestions = outing === 'treat' ? TREAT_SUGGESTIONS : MEAL_SUGGESTIONS;

  return (
    <div className="meta-form">
      <div className="field">
        <label className="field-label" htmlFor="meal-date">
          日期
        </label>
        <input
          id="meal-date"
          className="input"
          type="date"
          min={today}
          value={draft.date}
          onChange={(e) => e.target.value && onChange({ date: e.target.value })}
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={errors.date ? 'meal-date-err' : undefined}
        />
        {errors.date && (
          <p id="meal-date-err" className="field-error">
            {errors.date}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="meal-label">
          这一餐叫什么
        </label>
        <input
          id="meal-label"
          className="input"
          type="text"
          maxLength={LIMITS.mealLabel}
          placeholder="比如：晚餐、周末早午餐"
          value={draft.mealLabel}
          onChange={(e) => onChange({ mealLabel: e.target.value })}
          aria-invalid={errors.mealLabel ? true : undefined}
          aria-describedby={errors.mealLabel ? 'meal-label-err' : undefined}
        />
        <div className="chip-row" role="group" aria-label="快速选择">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={draft.mealLabel === s}
              onClick={() => onChange({ mealLabel: s })}
            >
              {s}
            </button>
          ))}
        </div>
        {errors.mealLabel && (
          <p id="meal-label-err" className="field-error">
            {errors.mealLabel}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="meal-time">
          时间 <span className="muted small">（可选）</span>
        </label>
        <div className="input-with-action">
          <input
            id="meal-time"
            className="input"
            type="time"
            value={draft.localTime}
            onChange={(e) => onChange({ localTime: e.target.value })}
            aria-invalid={timeError ? true : undefined}
            aria-describedby="meal-time-hint"
          />
          {draft.localTime && (
            <button type="button" className="icon-btn" onClick={() => onChange({ localTime: '' })} aria-label="清除时间">
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="meal-time-hint" className={timeError ? 'field-error' : 'muted small'}>
          {timeError ??
            (timeIsAmbiguous(draft)
              ? '这个时间因夏令时会出现两次，将按第一次出现计算'
              : draft.localTime
                ? `按 ${draft.timeZone} 时间计算`
                : '不填时间就只按日期安排')}
        </p>
      </div>

      {zoneDiffers && (
        <div className="notice notice-sky small">
          <Globe2 aria-hidden="true" />
          <div>
            <p>
              这一餐按原时区 <strong>{draft.timeZone}</strong> 记录，你当前在 <strong>{viewerZone}</strong>。
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ timeZone: viewerZone })}>
              改用我当前的时区
            </button>
          </div>
        </div>
      )}

      <fieldset className="field">
        <legend className="field-label">安排什么</legend>
        <div className="segmented segmented-3">
          {OUTING_KINDS.map((kind) => {
            const Icon = OUTING_ICON[kind];
            return (
              <label key={kind} className="segmented-option">
                <input type="radio" name="meal-mode" value={kind} checked={outing === kind} onChange={() => onOutingChange(kind)} />
                <span>
                  <Icon aria-hidden="true" />
                  {OUTING_CHOICE_LABEL[kind]}
                </span>
              </label>
            );
          })}
        </div>
        {outing === 'treat' && <p className="muted small">只显示标记为「饮品甜品」的店，比如奶茶、咖啡、甜品、蛋糕、面包店。</p>}
      </fieldset>
    </div>
  );
}
