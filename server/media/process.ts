import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import sharp, { type Sharp } from 'sharp';
import { LIMITS } from '../../shared/constants.js';
import { HttpError } from '../lib/errors.js';
import { ASSET_ID_RE } from '../lib/validation.js';
import { detectImageKind, type ImageKind } from './detect.js';

export type MediaVariant = 'full' | 'thumb';

export interface ProcessedImage {
  id: string;
  width: number;
  height: number;
  sourceType: ImageKind;
  bytes: number;
}

const HEIC_TIMEOUT_MS = 60_000;

const unsupported = () =>
  new HttpError(415, 'unsupported_image', '只支持 JPEG、PNG、WebP 或 iPhone HEIC 照片');
const corrupt = () => new HttpError(422, 'corrupt_image', '这张图片好像损坏了，无法读取，请换一张试试');
const tooLarge = () => new HttpError(413, 'image_too_large', '图片尺寸过大，请换一张小一点的照片');

// Plain .mjs worker: copied verbatim by tsc (allowJs), so the same file works in dev, tests and the build.
const HEIC_WORKER_URL = new URL('./heicWorker.mjs', import.meta.url);

/** Infrastructure failure (worker could not start) — surfaces as a 500, not as "corrupt image". */
class WorkerCrash extends Error {}

interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function decodeHeic(buffer: Buffer): Promise<RawImage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(HEIC_WORKER_URL), {
      workerData: { buffer: new Uint8Array(buffer), maxPixels: LIMITS.maxInputPixels },
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(corrupt());
    }, HEIC_TIMEOUT_MS);
    worker.once('message', (msg: { ok: boolean; reason?: string } & Partial<RawImage>) => {
      clearTimeout(timer);
      void worker.terminate();
      if (msg.ok && msg.width && msg.height && msg.data) {
        resolve({ width: msg.width, height: msg.height, data: msg.data });
      } else {
        reject(msg.reason === 'too_large' ? tooLarge() : corrupt());
      }
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(new WorkerCrash(`HEIC worker failed: ${err.message}`));
    });
  });
}

function pipelineFor(input: Buffer | RawImage): Sharp {
  if (Buffer.isBuffer(input)) {
    return sharp(input, { limitInputPixels: LIMITS.maxInputPixels, failOn: 'error', sequentialRead: true });
  }
  return sharp(Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength), {
    raw: { width: input.width, height: input.height, channels: 4 },
  });
}

/** Decode, auto-orient, strip metadata (sharp drops EXIF by default), resize and encode to WebP. */
async function renderVariants(input: Buffer | RawImage) {
  const base = pipelineFor(input).rotate();
  const [full, thumb] = await Promise.all([
    base
      .clone()
      .resize({ width: LIMITS.fullEdge, height: LIMITS.fullEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }),
    base
      .clone()
      .resize({ width: LIMITS.thumbEdge, height: LIMITS.thumbEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer(),
  ]);
  return { full: full.data, width: full.info.width, height: full.info.height, thumb };
}

export function mediaPath(mediaDir: string, id: string, variant: MediaVariant): string | null {
  if (!ASSET_ID_RE.test(id)) return null;
  return path.join(mediaDir, id.slice(0, 2), `${id}-${variant}.webp`);
}

export async function processUpload(buffer: Buffer, mediaDir: string): Promise<ProcessedImage> {
  if (buffer.length === 0) throw corrupt();
  if (buffer.length > LIMITS.uploadBytes) throw new HttpError(413, 'file_too_large', '图片不能超过 20MB');
  const kind = detectImageKind(buffer);
  if (!kind) throw unsupported();

  let rendered: Awaited<ReturnType<typeof renderVariants>>;
  try {
    const source = kind === 'heic' ? await decodeHeic(buffer) : buffer;
    rendered = await renderVariants(source);
  } catch (err) {
    if (err instanceof HttpError || err instanceof WorkerCrash) throw err;
    if (err instanceof Error && /pixel limit/i.test(err.message)) throw tooLarge();
    throw corrupt();
  }

  const id = randomBytes(16).toString('hex');
  const fullPath = mediaPath(mediaDir, id, 'full')!;
  const thumbPath = mediaPath(mediaDir, id, 'thumb')!;
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  // Write to temp names then rename, so a crash never leaves a half-written asset.
  await fs.writeFile(`${fullPath}.tmp`, rendered.full);
  await fs.writeFile(`${thumbPath}.tmp`, rendered.thumb);
  await fs.rename(`${fullPath}.tmp`, fullPath);
  await fs.rename(`${thumbPath}.tmp`, thumbPath);

  return {
    id,
    width: rendered.width,
    height: rendered.height,
    sourceType: kind,
    bytes: rendered.full.length + rendered.thumb.length,
  };
}
