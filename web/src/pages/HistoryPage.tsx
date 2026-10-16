import { useMemo } from 'react';
import { addDays, isPastDate } from '../../../shared/time';
import type { Plan } from '../../../shared/types';
import { usePlans } from '../api/queries';
import { EmptyPlate } from '../components/Illustrations';
import { Loading } from '../components/Loading';
import { PlanCard } from '../components/PlanCard';
import { useToday } from '../lib/hooks';
import { planDisplay } from '../lib/planView';

function groupByMonth(plans: Plan[]): [string, Plan[]][] {
  const map = new Map<string, Plan[]>();
  for (const p of plans) {
    const [y, m] = planDisplay(p).date.split('-');
    const label = `${y}年${Number(m)}月`;
    map.set(label, [...(map.get(label) ?? []), p]);
  }
  return [...map.entries()];
}

export function HistoryPage() {
  const today = useToday();
  const plans = usePlans({ to: addDays(today, 2) });
  const past = useMemo(
    () =>
      (plans.data ?? [])
        .filter((p) => isPastDate(p.date, p.timeZone))
        .sort((a, b) => {
          const va = planDisplay(a);
          const vb = planDisplay(b);
          return `${vb.date} ${vb.time ?? ''}`.localeCompare(`${va.date} ${va.time ?? ''}`);
        }),
    [plans.data],
  );

  return (
    <div className="history">
      <h1>历史计划</h1>
      <p className="muted">已经过去的计划只能查看；喜欢的话可以点进去「再来一顿」。</p>
      {plans.isPending ? (
        <Loading />
      ) : plans.isError ? (
        <p className="error-text">加载失败：{plans.error.message}</p>
      ) : past.length === 0 ? (
        <div className="empty-state">
          <EmptyPlate className="empty-art" />
          <p>还没有历史记录。</p>
        </div>
      ) : (
        groupByMonth(past).map(([month, list]) => (
          <section key={month} className="history-month" aria-label={month}>
            <h2 className="section-title">{month}</h2>
            <ul className="plan-list">
              {list.map((p) => (
                <li key={p.id}>
                  <PlanCard plan={p} showDate />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
