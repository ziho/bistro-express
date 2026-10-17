import { Check, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { DISH_LIMITS, SUGGESTED_MENU_SECTIONS } from '../../../../shared/constants';
import { normalizeSections, orderSections } from '../../../../shared/dish';

interface Props {
  value: string[];
  /** Sections already used by other dishes (incl. old categories), offered for reuse. */
  existing: string[];
  error?: string;
  onChange: (sections: string[]) => void;
}

const ID = 'item-sections';

/**
 * 菜单分区: optional multi-select. Every chip is a toggle button (touch + keyboard); custom
 * sections are added with the text box and then behave like the suggested ones.
 */
export function SectionField({ value, existing, error, onChange }: Props) {
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const options = orderSections([...SUGGESTED_MENU_SECTIONS, ...existing, ...value]);
  const full = value.length >= DISH_LIMITS.sections;

  const toggle = (section: string) => {
    setCustomError(null);
    if (value.includes(section)) onChange(value.filter((s) => s !== section));
    else if (!full) onChange([...value, section]);
  };

  const addCustom = () => {
    const [section] = normalizeSections([custom]);
    if (!section) return;
    if (section.length > DISH_LIMITS.section) {
      setCustomError(`分区名不能超过 ${DISH_LIMITS.section} 个字`);
      return;
    }
    if (!value.includes(section)) {
      if (full) {
        setCustomError(`最多选 ${DISH_LIMITS.sections} 个分区，请先取消一个`);
        return;
      }
      onChange([...value, section]);
    }
    setCustom('');
    setCustomError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter adds the section instead of submitting the whole form.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addCustom();
    }
  };

  const message = customError ?? error;
  const describedBy = [`${ID}-hint`, message ? `${ID}-err` : ''].filter(Boolean).join(' ');

  return (
    <fieldset className="field section-field" aria-describedby={describedBy}>
      <legend className="field-label">
        菜单分区 <span className="muted small">（可多选，也可以不选）</span>
      </legend>
      <p id={`${ID}-hint`} className="field-hint">
        点一下选中，再点一下取消。一道菜可以放在多个分区；口味、场景等描述请写在下面的标签里。
      </p>
      <div className="chip-row" role="group" aria-label={`菜单分区，已选 ${value.length} 个`}>
        {options.map((s) => {
          const on = value.includes(s);
          return (
            <button key={s} type="button" className="chip chip-wrap" aria-pressed={on} disabled={!on && full} onClick={() => toggle(s)}>
              {on && <Check aria-hidden="true" className="chip-icon" />}
              {s}
            </button>
          );
        })}
      </div>
      <div className="section-custom">
        <label className="links-editor-label" htmlFor={`${ID}-custom`}>
          新的分区
        </label>
        <div className="input-with-action">
          <input
            id={`${ID}-custom`}
            className="input"
            maxLength={DISH_LIMITS.section}
            placeholder="比如：早餐、便当"
            value={custom}
            enterKeyHint="done"
            aria-invalid={customError ? true : undefined}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="btn btn-ghost" onClick={addCustom} disabled={!custom.trim()}>
            <Plus aria-hidden="true" />
            添加
          </button>
        </div>
      </div>
      {full && (
        <p className="field-hint" role="status">
          已选 {DISH_LIMITS.sections} 个分区，这是上限。
        </p>
      )}
      {message && (
        <p id={`${ID}-err`} className="field-error">
          {message}
        </p>
      )}
    </fieldset>
  );
}
