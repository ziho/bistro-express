import { APP_NAME } from '../../shared/constants.js';
import { formatDateLabel } from '../../shared/time.js';
import type { PlanEvent } from '../../shared/types.js';
import { formatLocation, OUTING_STANDARD_LABEL, outingKind } from '../../shared/venue.js';
import type { StoredPlan } from '../repos/plans.js';

const EVENT_TITLE: Record<PlanEvent, string> = {
  created: '新的用餐计划',
  updated: '用餐计划有更新',
  cancelled: '用餐计划已取消',
};

/** A drinks / dessert outing is never announced as a meal. */
const TREAT_EVENT_TITLE: Record<PlanEvent, string> = {
  created: '新的饮品甜品安排',
  updated: '饮品甜品安排有更新',
  cancelled: '饮品甜品安排已取消',
};

/** Calendars never sync back: a short reminder, written into new messages only (stored ones are never rewritten). */
const CALENDAR_HINT: Record<PlanEvent, string> = {
  created: '可在计划详情里添加到日历',
  updated: '如已添加到日历，请手动更新日程',
  cancelled: '如已添加到日历，请手动删除日程',
};

export interface BuiltMessage {
  title: string;
  body: string;
  url: string;
}

/** Full, self-contained summary built from the plan snapshot at write time. */
export function buildPlanMessage(plan: StoredPlan, event: PlanEvent, publicBaseUrl: string): BuiltMessage {
  const when = `${formatDateLabel(plan.date)} ${plan.mealLabel}${plan.localTime ? ` ${plan.localTime}` : ''}`;
  const lines: string[] = [`${plan.date}（${when}）`, `时区：${plan.timeZone}`];
  const kind = outingKind(plan);
  if (kind === 'home') {
    lines.push(`在家吃：${plan.dishes.map((d) => d.name).join('、') || '（未选菜）'}`);
  } else {
    const chosen = plan.selectedRestaurant?.name ?? '（未定）';
    lines.push(`${OUTING_STANDARD_LABEL[kind]}：${chosen}`);
    const where = formatLocation(plan.selectedRestaurant?.location);
    if (where) lines.push(`地区：${where}`);
    if (plan.candidates.length > 1) {
      lines.push(`候选：${plan.candidates.map((c) => c.name).join('、')}`);
    }
  }
  if (plan.note) lines.push(`备注：${plan.note}`);
  lines.push(`编号 #${plan.shortId} · 第 ${plan.version} 版`);
  lines.push(CALENDAR_HINT[event]);
  return {
    title: `${(kind === 'treat' ? TREAT_EVENT_TITLE : EVENT_TITLE)[event]} · ${when}`,
    body: lines.join('\n'),
    url: `${publicBaseUrl}/plans/${plan.id}`,
  };
}

export const PUSH_GROUP = APP_NAME;
