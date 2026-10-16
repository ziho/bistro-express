import { Hono } from 'hono';
import { HttpError } from '../../lib/errors.js';
import { mapLinkSchema, parseWith } from '../../lib/validation.js';
import { buildPreview } from '../../maps/preview.js';
import { MapLinkError, resolveMapsLink } from '../../maps/resolve.js';
import { hasPlaceData } from '../../maps/parse.js';
import { ok, readJson } from '../helpers.js';
import type { HonoEnv } from '../types.js';

/**
 * Admin-only Google Maps link assist. Returns an editable preview; it never creates or edits a
 * restaurant (the admin saves through the normal form). No API key, no Places API.
 */
export function mapLinkRoutes() {
  const r = new Hono<HonoEnv>();

  r.post('/restaurants/resolve-map-link', async (c) => {
    const app = c.get('app');
    const { url } = parseWith(mapLinkSchema, (await readJson(c)).value);
    const wait = app.limiters.mapLink.blockedFor('*');
    if (wait) throw new HttpError(429, 'rate_limited', `识别得太频繁了，请 ${wait} 秒后再试`, { retryAfter: wait });
    app.limiters.mapLink.hit('*');
    try {
      const resolved = await resolveMapsLink(url, app.outboundFetch);
      if (!hasPlaceData(resolved.parsed)) {
        throw new MapLinkError('map_link_unresolved', '没能从这个链接里识别出店名或地点，请手动填写');
      }
      return ok(c, buildPreview(resolved, app.repos.catalog.listRestaurants(false)));
    } catch (err) {
      if (!(err instanceof MapLinkError)) throw err;
      throw new HttpError(err.code === 'map_link_unreachable' ? 502 : 422, err.code, err.message);
    }
  });

  return r;
}
