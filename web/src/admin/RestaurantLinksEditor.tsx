import { Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { CARD_QUICK_LINKS, DEFAULT_LINK_LABEL, LIMITS } from '../../../shared/constants';
import { newLinkRow, type LinkRow, type LinkRowError } from '../lib/linkRows';

interface Props {
  rows: LinkRow[];
  errors: Record<string, LinkRowError>;
  onChange: (rows: LinkRow[]) => void;
}

/** 相关链接: a list of display-name + URL rows (menu, official website, booking…). */
export function RestaurantLinksEditor({ rows, errors, onChange }: Props) {
  const labelInputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const full = rows.length >= LIMITS.restaurantLinks;

  const focusLabel = (key: string) => requestAnimationFrame(() => labelInputs.current.get(key)?.focus());

  const update = (key: string, patch: Partial<LinkRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = () => {
    if (full) return;
    const row = newLinkRow();
    onChange([...rows, row]);
    focusLabel(row.key);
  };

  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
    // Keep focus in the list: the row that took this place, else the previous one, else "add".
    const target = next[index] ?? next[index - 1];
    if (target) focusLabel(target.key);
    else requestAnimationFrame(() => addButton.current?.focus());
  };

  return (
    <fieldset className="field links-editor" aria-describedby="links-editor-hint">
      <legend className="field-label">相关链接</legend>
      <p id="links-editor-hint" className="field-hint">
        菜单、官网或订位页面都可以。前 {CARD_QUICK_LINKS} 条直接显示在餐厅卡片，其余在详情查看。名称留空时显示「
        {DEFAULT_LINK_LABEL}」。
      </p>
      {rows.length > 0 && (
        <ol className="links-editor-list">
          {rows.map((row, index) => {
            const error = errors[row.key] ?? {};
            const n = index + 1;
            const labelId = `${row.key}-label`;
            const urlId = `${row.key}-url`;
            return (
              <li key={row.key} className="links-editor-row">
                <div className="links-editor-field">
                  <label className="links-editor-label" htmlFor={labelId}>
                    链接 {n} · 显示名称
                  </label>
                  <input
                    ref={(el) => {
                      if (el) labelInputs.current.set(row.key, el);
                      else labelInputs.current.delete(row.key);
                    }}
                    id={labelId}
                    className="input"
                    maxLength={LIMITS.linkLabel}
                    placeholder={n === 1 ? '看菜单' : n === 2 ? '访问官网' : '订位'}
                    value={row.label}
                    aria-invalid={error.label ? true : undefined}
                    aria-describedby={error.label ? `${labelId}-err` : undefined}
                    onChange={(e) => update(row.key, { label: e.target.value })}
                  />
                  {error.label && (
                    <p id={`${labelId}-err`} className="field-error">
                      {error.label}
                    </p>
                  )}
                </div>
                <div className="links-editor-field">
                  <label className="links-editor-label" htmlFor={urlId}>
                    链接 {n} · 网址
                  </label>
                  <input
                    id={urlId}
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="input"
                    maxLength={LIMITS.url}
                    placeholder="https://…"
                    value={row.url}
                    aria-invalid={error.url ? true : undefined}
                    aria-describedby={error.url ? `${urlId}-err` : undefined}
                    onChange={(e) => update(row.key, { url: e.target.value })}
                  />
                  {error.url && (
                    <p id={`${urlId}-err`} className="field-error">
                      {error.url}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-btn links-editor-remove"
                  aria-label={`删除链接 ${n}${row.label.trim() ? `「${row.label.trim()}」` : ''}`}
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
          已有 {LIMITS.restaurantLinks} 个链接，这是上限。
        </p>
      ) : (
        <button ref={addButton} type="button" className="btn btn-ghost btn-sm links-editor-add" onClick={add}>
          <Plus aria-hidden="true" />
          添加链接
        </button>
      )}
    </fieldset>
  );
}
