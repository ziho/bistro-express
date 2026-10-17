import { Globe2, X } from 'lucide-react';
import { MEAL_SUGGESTIONS, LIMITS } from '../../../../shared/constants';
import { OUTING_CHOICE_LABEL, outingKind, TREAT_SUGGESTIONS, type OutingKind } from '../../../../shared/venue';
import { OUTING_ICON } from '../../components/OutingIcon';
import { viewerTimeZone, type Draft } from '../../lib/drafts';
import { timeIsAmbiguous, timeProblem, type MetaErrors } from '../../lib/editorFlow';

const OUTING_KINDS: OutingKind[] = ['home', 'restaurant', 'treat'];

const OUTING_HINT: Record<OutingKind, string> = {
  home: '下一步点菜。',
  restaurant: '下一步挑店，可以自己选，也可以抽签。',
  treat: '奶茶、咖啡、糖水、甜品，下一步再挑店。',
};

interface Props {
  draft: Draft;
  today: string;
  onChange: (patch: Partial<Draft>) => void;
  /** Switching outing may need a confirmation (dropping venues that do not fit), so the page decides. */
  onOutingChange: (kind: OutingKind) => void;
  errors: MetaErrors;
  disabled?: boolean;
}

/** Step 1: when, what to call it, and how to eat. */
export function MealMetaForm({ draft, today, onChange, onOutingChange, errors, disabled }: Props) {
  const viewerZone = viewerTimeZone();
  const zoneDiffers = draft.timeZone !== viewerZone || Boolean(errors.timeZone);
  const timeError = errors.localTime ?? timeProblem(draft);
  const outing = outingKind(draft);
  const suggestions = outing === 'treat' ? TREAT_SUGGESTIONS : MEAL_SUGGESTIONS;

  return (
    <fieldset className="meta-form" disabled={disabled}>
      <fieldset className="field">
        <legend className="field-label">这次点样食</legend>
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
        <p className="muted small">{OUTING_HINT[outing]}</p>
      </fieldset>
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
          给这次安排起个名
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
          <div className="meta-zone">
            <p>
              这一餐按原时区 <strong>{draft.timeZone}</strong> 记录，你当前在 <strong>{viewerZone}</strong>。
            </p>
            {errors.timeZone && (
              <p id="meal-zone-err" className="field-error">
                {errors.timeZone}
              </p>
            )}
            <button
              id="meal-zone"
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onChange({ timeZone: viewerZone })}
              aria-describedby={errors.timeZone ? 'meal-zone-err' : undefined}
            >
              改用我当前的时区
            </button>
          </div>
        </div>
      )}


    </fieldset>
  );
}
