import { DISH_LIMITS } from '../../../../shared/constants';
import type { DishFieldErrors, DishFormState, IngredientRow, IngredientRowError } from '../../lib/dishForm';
import { IngredientEditor } from './IngredientEditor';

interface Props {
  state: DishFormState;
  errors: DishFieldErrors;
  ingredientErrors: Record<string, IngredientRowError>;
  open: boolean;
  onToggle: (open: boolean) => void;
  onChange: (patch: Partial<DishFormState>) => void;
  onIngredientsChange: (rows: IngredientRow[]) => void;
}

interface SmallFieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  max: number;
  placeholder?: string;
  numeric?: boolean;
  onChange: (v: string) => void;
}

function SmallField({ id, label, value, error, max, placeholder, numeric, onChange }: SmallFieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        maxLength={max}
        inputMode={numeric ? 'numeric' : undefined}
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Optional cooking and purchase details, grouped in one disclosure. The form opens it whenever
 * the dish already has any of these values (or one of them has an error), so nothing saved is hidden.
 */
export function DishDetailsFields({ state, errors, ingredientErrors, open, onToggle, onChange, onIngredientsChange }: Props) {
  return (
    <details className="dish-more" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary className="dish-more-summary">
        <span>主料、耗时与采购</span>
        <span className="muted small">（都可以不填）</span>
      </summary>
      <div className="dish-more-body">
        <IngredientEditor rows={state.ingredientRows} errors={ingredientErrors} onChange={onIngredientsChange} />
        <div className="dish-time-grid">
          <SmallField
            id="item-totalMinutes"
            label="总耗时（分钟）"
            value={state.totalMinutes}
            error={errors.totalMinutes}
            max={5}
            placeholder="比如：40"
            numeric
            onChange={(v) => onChange({ totalMinutes: v })}
          />
          <SmallField
            id="item-activeMinutes"
            label="动手时间（分钟）"
            value={state.activeMinutes}
            error={errors.activeMinutes}
            max={5}
            placeholder="比如：15"
            numeric
            onChange={(v) => onChange({ activeMinutes: v })}
          />
        </div>
        <p className="field-hint dish-time-hint">动手时间是真正需要站在灶台前的时间，不会超过总耗时。只填一个也可以。</p>
        <SmallField
          id="item-servingText"
          label="份量"
          value={state.servingText}
          error={errors.servingText}
          max={DISH_LIMITS.servingText}
          placeholder="比如：一盘（两人分享）/ 一人份"
          onChange={(v) => onChange({ servingText: v })}
        />
        <div className="field">
          <label className="field-label" htmlFor="item-shoppingNote">
            采购提醒
          </label>
          <textarea
            id="item-shoppingNote"
            className="input textarea"
            rows={2}
            maxLength={DISH_LIMITS.shoppingNote}
            placeholder="整道菜的采购提示，比如：周末去菜市场买更新鲜"
            value={state.shoppingNote}
            aria-invalid={errors.shoppingNote ? true : undefined}
            aria-describedby={errors.shoppingNote ? 'item-shoppingNote-err' : undefined}
            onChange={(e) => onChange({ shoppingNote: e.target.value })}
          />
          {errors.shoppingNote && (
            <p id="item-shoppingNote-err" className="field-error">
              {errors.shoppingNote}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
