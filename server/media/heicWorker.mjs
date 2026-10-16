// Decodes HEIC off the main event loop. Plain JS so it runs unchanged under tsx, vitest and the build.
// Input (workerData): { buffer: Uint8Array, maxPixels: number }
// Output: { ok: true, width, height, data } | { ok: false, reason: 'too_large' | 'corrupt' }
import { parentPort, workerData } from 'node:worker_threads';
import decode from 'heic-decode';

async function run() {
  const { buffer, maxPixels } = workerData;
  const images = await decode.all({ buffer });
  try {
    const first = images[0];
    if (!first) throw new Error('empty');
    if (first.width * first.height > maxPixels) {
      parentPort?.postMessage({ ok: false, reason: 'too_large' });
      return;
    }
    const { width, height, data } = await first.decode();
    parentPort?.postMessage({ ok: true, width, height, data }, [data.buffer]);
  } finally {
    images.dispose();
  }
}

run().catch(() => parentPort?.postMessage({ ok: false, reason: 'corrupt' }));
