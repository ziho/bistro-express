import { useId, useState } from 'react';
import { TREAT_TYPE_LABEL, TREAT_TYPES } from '../../../../shared/treatType';
import type { TreatType } from '../../../../shared/types';
import type { BatchFillResult } from '../../lib/bulkQueue';
import { toggleTreatType } from '../../lib/venueForm';

/**
 * Batch 饮品甜品类型 for the selected rows (never locked, imported or unselected ones). Only rows
 * marked 饮品甜品 change; 「添加」 keeps each row's own types, 「替换」 sets exactly these (none = 未分类).
 */
export function BatchTreatTypes({ selected, onApply }: { selected: number; onApply: (types: TreatType[], mode: 'add' | 'replace') => BatchFillResult }) {
  const id = useId();
  const [types, setTypes] = useState<TreatType[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (mode: 'add' | 'replace') => {
    const result = onApply(types, mode);
    setMessage(
      result.ok
        ? { ok: true, text: `已更新 ${result.applied} 行${result.unchanged ? `；${result.unchanged} 行不是饮品甜品或没有变化，未修改` : ''}` }
        : { ok: false, text: result.error },
    );
  };

  return (
    <section className="card bulk-tags" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="bulk-section-title">
        批量设置饮品甜品类型
      </h2>
      <p className="field-hint">作用于已选的 {selected} 行里用途含「饮品甜品」的店。可多选；每行之后仍可单独修改。</p>
      <div className="chip-row" role="group" aria-label="要设置的类型">
        {TREAT_TYPES.map((t) => (
          <label key={t} className="chip chip-radio">
            <input
              type="checkbox"
              checked={types.includes(t)}
              onChange={() => {
                setTypes((prev) => toggleTreatType(prev, t));
                setMessage(null);
              }}
            />
            <span>{TREAT_TYPE_LABEL[t]}</span>
          </label>
        ))}
      </div>
      <div className="bulk-toolbar-actions">
        <button type="button" className="btn btn-butter btn-sm" disabled={selected === 0 || types.length === 0} onClick={() => apply('add')}>
          添加到已选行
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={selected === 0} onClick={() => apply('replace')}>
          {types.length ? '替换已选行的类型' : '清空已选行的类型'}
        </button>
      </div>
      {message && (
        <p className={message.ok ? 'success-text small' : 'field-error'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
