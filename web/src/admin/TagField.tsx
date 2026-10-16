import { splitTags } from '../../../shared/restaurant';
import type { ItemKind } from './ItemForm';

interface Props {
  kind: ItemKind;
  value: string;
  error?: string;
  /** Tags already used by other items, offered as one-tap chips (restaurants only). */
  suggestions: string[];
  onChange: (value: string) => void;
}

const ID = 'item-tags';

export function TagField({ kind, value, error, suggestions, onChange }: Props) {
  const current = splitTags(value);
  const toggle = (tag: string) =>
    onChange((current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]).join(' '));
  const describedBy = [kind === 'restaurant' ? `${ID}-hint` : '', error ? `${ID}-err` : ''].filter(Boolean).join(' ');

  return (
    <div className="field">
      <label className="field-label" htmlFor={ID}>
        {kind === 'restaurant' ? (
          <>
            分类标签 <span className="muted small">（可填多个，空格或逗号分隔）</span>
          </>
        ) : (
          <>
            标签 <span className="muted small">（空格或逗号分隔）</span>
          </>
        )}
      </label>
      <input
        id={ID}
        className="input"
        value={value}
        placeholder={kind === 'restaurant' ? '川菜 火锅 约会' : '快手 下饭 约会'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {kind === 'restaurant' && (
        <p id={`${ID}-hint`} className="field-hint">
          标签就是餐厅的分类，可以同时写菜系、场景和口味，例如「川菜 火锅 约会 适合聚餐」。同一个标签可以给多家餐厅用，点餐时能按标签筛选。
        </p>
      )}
      {kind === 'restaurant' && suggestions.length > 0 && (
        <div className="chip-row" role="group" aria-label="已有标签，点一下添加或移除">
          {suggestions.map((t) => (
            <button key={t} type="button" className="chip chip-tag" aria-pressed={current.includes(t)} onClick={() => toggle(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p id={`${ID}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
