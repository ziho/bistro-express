import fs from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv(); });
afterEach(() => env.cleanup());

it('decodes a real HEIC photo through the worker and produces protected WebP assets', async () => {
  // This 48x32 geometric fixture was generated for this project, without personal imagery.
  const bytes = await fs.readFile(new URL('./fixtures/upload.heic', import.meta.url));
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/heic' }), 'iphone-photo.HEIC');
  const admin = await env.admin();
  const result = await admin.request('POST', '/bistro/api/admin/media', { body: form });
  expect(result.status, result.text).toBe(201);
  expect(result.body.data.width).toBe(48);
  expect(result.body.data.height).toBe(32);
  expect(result.body.data.sourceType).toBe('heic');
  const id = result.body.data.id;
  expect((await env.publicClient().get(`/bistro/api/media/${id}/full`)).status).toBe(401);
  const guest = await env.guest();
  const image = await guest.get(`/bistro/api/media/${id}/full`);
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toBe('image/webp');
});
