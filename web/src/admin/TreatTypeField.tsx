import { useId } from 'react';
import { inferTreatTypes, normalizeTreatTypes, TREAT_TYPE_LABEL, TREAT_TYPES, treatTypesText } from '../../../shared/treatType';
import type { TreatType } from '../../../shared/types';
import { toggleTreatType } from '../lib/venueForm';

interface Props {
  value: TreatType[];
  onChange: (next: TreatType[]) => void;
  /** Current tags of the form, for the 「按标签补上」 suggestion (exact known tags only). */
  tags: string[];
}

/** 饮品甜品类型 of the venue form: optional multi-select; nothing chosen is 未分类. */
export function TreatTypeField({ value, onChange, tags }: Props) {
  const id = useId();
  const suggested = inferTreatTypes(tags).filter((t) => !value.includes(t));
  return (
    <fieldset className="field type-picker" aria-describedby={`${id}-hint`}>
      <legend className="field-label">
        饮品甜品类型 <span className="muted small">（可选，可多选）</span>
      </legend>
      <div className="chip-row">
        {TREAT_TYPES.map((t) => (
          <label key={t} className="chip chip-radio">
            <input type="checkbox" checked={value.includes(t)} onChange={() => onChange(toggleTreatType(value, t))} />
            <span>{TREAT_TYPE_LABEL[t]}</span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} className="field-hint">
        一家店可以同时是好几类，比如「奶茶」+「蛋糕」。不选就是「未分类」；标签照常保留，用来写特色。
      </p>
      {suggested.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(normalizeTreatTypes([...value, ...suggested]))}>
          按标签补上：{treatTypesText(suggested)}
        </button>
      )}
    </fieldset>
  );
}
