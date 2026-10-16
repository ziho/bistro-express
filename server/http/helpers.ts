import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ADMIN_COOKIE, BASE_PATH, GUEST_COOKIE } from '../../shared/constants.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { IDEMPOTENCY_KEY_RE } from '../lib/validation.js';
import type { SessionKind } from '../repos/sessions.js';
import type { Ctx } from './types.js';

export function ok<T>(c: Ctx, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, data }, status);
}

export function apiError(c: Ctx, status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
  return c.json({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
}

export async function readJson(c: Ctx): Promise<{ raw: string; value: unknown }> {
  const raw = await c.req.text();
  if (!raw) return { raw, value: {} };
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw badRequest('请求内容不是有效的 JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('请求内容必须是 JSON 对象');
  }
  return { raw, value };
}

export function idempotencyKey(c: Ctx): string {
  const key = c.req.header('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw badRequest('缺少有效的 Idempotency-Key 请求头');
  return key;
}

const cookieName = (kind: SessionKind) => (kind === 'guest' ? GUEST_COOKIE : ADMIN_COOKIE);

export function readSessionToken(c: Ctx, kind: SessionKind): string {
  return getCookie(c, cookieName(kind)) ?? '';
}

export function hasSession(c: Ctx, kind: SessionKind): boolean {
  const app = c.get('app');
  if (kind === 'admin' && c.get('listener') !== 'admin') return false;
  const token = readSessionToken(c, kind);
  return Boolean(token && app.repos.sessions.find(token, kind, app.clock()));
}

export function setSessionCookie(c: Ctx, kind: SessionKind, token: string, maxAgeSeconds: number) {
  setCookie(c, cookieName(kind), token, {
    path: BASE_PATH,
    httpOnly: true,
    secure: c.get('app').config.cookieSecure,
    sameSite: 'Lax',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(c: Ctx, kind: SessionKind) {
  deleteCookie(c, cookieName(kind), { path: BASE_PATH, secure: c.get('app').config.cookieSecure });
}

/** Guest features: a guest session, or (internal listener only) an admin session. */
export function requireGuestAccess(c: Ctx): void {
  if (hasSession(c, 'guest')) return;
  if (c.get('listener') === 'admin' && hasSession(c, 'admin')) return;
  throw unauthorized();
}

export function requireAdmin(c: Ctx): void {
  if (!hasSession(c, 'admin')) throw unauthorized('请先登录管理后台');
}

/** Rate-limit key for the requesting client. Forwarded headers are only trusted behind our proxy. */
export function clientKey(c: Ctx): string {
  const app = c.get('app');
  if (app.config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    const last = forwarded?.split(',').pop()?.trim();
    if (last) return last.slice(0, 64);
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
