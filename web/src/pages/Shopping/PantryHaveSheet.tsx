import { useState } from 'react';
import { SHOPPING_STATUS_LABELS } from '../../../../shared/shopping';
import type { ShoppingList } from '../../../../shared/types';
import { ShoppingSources } from '../../components/ShoppingBits';
import { Sheet } from '../../components/Sheet';
import type { ShoppingWriteResult } from './useShoppingWriter';

export type ShoppingBase = Pick<ShoppingList, 'planVersion' | 'revision'>;

/** Captured when the sheet opens: which pending items the pantry suggested, and the list they were read from. */
export interface HaveSession {
  id: number;
  keys: string[];
  base: ShoppingBase;
}

interface Props {
  session: HaveSession | null;
  list: ShoppingList;
  online: boolean;
  /** Another shopping write is in flight. */
  busy: boolean;
  lockText: string | null;
  onSubmit: (keys: string[], base: ShoppingBase) => Promise<ShoppingWriteResult>;
  onClose: (saved: boolean) => void;
}

interface Problem {
  message: string;
  retry: boolean;
}

/**
 * Explicit confirmation before marking pantry matches 家里已有. Nothing is marked by presence on the
 * pantry list alone: every suggested item is shown with all its sources (quantities and notes)
 * and the user confirms they are enough for this meal. One batch = one revision on the server.
 */
export function PantryHaveSheet(props: Props) {
  const { session, onClose } = props;
  return (
    <Sheet open={session !== null} onClose={() => onClose(false)} title="家里已有，够这一餐用吗？" variant="drawer">
      {session && <HaveReview key={session.id} {...props} session={session} />}
    </Sheet>
  );
}

function HaveReview({ session, list, online, busy, lockText, onSubmit, onClose }: Props & { session: HaveSession }) {
  const [selected, setSelected] = useState(() => new Set(session.keys));
  const [base, setBase] = useState<ShoppingBase>(session.base);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const items = new Map(list.items.map((i) => [i.key, i]));
  const pendingNow = (key: string) => items.get(key)?.status === 'pending';
  const chosen = session.keys.filter((key) => selected.has(key) && pendingNow(key));
  const listMoved = list.planVersion !== base.planVersion || list.revision !== base.revision;
  const blocked = !list.writable || !online || busy || submitting;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async () => {
    if (blocked || chosen.length === 0) return;
    setSubmitting(true);
    setProblem(null);
    const result = await onSubmit(chosen, base);
    setSubmitting(false);
    if (result.ok) {
      onClose(true);
      return;
    }
    if (result.kind === 'network') {
      setProblem({ message: result.message, retry: true });
      return;
    }
    if (result.current) {
      // Refused against an older list: the rows below now show the latest state. The selection
      // is kept, and only a second, explicit confirmation is sent against the new base.
      setBase({ planVersion: result.current.planVersion, revision: result.current.revision });
      setProblem({ message: `${result.message}。勾选保持不变，核对下面的最新内容后再确认。`, retry: false });
      return;
    }
    setProblem({ message: result.message, retry: false });
  };

  return (
    <div className="have-review">
      <p className="small">
        这些待采购的食材出现在这台设备记下的现有食材里。勾选的会标记为「家里已有」，表示<strong>家里的量够这一餐用</strong>；不勾选的保持待采购。
      </p>
      <p className="muted small">只比较名称，不核对数量。之后修改记下的现有食材，不会改变已保存的状态。</p>

      {lockText && <p className="notice notice-sky small">{lockText}你的勾选仍保留，但不能保存。</p>}
      {list.writable && !online && <p className="notice notice-butter small">现在离线，恢复网络后才能保存。</p>}
      {listMoved && !problem && (
        <p className="notice notice-sky small">清单在打开后有更新，下面显示的是最新内容。确认时会先核对，有冲突会请你再确认一次。</p>
      )}
      {problem && (
        <div className="notice notice-butter small" role="alert">
          <div>
            <p>{problem.message}</p>
          </div>
        </div>
      )}

      <ul className="have-list">
        {session.keys.map((key) => {
          const item = items.get(key);
          const inputId = `have-${session.id}-${key}`;
          if (!item || item.status !== 'pending') {
            return (
              <li key={key} className="have-row is-gone">
                <p className="have-name">{item?.name ?? key}</p>
                <p className="muted small">
                  {item ? `已经是「${SHOPPING_STATUS_LABELS[item.status]}」，不会再改动` : '已经不在清单里'}
                </p>
              </li>
            );
          }
          return (
            <li key={key} className="have-row">
              <div className="have-check">
                <input
                  id={inputId}
                  type="checkbox"
                  className="have-checkbox"
                  checked={selected.has(key)}
                  disabled={submitting}
                  onChange={() => toggle(key)}
                />
                <label htmlFor={inputId} className="have-name">
                  {item.name}
                </label>
              </div>
              {item.needsReview && <p className="shop-review">需求已变化，请重新确认</p>}
              <ShoppingSources name={item.name} sources={item.sources} />
            </li>
          );
        })}
      </ul>

      <div className="have-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onClose(false)} disabled={submitting}>
          先不标记
        </button>
        <button
          type="button"
          className={`btn btn-primary${blocked || chosen.length === 0 ? ' is-disabled' : ''}`}
          aria-disabled={blocked || chosen.length === 0 || undefined}
          onClick={() => void submit()}
        >
          {submitting ? '保存中…' : problem?.retry ? '重试' : chosen.length ? `确认这 ${chosen.length} 样够用` : '请先勾选'}
        </button>
      </div>
    </div>
  );
}
