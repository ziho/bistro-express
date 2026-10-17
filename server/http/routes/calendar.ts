import type { Hono } from 'hono';
import { buildCalendarEvent, buildIcs, calendarExportState, icsFileName } from '../../../shared/calendarEvent.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { UUID_RE } from '../../lib/validation.js';
import type { Ctx, HonoEnv } from '../types.js';

/** The plan link written into the event points at the listener the file was requested from. */
function planUrl(c: Ctx, id: string): string {
  const { config } = c.get('app');
  const base = c.get('listener') === 'admin' ? config.adminBaseUrl : config.publicBaseUrl;
  return `${base}/plans/${id}`;
}

/**
 * One-off .ics export of a saved meal. Registered inside the guest routes, so it sits behind the
 * same access guard as every plan API (public date gate or private listener) — there is no public
 * or bearer link. Read only: built from the frozen plan, never writes, never cached.
 */
export function registerCalendarRoute(r: Hono<HonoEnv>): void {
  r.get('/plans/:id/calendar.ics', (c) => {
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) throw notFound('这个计划不存在');
    const app = c.get('app');
    const plan = app.repos.plans.get(id);
    if (!plan) throw notFound('这个计划不存在');
    if (calendarExportState(plan, app.clock()) === 'cancelled') {
      throw unprocessable('calendar_unavailable', '这一餐已经取消，不能再添加到日历');
    }
    const ics = buildIcs(buildCalendarEvent(plan, planUrl(c, plan.id)));
    return c.body(ics, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFileName(plan.shortId)}"`,
      'Cache-Control': 'private, no-store',
    });
  });
}
