import { Plus, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { PANTRY_LIMITS } from '../../../../shared/constants';
import { PANTRY_PROBLEM_TEXT, pantrySuggestions, type PantryAddResult } from '../../../../shared/pantry';
import { PantryStorageNotice } from '../../components/PantryBits';
import { pantryUpdatedText } from '../../lib/pantryFinder';
import { usePantry } from '../../lib/pantryStore';

interface Feedback {
  added: string[];
  duplicates: string[];
  problems: string[];
}

/** Everything up to and including the last separator: the part of the input already finished. */
const finishedPart = (text: string): string => /^[\s\S]*[,，、;；\r\n]/.exec(text)?.[0] ?? '';

function feedbackOf(result: PantryAddResult): Feedback {
  return {
    added: result.added,
    duplicates: result.duplicates,
    problems: result.rejected.map((r) =>
      r.reason === 'paste_too_long' ? PANTRY_PROBLEM_TEXT.paste_too_long : `「${r.value}」${PANTRY_PROBLEM_TEXT[r.reason]}`,
    ),
  };
}

/**
 * Add / remove the ingredients remembered on this device. Typing or pasting several names works
 * with commas, 顿号, semicolons or line breaks. Refused names stay in the input with the reason;
 * nothing is cut short or silently dropped.
 */
export function PantryPanel({ catalogNames }: { catalogNames: readonly string[] }) {
  const uid = useId();
  const { pantry, storage, add, remove, clear } = usePantry();
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const suggestions = pantrySuggestions(catalogNames, text, pantry);
  const updated = pantryUpdatedText(pantry.updatedAt);
  const inputId = `${uid}-input`;
  const feedbackId = `${uid}-feedback`;
  const full = pantry.names.length >= PANTRY_LIMITS.names;

  const submit = (value: string) => {
    if (!value.trim()) return;
    const result = add(value);
    setFeedback(feedbackOf(result));
    // Keep what was refused so it can be fixed; a refused paste is kept whole.
    const pasteRefused = result.rejected.some((r) => r.reason === 'paste_too_long');
    setText(pasteRefused ? value : result.rejected.map((r) => r.value).join('\n'));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Enter that only confirms an IME composition must not add anything.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit(text);
  };

  /** Removed chips take their button with them: keep focus on the neighbouring chip, or the input. */
  const removeAt = (name: string, index: number) => {
    remove(name);
    window.requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.pantry-chip-remove') ?? [];
      const next = buttons[Math.min(index, buttons.length - 1)];
      if (next) next.focus();
      else inputRef.current?.focus();
    });
  };

  const hasProblems = Boolean(feedback?.problems.length);

  return (
    <div className="pantry-panel">
      <p className="muted small pantry-intro">
        只保存在这台设备上，不会上传；不记录数量和保质期。最多 {PANTRY_LIMITS.names} 样，每样不超过 {PANTRY_LIMITS.name} 个字。
      </p>
      <PantryStorageNotice storage={storage} onClear={clear} />

      <div className="field pantry-field">
        <label className="field-label" htmlFor={inputId}>
          家里现有的食材
        </label>
        <div className="pantry-input-row">
          <textarea
            id={inputId}
            ref={inputRef}
            className="input textarea pantry-input"
            rows={2}
            value={text}
            placeholder="比如：鸡蛋、番茄、土豆（可一次粘贴多行）"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={hasProblems || undefined}
            aria-describedby={feedback ? feedbackId : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => submit(text)} disabled={!text.trim()}>
            <Plus aria-hidden="true" />
            加入
          </button>
        </div>
        <p className="field-hint">用逗号、顿号、分号或换行分开；回车加入，Shift + 回车换行。</p>
        {suggestions.length > 0 && (
          <div className="chip-row pantry-suggestions" role="group" aria-label="菜单里已有的食材名称">
            {suggestions.map((name) => (
              <button key={name} type="button" className="chip chip-static chip-wrap" onClick={() => submit(`${finishedPart(text)}${name}`)}>
                <Plus aria-hidden="true" className="chip-icon" />
                {name}
              </button>
            ))}
          </div>
        )}
        <div id={feedbackId} role="status" aria-live="polite" className="pantry-feedback">
          {feedback?.added.length ? <p className="small">已加入：{feedback.added.join('、')}</p> : null}
          {feedback?.duplicates.length ? <p className="small muted">已经在清单里：{feedback.duplicates.join('、')}</p> : null}
          {hasProblems && (
            <div className="field-error">
              <p>没有加入，已留在输入框里：</p>
              <ul>
                {feedback!.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="pantry-list-head">
        <h3 className="shop-subtitle">
          已记下 {pantry.names.length} 样{full ? '（已满）' : ''}
        </h3>
        {updated && <span className="muted small">上次更新 {updated}</span>}
      </div>
      {pantry.names.length === 0 ? (
        <p className="muted small">还没有记下任何食材。</p>
      ) : (
        <>
          <ul className="pantry-chips" aria-label="已记下的现有食材" ref={listRef}>
            {pantry.names.map((name, index) => (
              <li key={name} className="pantry-chip">
                <span className="pantry-chip-name">{name}</span>
                <button type="button" className="pantry-chip-remove" aria-label={`移除 ${name}`} onClick={() => removeAt(name, index)}>
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="pantry-clear">
            {confirmClear ? (
              <div className="shop-manual-buttons" role="group" aria-label="确认清空现有食材">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>
                  不清空
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger-solid"
                  onClick={() => {
                    clear();
                    setConfirmClear(false);
                    setFeedback(null);
                    window.requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                >
                  确定清空 {pantry.names.length} 样
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirmClear(true)}>
                清空
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
