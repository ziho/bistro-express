import { Hono } from 'hono';
import { NOTIFICATION_HISTORY } from '../../../shared/constants.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { UUID_RE } from '../../lib/validation.js';
import { ok } from '../helpers.js';
import type { Ctx, HonoEnv } from '../types.js';

/** Digits only, no sign, fraction, exponent or leading zero; the length cap rejects huge raw values early. */
const POSITIVE_INT_RE = /^[1-9]\d{0,5}$/;

function readPositiveInt(c: Ctx, name: string, fallback: number, max: number, label: string): number {
  const values = c.req.queries(name);
  if (!values) return fallback;
  const raw = values.length === 1 ? values[0]! : '';
  const value = POSITIVE_INT_RE.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value > max) {
    throw badRequest(`${label}必须是 1 到 ${max} 之间的整数`, { field: name });
  }
  return value;
}

/** null = no paging parameters: the legacy array response for older admin tabs. */
export function parseHistoryQuery(c: Ctx): { page: number; pageSize: number } | null {
  if (c.req.queries('page') === undefined && c.req.queries('pageSize') === undefined) return null;
  return {
    page: readPositiveInt(c, 'page', 1, NOTIFICATION_HISTORY.maxPage, '页码'),
    pageSize: readPositiveInt(c, 'pageSize', NOTIFICATION_HISTORY.defaultPageSize, NOTIFICATION_HISTORY.maxPageSize, '每页条数'),
  };
}

/** Private listener only (mounted under the admin routes). */
export function notificationRoutes() {
  const r = new Hono<HonoEnv>();

  r.get('/plans', (c) => ok(c, c.get('app').planService.list({})));

  r.get('/notifications', (c) => {
    const app = c.get('app');
    const query = parseHistoryQuery(c);
    if (!query) return ok(c, app.repos.notifications.list(NOTIFICATION_HISTORY.legacyLimit, app.clock()));
    return ok(c, app.repos.notifications.listPage(query.page, query.pageSize, app.clock()));
  });

  r.post('/notifications/retry-held', (c) => {
    const app = c.get('app');
    const count = app.repos.notifications.retryAllHeld(app.clock(), app.provider.listRecipients());
    if (count) app.worker.kick();
    return ok(c, { requeued: count });
  });

  r.post('/notifications/:id/retry', (c) => {
    const app = c.get('app');
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) throw notFound();
    const result = app.repos.notifications.retry(id, app.clock(), app.provider.listRecipients());
    if (result === 'missing') throw notFound('通知记录不存在');
    if (result === 'expired') {
      throw conflict('expired', `这条通知已超过 ${NOTIFICATION_HISTORY.retentionDays} 天，不再重试，记录会被自动删除`);
    }
    if (result === 'stale') throw conflict('stale', '这条通知已被更新的版本取代，无需重试');
    if (result === 'not_retryable') throw conflict('not_retryable', '只有发送失败或未送达的通知可以重试');
    if (result === 'unconfigured') throw conflict('unconfigured', '推送还未启用，或没有启用的设备');
    if (result === 'nothing_to_retry') {
      throw conflict('nothing_to_retry', '没有可重试的设备：未送达的设备已停用或删除，已送达的设备不会重复推送');
    }
    app.worker.kick();
    return ok(c, { requeued: true });
  });

  return r;
}
