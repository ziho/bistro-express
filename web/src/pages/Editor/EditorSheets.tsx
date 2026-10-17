import { Link } from 'react-router';
import type { Plan } from '../../../../shared/types';
import { OUTING_CHOICE_LABEL, type OutingKind } from '../../../../shared/venue';
import { Sheet } from '../../components/Sheet';

interface OutingSwitchProps {
  pending: { kind: OutingKind; drop: string[] } | null;
  /** True when the venue already chosen is among the ones that would be removed. */
  dropsSelected: boolean;
  nameOf: (id: string) => string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Switching to an outing some candidates do not fit: nothing is removed without a confirmation. */
export function OutingSwitchSheet({ pending, dropsSelected, nameOf, onCancel, onConfirm }: OutingSwitchProps) {
  const label = pending ? OUTING_CHOICE_LABEL[pending.kind] : '';
  return (
    <Sheet
      open={pending !== null}
      onClose={onCancel}
      title={`换成「${label}」？`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            先不换
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            移出 {pending?.drop.length ?? 0} 家并切换
          </button>
        </>
      }
    >
      <p>
        下面这些候选不适合「{label}」，切换后会从候选里移出{dropsSelected ? '，已选定的店也会清除' : ''}：
      </p>
      <ul className="summary-list">
        {pending?.drop.map((id) => (
          <li key={id}>
            <span>{nameOf(id)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">已选的菜不受影响。不想移出的话，可以先不换。</p>
    </Sheet>
  );
}

interface ConflictProps {
  conflict: Plan | null;
  planId: string | undefined;
  busy: boolean;
  onClose: () => void;
  onOverride: (current: Plan) => void;
}

/** Someone saved this plan elsewhere first: the local draft is kept; overriding is explicit. */
export function ConflictSheet({ conflict, planId, busy, onClose, onOverride }: ConflictProps) {
  return (
    <Sheet open={conflict !== null} onClose={onClose} title="计划在别处被改过了">
      <p>
        这个计划已经在其他设备上{conflict?.status === 'cancelled' ? '取消' : `更新到第 ${conflict?.version} 版`}。你的修改仍保存在本机草稿里，没有丢失。
      </p>
      <div className="stack-actions">
        <Link className="btn btn-ghost" to={`/plans/${planId}`}>
          先看看最新版本
        </Link>
        {conflict?.status === 'active' && (
          <button type="button" className="btn btn-primary" onClick={() => onOverride(conflict)} disabled={busy}>
            用我的版本覆盖
          </button>
        )}
      </div>
    </Sheet>
  );
}
