import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectImageKind } from '../server/media/detect.js';
import { createTestEnv, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

async function upload(admin: Client, data: Uint8Array, filename: string, type: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type }), filename);
  return admin.request('POST', '/bistro/api/admin/media', { body: form });
}

describe('image uploads', () => {
  it('normalizes a JPEG with EXIF orientation into WebP full + thumbnail without metadata', async () => {
    const admin = await env.admin();
    // 2400x1200 landscape stored with orientation 6 (rotate 90°) and EXIF metadata.
    const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#e85d3f' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .toBuffer();
    const res = await upload(admin, jpeg, '../../evil.jpg', 'image/jpeg');
    expect(res.status).toBe(201);
    const { id, width, height } = res.body.data;
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    // Rotated to portrait and bounded to 1600 long edge.
    expect(width).toBe(800);
    expect(height).toBe(1600);

    const guest = await env.guest();
    const full = await guest.get(`/bistro/api/media/${id}/full`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('image/webp');
    expect(full.headers.get('cache-control')).toContain('private');
    const fullBuf = Buffer.from(await (await env.publicApp.request(`https://public.test/bistro/api/media/${id}/full`, {
      headers: { cookie: `bx_guest=${guest.cookies.get('bx_guest')}` },
    })).arrayBuffer());
    const meta = await sharp(fullBuf).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(fullBuf.includes(Buffer.from('secret-gps-owner'))).toBe(false);

    const thumbRes = await env.publicApp.request(`https://public.test/bistro/api/media/${id}/thumb`, {
      headers: { cookie: `bx_guest=${guest.cookies.get('bx_guest')}` },
    });
    const thumbMeta = await sharp(Buffer.from(await thumbRes.arrayBuffer())).metadata();
    expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBe(480);
  });

  it('accepts PNG and WebP', async () => {
    const admin = await env.admin();
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: '#ffd166' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ffd166' } }).webp().toBuffer();
    expect((await upload(admin, png, 'a.png', 'image/png')).status).toBe(201);
    expect((await upload(admin, webp, 'a.webp', 'image/webp')).status).toBe(201);
  });

  it('rejects corrupt images with a readable error', async () => {
    const admin = await env.admin();
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    const res = await upload(admin, corrupt, 'broken.jpg', 'image/jpeg');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('corrupt_image');
    expect(res.body.error.message).toMatch(/损坏/);
  });

  it('rejects SVG and other unsupported types regardless of declared MIME', async () => {
    const admin = await env.admin();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload(admin, svg, 'x.png', 'image/png');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('unsupported_image');
  });

  it('rejects files over 20MB', async () => {
    const admin = await env.admin();
    const big = new Uint8Array(21 * 1024 * 1024);
    big.set([0xff, 0xd8, 0xff]);
    const res = await upload(admin, big, 'big.jpg', 'image/jpeg');
    expect(res.status).toBe(413);
  });

  it('rejects uploads without a file and from non-admins', async () => {
    const admin = await env.admin();
    expect((await admin.request('POST', '/bistro/api/admin/media', { body: new FormData() })).status).toBe(400);
    const anon = env.adminClient();
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    expect((await upload(anon, png, 'a.png', 'image/png')).status).toBe(401);
  });

  it('media requires authentication and rejects traversal-shaped ids', async () => {
    expect((await env.publicClient().get(`/bistro/api/media/${'a'.repeat(32)}/full`)).status).toBe(401);
    const guest = await env.guest();
    expect((await guest.get('/bistro/api/media/..%2F..%2Fbistro.sqlite/full')).status).toBe(404);
    expect((await guest.get(`/bistro/api/media/${'a'.repeat(32)}/original`)).status).toBe(404);
    expect((await guest.get(`/bistro/api/media/${'a'.repeat(32)}/full`)).status).toBe(404);
  });

  it('detects HEIC by ftyp brand', () => {
    const heic = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0]);
    expect(detectImageKind(heic)).toBe('heic');
    expect(detectImageKind(Buffer.from('GIF89a-------'))).toBeNull();
  });

  it('reports a corrupt HEIC as corrupt (decoded in a worker)', async () => {
    const admin = await env.admin();
    const fake = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(500, 1)]);
    const res = await upload(admin, fake, 'IMG_0001.HEIC', 'image/heic');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('corrupt_image');
  });
});
