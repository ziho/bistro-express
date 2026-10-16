import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv(); });
afterEach(() => env.cleanup());

it('rejects valid JSON primitives at the public date gate as input errors', async () => {
  for (const value of [null, 123, true, 'not an object', []]) {
    const gate = await env.publicClient().request('POST', '/bistro/api/auth/gate', { json: value });
    expect(gate.status, gate.text).toBe(400);
  }
});

it('keeps private photos out of persistent HTTP caches and revokes access after logout', async () => {
  const admin = await env.admin();
  const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#f4a261' } }).png().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'private-photo.png');
  const upload = await admin.request('POST', '/bistro/api/admin/media', { body: form });
  expect(upload.status).toBe(201);
  const mediaPath = `/bistro/api/media/${upload.body.data.id}/full`;
  const guest = await env.guest();
  const photo = await guest.get(mediaPath);
  expect(photo.status).toBe(200);
  expect(photo.headers.get('cache-control')).toContain('no-store');
  expect((await guest.post('/bistro/api/auth/logout')).status).toBe(200);
  expect((await guest.get(mediaPath)).status).toBe(401);
});
