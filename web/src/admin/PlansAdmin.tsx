import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { isPastDate } from '../../../shared/time';
import type { Plan } from '../../../shared/types';
import { api } from '../api/client';
import { EmptyPlate } from '../components/Illustrations';
import { Loading } from '../components/Loading';
import { PlanCard } from '../components/PlanCard';

type Scope = 'upcoming' | 'past' | 'cancelled';

export function PlansAdmin() {
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<Plan[]>('GET', '/admin/plans') });
  const [scope, setScope] = useState<Scope>('upcoming');

  const filtered = useMemo(() => {
    const all = plans.data ?? [];
    if (scope === 'cancelled') return all.filter((p) => p.status === 'cancelled').reverse();
    if (scope === 'past') return all.filter((p) => p.status === 'active' && isPastDate(p.date, p.timeZone)).reverse();
    return all.filter((p) => p.status === 'active' && !isPastDate(p.date, p.timeZone));
  }, [plans.data, scope]);

  if (plans.isPending) return <Loading />;
  if (plans.isError) return <p className="error-text">加载失败：{plans.error.message}</p>;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>计划</h1>
          <p className="muted small">所有提交的用餐计划。计划代表想吃什么，不代表已经吃过。</p>
        </div>
      </div>
      <div className="chip-row" role="group" aria-label="筛选计划">
        {(
          [
            ['upcoming', '即将到来'],
            ['past', '已过去'],
            ['cancelled', '已取消'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className="chip" aria-pressed={scope === value} onClick={() => setScope(value)}>
            {label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <EmptyPlate className="empty-art" />
          <p>这里还没有计划。</p>
        </div>
      ) : (
        <ul className="plan-list">
          {filtered.map((p) => (
            <li key={p.id}>
              <PlanCard plan={p} showDate standard />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
