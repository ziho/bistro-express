import { Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { DISH_LIMITS } from '../../../../shared/constants';
import { newIngredientRow, type IngredientRow, type IngredientRowError } from '../../lib/dishForm';

interface Props {
  rows: IngredientRow[];
  errors: Record<string, IngredientRowError>;
  onChange: (rows: IngredientRow[]) => void;
}

type Column = 'name' | 'quantity' | 'purchaseNote';

const COLUMNS: { key: Column; label: string; max: number; placeholder: string }[] = [
  { key: 'name', label: '主料', max: DISH_LIMITS.ingredientName, placeholder: '比如：鸡腿' },
  { key: 'quantity', label: '用量', max: DISH_LIMITS.ingredientQuantity, placeholder: '约300g / 半盒 / 适量' },
  { key: 'purchaseNote', label: '采购提示', max: DISH_LIMITS.purchaseNote, placeholder: '比如：去骨鸡腿、常买品牌' },
];

/** 主料: name + free-text quantity + purchase note per row. Not a complete ingredient list. */
export function IngredientEditor({ rows, errors, onChange }: Props) {
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const full = rows.length >= DISH_LIMITS.ingredients;

  const focusName = (key: string) => requestAnimationFrame(() => nameInputs.current.get(key)?.focus());

  const update = (key: string, patch: Partial<IngredientRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = () => {
    if (full) return;
    const row = newIngredientRow();
    onChange([...rows, row]);
    focusName(row.key);
  };

  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
    // Keep focus in the list: the row that took this place, else the previous one, else "add".
    const target = next[index] ?? next[index - 1];
    if (target) focusName(target.key);
    else requestAnimationFrame(() => addButton.current?.focus());
  };

  return (
    <fieldset className="field ingredient-editor" aria-describedby="ingredient-editor-hint">
      <legend className="field-label">主料</legend>
      <p id="ingredient-editor-hint" className="field-hint">
        只记几样主要的就好，不用列全。用量随便写（如「半盒」「一把」「约300g」「适量」），不做单位换算；空着的行保存时会忽略。
      </p>
      {rows.length > 0 && (
        <ol className="ingredient-list">
          {rows.map((row, index) => {
            const error = errors[row.key] ?? {};
            const n = index + 1;
            const named = row.name.trim() ? `「${row.name.trim()}」` : '';
            return (
              <li key={row.key} className="ingredient-row">
                {COLUMNS.map((col) => {
                  const id = `${row.key}-${col.key}`;
                  const message = error[col.key];
                  return (
                    <div key={col.key} className={`ingredient-field ingredient-${col.key}`}>
                      <label className="links-editor-label" htmlFor={id}>
                        {col.key === 'name' ? `主料 ${n}` : `${col.label}（主料 ${n}）`}
                      </label>
                      <input
                        ref={
                          col.key === 'name'
                            ? (el) => {
                                if (el) nameInputs.current.set(row.key, el);
                                else nameInputs.current.delete(row.key);
                              }
                            : undefined
                        }
                        id={id}
                        className="input"
                        maxLength={col.max}
                        placeholder={col.placeholder}
                        value={row[col.key]}
                        aria-invalid={message ? true : undefined}
                        aria-describedby={message ? `${id}-err` : undefined}
                        onChange={(e) => update(row.key, { [col.key]: e.target.value })}
                      />
                      {message && (
                        <p id={`${id}-err`} className="field-error">
                          {message}
                        </p>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="icon-btn ingredient-remove"
                  aria-label={`删除主料 ${n}${named}`}
                  title="删除这一行"
                  onClick={() => remove(index)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {full ? (
        <p className="field-hint" role="status">
          已有 {DISH_LIMITS.ingredients} 行主料，这是上限。
        </p>
      ) : (
        <button ref={addButton} type="button" className="btn btn-ghost btn-sm ingredient-add" onClick={add}>
          <Plus aria-hidden="true" />
          添加一行主料
        </button>
      )}
    </fieldset>
  );
}
