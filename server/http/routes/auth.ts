import { Hono } from 'hono';
import { ADMIN_SESSION_SECONDS, GUEST_SESSION_SECONDS } from '../../../shared/constants.js';
import { isValidDateString } from '../../../shared/time.js';
import type { SessionInfo } from '../../../shared/types.js';
import { entryDateSecret, verifyScrypt } from '../../lib/crypto.js';
import { badRequest, HttpError } from '../../lib/errors.js';
import type { AuthLimiter } from '../../lib/rateLimit.js';
import {
  clearSessionCookie,
  clientKey,
  hasSession,
  ok,
  readJson,
  readSessionToken,
  requireAdmin,
  setSessionCookie,
} from '../helpers.js';
import type { Ctx, HonoEnv } from '../types.js';

function tooMany(seconds: number): HttpError {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new HttpError(429, 'rate_limited', `尝试次数太多啦，休息 ${minutes} 分钟再来吧`, { retryAfter: seconds });
}

/** Shared limiter flow: check budget, verify, then record failure or success. */
async function verifyWithLimit(c: Ctx, limiter: AuthLimiter, verify: () => Promise<boolean>): Promise<boolean> {
  const key = clientKey(c);
  const wait = limiter.blockedFor(key);
  if (wait > 0) throw tooMany(wait);
  const success = await verify();
  if (success) limiter.succeed(key);
  else limiter.fail(key);
  return success;
}

export function guestAuthRoutes() {
  const r = new Hono<HonoEnv>();

  r.get('/session', (c) => {
    const listener = c.get('listener');
    const admin = hasSession(c, 'admin');
    const info: SessionInfo = { listener, guest: hasSession(c, 'guest') || admin, admin };
    return ok(c, info);
  });

  r.post('/gate', async (c) => {
    const app = c.get('app');
    const { value } = await readJson(c);
    const date = (value as { date?: unknown }).date;
    if (typeof date !== 'string' || !isValidDateString(date)) throw badRequest('请选择一个日期');
    const success = await verifyWithLimit(c, app.limiters.gate, () =>
      verifyScrypt(entryDateSecret(date), app.config.entryDateHash),
    );
    if (!success) throw new HttpError(401, 'wrong_date', '好像不是这一天哦，再想想？');
    const session = app.repos.sessions.create('guest', GUEST_SESSION_SECONDS, app.clock());
    setSessionCookie(c, 'guest', session.token, GUEST_SESSION_SECONDS);
    return ok(c, { guest: true });
  });

  r.post('/logout', (c) => {
    const app = c.get('app');
    const now = app.clock();
    app.repos.sessions.revoke(readSessionToken(c, 'guest'), now);
    clearSessionCookie(c, 'guest');
    if (c.get('listener') === 'admin') {
      app.repos.sessions.revoke(readSessionToken(c, 'admin'), now);
      clearSessionCookie(c, 'admin');
    }
    return ok(c, { loggedOut: true });
  });

  return r;
}

export function adminAuthRoutes() {
  const r = new Hono<HonoEnv>();

  r.post('/login', async (c) => {
    const app = c.get('app');
    const { value } = await readJson(c);
    const password = (value as { password?: unknown }).password;
    if (typeof password !== 'string' || password.length === 0 || password.length > 200) {
      throw badRequest('请输入管理密码');
    }
    const success = await verifyWithLimit(c, app.limiters.admin, () =>
      verifyScrypt(password, app.config.adminPasswordHash),
    );
    if (!success) throw new HttpError(401, 'wrong_password', '密码不正确');
    const session = app.repos.sessions.create('admin', ADMIN_SESSION_SECONDS, app.clock());
    setSessionCookie(c, 'admin', session.token, ADMIN_SESSION_SECONDS);
    return ok(c, { admin: true });
  });

  r.post('/logout', (c) => {
    const app = c.get('app');
    app.repos.sessions.revoke(readSessionToken(c, 'admin'), app.clock());
    clearSessionCookie(c, 'admin');
    return ok(c, { loggedOut: true });
  });

  r.get('/me', (c) => {
    requireAdmin(c);
    return ok(c, { admin: true });
  });

  return r;
}
