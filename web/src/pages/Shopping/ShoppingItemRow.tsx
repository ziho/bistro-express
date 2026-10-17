import { Check, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SHOPPING_STATUS_LABELS, SHOPPING_STATUSES } from '../../../../shared/shopping';
import type { ShoppingItem, ShoppingStatus } from '../../../../shared/types';
import { ShoppingSources } from '../../components/ShoppingBits';

interface Props {
  item: ShoppingItem;
  writable: boolean;
  /** Some write is in flight: every write control waits. */
  busy: boolean;
  /** This row's own write is in flight. */
  saving: boolean;
  onStatus: (item: ShoppingItem, status: ShoppingStatus) => void;
  onBeginEdit: (id: string) => void;
  onDeleteManual: (id: string, itemName: string) => Promise<boolean>;
}

export const itemSelector = (key: string) => `[data-shop-key="${CSS.escape(key)}"]`;

function ManualActions({
  source,
  item,
  busy,
  onEdit,
  onDelete,
}: {
  source: { manualId: string; name: string };
  item: ShoppingItem;
  busy: boolean;
  onEdit: () => void;
  onDelete: (id: string, itemName: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="shop-manual-buttons" role="group" aria-label={`确认删除手动补充的 ${source.name}`}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={busy}>
          不删了
        </button>
        <button
          type="button"
          className={`btn btn-sm btn-danger-solid${busy ? ' is-disabled' : ''}`}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) void onDelete(source.manualId, item.name).then((ok) => ok || setConfirming(false));
          }}
        >
          确定删除
        </button>
      </div>
    );
  }
  return (
    <div className="shop-manual-buttons">
      <button type="button" className="btn btn-ghost btn-sm" data-manual-edit={source.manualId} onClick={onEdit} disabled={busy}>
        <Pencil aria-hidden="true" />
        编辑<span className="sr-only">手动补充的 {source.name}</span>
      </button>
      <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
        <Trash2 aria-hidden="true" />
        删除<span className="sr-only">手动补充的 {source.name}</span>
      </button>
    </div>
  );
}

/** One ingredient group with every source and an explicit three-way status control. */
export function ShoppingItemRow({ item, writable, busy, saving, onStatus, onBeginEdit, onDeleteManual }: Props) {
  return (
    <li className={`shop-item shop-item-${item.status}`} data-shop-key={item.key} aria-busy={saving || undefined}>
      <div className="shop-item-head">
        <h3 className="shop-item-name" tabIndex={-1}>
          {item.name}
        </h3>
        {item.status !== 'pending' && (
          <span className={`badge shop-badge-${item.status}`}>
            <Check aria-hidden="true" />
            {SHOPPING_STATUS_LABELS[item.status]}
          </span>
        )}
      </div>
      {item.needsReview && <p className="shop-review">需求已变化，请重新确认</p>}

      <ShoppingSources
        name={item.name}
        sources={item.sources}
        renderManualActions={
          writable
            ? (source) => (
                <ManualActions source={source} item={item} busy={busy}
                  onEdit={() => onBeginEdit(source.manualId)} onDelete={onDeleteManual} />
              )
            : undefined
        }
      />

      {writable ? (
        <div className="shop-status" role="group" aria-label={`${item.name} 的采购状态`}>
          {SHOPPING_STATUSES.map((status) => {
            const active = item.status === status;
            return (
              <button
                key={status}
                type="button"
                className={`shop-status-btn shop-status-${status}`}
                data-status-btn={status}
                aria-pressed={active}
                // Not `disabled`: the pressed button keeps focus while its own write is saving.
                aria-disabled={busy && !active ? true : undefined}
                onClick={() => {
                  if ((!active || item.needsReview) && !busy) onStatus(item, status);
                }}
              >
                {active && <Check aria-hidden="true" />}
                {SHOPPING_STATUS_LABELS[status]}
                <span className="sr-only">（{item.name}）</span>
              </button>
            );
          })}
          {saving && (
            <span className="shop-saving muted small" aria-hidden="true">
              保存中…
            </span>
          )}
        </div>
      ) : (
        item.status === 'pending' && <p className="muted small shop-readonly-status">{SHOPPING_STATUS_LABELS.pending}</p>
      )}
    </li>
  );
}
