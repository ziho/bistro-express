import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { BASE_PATH } from '../../shared/constants.js';
import type { HonoEnv } from './types.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const FALLBACK_INDEX = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Bistro Express</title></head>
<body><p>前端尚未构建。请先运行 npm run build。</p></body></html>`;

/**
 * Serves the built SPA below /bistro/. Real files are served directly; extension-less
 * paths fall back to index.html so deep links work; unknown files are 404.
 */
export function spaHandler(webDir: string): MiddlewareHandler<HonoEnv> {
  const root = path.resolve(webDir);
  const cache = new Map<string, Buffer>();

  const readFile = (file: string): Buffer | null => {
    const hit = cache.get(file);
    if (hit) return hit;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return null;
      const data = fs.readFileSync(file);
      if (data.length < 2 * 1024 * 1024) cache.set(file, data);
      return data;
    } catch {
      return null;
    }
  };

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const urlPath = c.req.path;
    if (urlPath === BASE_PATH) return c.redirect(`${BASE_PATH}/`, 301);
    if (!urlPath.startsWith(`${BASE_PATH}/`)) return next();

    let rel: string;
    try {
      rel = decodeURIComponent(urlPath.slice(BASE_PATH.length + 1));
    } catch {
      return c.text('Bad Request', 400);
    }
    if (rel.includes('\0')) return c.text('Bad Request', 400);

    if (rel) {
      const file = path.resolve(root, rel);
      if (file.startsWith(root + path.sep)) {
        const data = readFile(file);
        if (data) {
          const ext = path.extname(file).toLowerCase();
          const immutable = rel.startsWith('assets/');
          const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
          const headers: Record<string, string> = {
            'Content-Type': TYPES[ext] ?? 'application/octet-stream',
            'Cache-Control': cacheControl,
          };
          if (rel === 'sw.js') headers['Service-Worker-Allowed'] = `${BASE_PATH}/`;
          return c.body(new Uint8Array(data), 200, headers);
        }
      }
      const lastSegment = rel.split('/').pop() ?? '';
      if (lastSegment.includes('.')) return c.text('Not Found', 404);
    }

    const index = readFile(path.join(root, 'index.html'));
    return c.body(index ? new Uint8Array(index) : FALLBACK_INDEX, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
  };
}
