import type { Plan } from '../../../shared/types';
import { planDisplay } from './planView';

/** Plans grouped by the date they fall on for the viewer, each day sorted by time. */
export function groupByViewerDate(plans: Plan[]): Map<string, Plan[]> {
  const map = new Map<string, Plan[]>();
  const sorted = [...plans].sort((a, b) => {
    const va = planDisplay(a);
    const vb = planDisplay(b);
    return `${va.date} ${va.time ?? '99'}`.localeCompare(`${vb.date} ${vb.time ?? '99'}`);
  });
  for (const plan of sorted) {
    const date = planDisplay(plan).date;
    map.set(date, [...(map.get(date) ?? []), plan]);
  }
  return map;
}

/** Every date from today on that has at least one active plan, in order — no cap. */
export function upcomingActiveDays(byDate: Map<string, Plan[]>, today: string): [string, Plan[]][] {
  return [...byDate.entries()]
    .filter(([date, list]) => date >= today && list.some((p) => p.status === 'active'))
    .sort(([a], [b]) => a.localeCompare(b));
}
