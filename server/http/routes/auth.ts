import { Hono } from 'hono';
import { GUEST_SESSION_SECONDS } from '../../../shared/constants.js';
import { isValidDateString } from '../../../shared/time.js';
import type { SessionInfo } from '../../../shared/types.js';
import { entryDateSecret, verifyScrypt } from '../../lib/crypto.js';
import { badRequest, HttpError } from '../../lib/errors.js';
import type { AuthLimiter } from '../../lib/rateLimit.js';
import {
  clearGuestCookie,
  clientKey,
  hasGuestSession,
  ok,
  readJson,
  readGuestToken,
  setGuestCookie,
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
    const admin = listener === 'admin';
    const info: SessionInfo = { listener, guest: admin || hasGuestSession(c), admin };
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
    setGuestCookie(c, session.token, GUEST_SESSION_SECONDS);
    return ok(c, { guest: true });
  });

  r.post('/logout', (c) => {
    const app = c.get('app');
    const now = app.clock();
    app.repos.sessions.revoke(readGuestToken(c), now);
    clearGuestCookie(c);
    return ok(c, { loggedOut: true });
  });

  return r;
}
