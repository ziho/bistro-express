import { Hono } from 'hono';
import { z } from 'zod';
import { GEO, MAP_LINK_INPUT_MAX } from '../../../shared/constants.js';
import { badRequest, HttpError } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { normalizeBaseUrl } from '../../geo/service.js';
import { buildPreview } from '../../maps/preview.js';
import { MapLinkError, resolveMapsLink } from '../../maps/resolve.js';
import { hasPlaceData } from '../../maps/parse.js';
import { ok, readJson } from '../helpers.js';
import type { HonoEnv } from '../types.js';

const resolveSchema = z.object({
  url: z.string().trim().min(1, '请先粘贴 Google 地图链接').max(MAP_LINK_INPUT_MAX, '链接太长了'),
  /** Also suggest the region from the link's own place point (user-triggered, admin only). */
  geo: z.boolean().optional(),
});

const geoSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().max(GEO.baseUrlMax, '服务地址太长了'),
});

/**
 * Admin-only Google Maps link assist. Returns an editable preview; it never creates or edits a
 * restaurant (the admin saves through the normal form). No API key, no Places API.
 * With `geo: true` the preview also carries a region suggestion; a failed region lookup never
 * fails the preview, and the lookup only ever receives coordinates, never a URL from the request.
 */
export function mapLinkRoutes() {
  const r = new Hono<HonoEnv>();

  r.post('/restaurants/resolve-map-link', async (c) => {
    const app = c.get('app');
    const { url, geo } = parseWith(resolveSchema, (await readJson(c)).value);
    const wait = app.limiters.mapLink.blockedFor('*');
    if (wait) throw new HttpError(429, 'rate_limited', `识别得太频繁了，请 ${wait} 秒后再试`, { retryAfter: wait });
    app.limiters.mapLink.hit('*');
    try {
      const resolved = await resolveMapsLink(url, app.outboundFetch);
      if (!hasPlaceData(resolved.parsed)) {
        throw new MapLinkError('map_link_unresolved', '没能从这个链接里识别出店名或地点，请手动填写');
      }
      const preview = buildPreview(resolved, app.repos.catalog.listRestaurants(false));
      if (!geo) return ok(c, preview);
      return ok(c, { ...preview, geo: await app.geocoder.suggestForLink(resolved.parsed) });
    } catch (err) {
      if (!(err instanceof MapLinkError)) throw err;
      throw new HttpError(err.code === 'map_link_unreachable' ? 502 : 422, err.code, err.message);
    }
  });

  r.get('/geo/settings', (c) => ok(c, c.get('app').geocoder.view()));

  r.put('/geo/settings', async (c) => {
    const app = c.get('app');
    const input = parseWith(geoSettingsSchema, (await readJson(c)).value);
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      throw badRequest('服务地址需要是 http(s) 开头的完整地址，不能带账号、参数或 #', { field: 'baseUrl' });
    }
    return ok(c, app.geocoder.save({ enabled: input.enabled, baseUrl }, app.clock()));
  });

  return r;
}
