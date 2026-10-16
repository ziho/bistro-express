import type { MiddlewareHandler } from 'hono';
import { API_PATH } from '../../shared/constants.js';
import { apiError } from './helpers.js';
import type { HonoEnv } from './types.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const securityHeaders: MiddlewareHandler<HonoEnv> = async (c, next) => {
  await next();
  c.header('Content-Security-Policy', CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  if (c.req.path.startsWith(`${API_PATH}/`)) c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
};

/**
 * Normalize a request path the way an attacker might try to disguise it
 * (percent-encoding, case, duplicate slashes, dot segments, backslashes).
 */
export function normalizeForMatching(rawPath: string): string | null {
  let p = rawPath;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(p);
      if (decoded === p) break;
      p = decoded;
    } catch {
      return null;
    }
  }
  p = p.replace(/\\/g, '/').replace(/[?#]/g, '_').replace(/\/{2,}/g, '/').toLowerCase();
  try {
    p = new URL(p, 'http://local').pathname;
  } catch {
    return null;
  }
  return p.replace(/\/{2,}/g, '/');
}

const ADMIN_PATH_RE = /^\/bistro\/(api\/)?admin(\/|$|;|\.)/;

export function isAdminPath(rawPath: string): boolean {
  const normalized = normalizeForMatching(rawPath);
  return normalized === null || ADMIN_PATH_RE.test(normalized);
}

/** Public listener: every admin UI/API path is a 404, regardless of headers or cookies. */
export const blockAdminOnPublic: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (isAdminPath(c.req.path)) {
    if (c.req.path.toLowerCase().includes('/api')) return apiError(c, 404, 'not_found', '找不到这个接口');
    return c.text('Not Found', 404);
  }
  return next();
};

/** Writes must come from the exact origin served by this listener. */
export const originGuard: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const app = c.get('app');
  const expected = c.get('listener') === 'admin' ? app.config.adminOrigin : app.config.publicOrigin;
  const origin = c.req.header('origin');
  if (origin !== expected) {
    return apiError(c, 403, 'bad_origin', '请求来源不被允许');
  }
  return next();
};
