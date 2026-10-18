import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS } from '../../../shared/constants.js';
import { hasUnsafeText } from '../../../shared/venue.js';
import { parseWith } from '../../lib/validation.js';
import { idempotencyKey, ok, readJson } from '../helpers.js';
import type { HonoEnv } from '../types.js';

const tag = z.string().trim().min(1, '请填写标签名称').max(LIMITS.tag, `标签不能超过 ${LIMITS.tag} 个字`).refine((s) => !hasUnsafeText(s), '标签名称包含不支持的字符');
const change = z.object({ sources: z.array(tag).min(1, '请先选择标签').max(50, '一次最多修改 50 个标签'), target: tag });
const commit = change.extend({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/, '请先查看影响范围') });

export function venueTagRoutes() {
  const r = new Hono<HonoEnv>();
  r.get('/restaurant-tags', (c) => ok(c, c.get('app').venueTags.index()));
  r.post('/restaurant-tags/preview', async (c) => ok(c, c.get('app').venueTags.preview(parseWith(change, (await readJson(c)).value))));
  r.post('/restaurant-tags/apply', async (c) => {
    const key = idempotencyKey(c), { raw, value } = await readJson(c);
    return ok(c, c.get('app').venueTags.apply(parseWith(commit, value), { key, fingerprintSource: `POST /restaurant-tags/apply ${raw}` }));
  });
  return r;
}
