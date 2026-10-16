import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ADMIN_API_PATH, API_PATH, BASE_PATH } from '../../shared/constants.js';
import type { AppContext } from '../context.js';
import { HttpError } from '../lib/errors.js';
import { apiError, ok } from './helpers.js';
import { blockAdminOnPublic, originGuard, securityHeaders } from './middleware.js';
import { adminRoutes } from './routes/admin.js';
import { guestAuthRoutes } from './routes/auth.js';
import { guestRoutes } from './routes/guest.js';
import { spaHandler } from './static.js';
import type { HonoEnv, Listener } from './types.js';

const JSON_LIMIT = 64 * 1024;

/**
 * Builds the app for one listener.
 * - public: guest UI/API only. Admin paths are blocked up-front *and* never registered.
 * - admin: everything, intended to be reachable only on the private network.
 */
export function createHttpApp(app: AppContext, listener: Listener) {
  const http = new Hono<HonoEnv>();

  http.use('*', async (c, next) => {
    c.set('app', app);
    c.set('listener', listener);
    await next();
  });
  http.use('*', securityHeaders);
  if (listener === 'public') http.use('*', blockAdminOnPublic);

  http.use(`${API_PATH}/*`, originGuard);
  http.use(`${API_PATH}/*`, async (c, next) => {
    // Uploads have their own, larger limit.
    if (c.req.path === `${ADMIN_API_PATH}/media`) return next();
    return bodyLimit({
      maxSize: JSON_LIMIT,
      onError: (ctx) => apiError(ctx, 413, 'payload_too_large', '请求内容太大'),
    })(c, next);
  });

  http.get(`${API_PATH}/health`, (c) => {
    app.db.prepare('SELECT 1').get();
    return ok(c, { status: 'ok', listener });
  });

  http.route(`${API_PATH}/auth`, guestAuthRoutes());
  if (listener === 'admin') http.route(ADMIN_API_PATH, adminRoutes());
  http.route(API_PATH, guestRoutes());

  http.all(`${API_PATH}/*`, (c) => apiError(c, 404, 'not_found', '找不到这个接口'));
  http.all(API_PATH, (c) => apiError(c, 404, 'not_found', '找不到这个接口'));

  http.get('/', (c) => c.redirect(`${BASE_PATH}/`, 302));
  http.use('*', spaHandler(app.config.webDir));

  http.notFound((c) => {
    if (c.req.path.startsWith(`${API_PATH}/`)) return apiError(c, 404, 'not_found', '找不到这个接口');
    return c.text('Not Found', 404);
  });

  http.onError((err, c) => {
    if (err instanceof HttpError) {
      if (err.status === 429) {
        const retry = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
        if (retry) c.header('Retry-After', String(retry));
      }
      return apiError(c, err.status, err.code, err.message, err.details);
    }
    app.log(`unhandled error on ${c.req.method} ${c.req.path}: ${err instanceof Error ? err.stack : String(err)}`);
    return apiError(c, 500, 'internal_error', '服务器开小差了，请稍后再试');
  });

  return http;
}
