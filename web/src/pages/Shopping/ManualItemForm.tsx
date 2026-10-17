import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ShoppingList } from '../../../../shared/types';
import { SHOPPING_LIMITS } from '../../../../shared/constants';
import { manualItemErrors, normalizeManualFields, type ManualField } from '../../../../shared/shopping';

export type ManualValues = Record<ManualField, string>;

export const EMPTY_MANUAL: ManualValues = { name: '', quantity: '', note: '' };

export type ManualSubmitResult = { ok: true } | { ok: false; message: string; field: string | null; current?: ShoppingList };

interface Props {
  mode: 'create' | 'edit';
  initial?: ManualValues;
  /** Another write is in flight: submitting waits, typing never does. */
  busy: boolean;
  disabled?: boolean;
  onSubmit: (values: ManualValues) => Promise<ManualSubmitResult>;
  onCancel?: () => void;
}

const FIELDS: { field: ManualField; label: string; optional: boolean; placeholder: string }[] = [
  { field: 'name', label: '要买的东西', optional: false, placeholder: '比如：可乐、厨房纸' },
  { field: 'quantity', label: '数量', optional: true, placeholder: '比如：2瓶、一包' },
  { field: 'note', label: '备注', optional: true, placeholder: '比如：无糖的、常买的牌子' },
];

/** Enter that only confirms an IME composition must not submit the form. */
function guardComposition(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
}

/**
 * Add / edit one manual item. The typed values live only here, so background refetches and
 * failed requests never clear them; they are cleared only after a confirmed create.
 */
export function ManualItemForm({ mode, initial = EMPTY_MANUAL, busy, disabled = false, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [values, setValues] = useState<ManualValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<ManualField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const refs = useRef<Partial<Record<ManualField, HTMLInputElement | null>>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || busy || disabled) return;
    const found = manualItemErrors(values);
    setErrors(found);
    const firstInvalid = FIELDS.find((f) => found[f.field]);
    if (firstInvalid) {
      refs.current[firstInvalid.field]?.focus();
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await onSubmit(normalizeManualFields(values));
    setSubmitting(false);
    if (result.ok) {
      if (mode === 'create') {
        setValues(EMPTY_MANUAL);
        refs.current.name?.focus();
      }
      return;
    }
    const field = FIELDS.find((f) => f.field === result.field);
    if (field) {
      setErrors({ [field.field]: result.message });
      refs.current[field.field]?.focus();
    } else {
      setSubmitError(result.message);
    }
  };

  const set = (field: ManualField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    // A changed value is a new request (new idempotency key), so it is no longer a "retry".
    setSubmitError(null);
  };

  return (
    <form className={`shop-manual-form shop-manual-${mode}`} onSubmit={(e) => void submit(e)} noValidate>
      <div className="shop-manual-fields">
        {FIELDS.map(({ field, label, optional, placeholder }) => {
          const id = `${uid}-${field}`;
          const error = errors[field];
          const length = normalizeManualFields(values)[field].length;
          const max = SHOPPING_LIMITS[field];
          return (
            <div key={field} className={`field shop-field-${field}`}>
              <label className="field-label" htmlFor={id}>
                {label}
                {optional && <span className="muted small">（可选）</span>}
              </label>
              <input
                id={id}
                ref={(el) => {
                  refs.current[field] = el;
                }}
                className="input"
                value={values[field]}
                placeholder={placeholder}
                autoComplete="off"
                disabled={submitting}
                enterKeyHint={mode === 'create' ? 'done' : 'enter'}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                aria-required={optional ? undefined : true}
                onChange={(e) => set(field, e.target.value)}
                onKeyDown={guardComposition}
              />
              {error ? (
                <p id={`${id}-error`} className="field-error">
                  {error}
                </p>
              ) : (
                length > max * 0.8 && (
                  <p className="field-hint">
                    {length}/{max}
                  </p>
                )
              )}
            </div>
          );
        })}
      </div>
      {submitError && (
        <p className="error-text small" role="alert">
          {submitError}
        </p>
      )}
      <div className="shop-manual-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>
            取消
          </button>
        )}
        <button
          type="submit"
          className={`btn btn-primary btn-sm${disabled || busy || submitting ? ' is-disabled' : ''}`}
          // Not `disabled`, so focus stays here across a failed attempt; submit() ignores repeats.
          aria-disabled={disabled || busy || submitting || undefined}
        >
          {submitting ? '保存中…' : submitError ? '重试' : mode === 'create' ? '加入清单' : '保存修改'}
        </button>
      </div>
    </form>
  );
}
