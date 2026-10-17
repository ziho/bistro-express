import { Hono } from 'hono';
import { parseWith, restaurantImportSchema } from '../../lib/validation.js';
import { idempotencyKey, ok, readJson } from '../helpers.js';
import type { HonoEnv } from '../types.js';

export const RESTAURANT_IMPORT_PATH = '/restaurants/import';

/**
 * Admin-only bulk create (批量导入). Rows come from the browser queue after previewing; the
 * server rechecks everything offline and answers per row. Requires an Idempotency-Key so a lost
 * response can be retried without importing anything twice.
 */
export function restaurantImportRoutes() {
  const r = new Hono<HonoEnv>();

  r.post(RESTAURANT_IMPORT_PATH, async (c) => {
    const key = idempotencyKey(c);
    const { raw, value } = await readJson(c);
    const { rows } = parseWith(restaurantImportSchema, value);
    const result = c.get('app').restaurantImporter.run(rows, {
      key,
      fingerprintSource: `POST /admin${RESTAURANT_IMPORT_PATH} ${raw}`,
    });
    return ok(c, result);
  });

  return r;
}
