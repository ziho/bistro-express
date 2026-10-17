import path from 'node:path';
import { BASE_PATH, GEO } from '../shared/constants.js';

export interface AppConfig {
  publicBaseUrl: string;
  adminBaseUrl: string;
  publicOrigin: string;
  adminOrigin: string;
  publicPort: number;
  adminPort: number;
  host: string;
  dataDir: string;
  entryDateHash: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  /** Directory with the built SPA (index.html, assets). */
  webDir: string;
  /**
   * Default of the admin-only region lookup (地区识别) until settings are saved in the app.
   * Omitted = off (tests and hand-built configs never reach an external service by accident).
   */
  geocoder?: { enabled: boolean; baseUrl: string };
}

export class ConfigError extends Error {}

function requireBaseUrl(name: string, raw: string | undefined): { url: string; origin: string } {
  if (!raw) throw new ConfigError(`${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(`${name} must use http(s)`);
  }
  const trimmed = parsed.pathname.replace(/\/+$/, '');
  if (trimmed !== BASE_PATH) {
    throw new ConfigError(`${name} must end with ${BASE_PATH}`);
  }
  return { url: `${parsed.origin}${BASE_PATH}`, origin: parsed.origin };
}

function isLocalOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError(`${name} must be a valid port`);
  }
  return value;
}

const HASH_RE = /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const pub = requireBaseUrl('PUBLIC_BASE_URL', env.PUBLIC_BASE_URL);
  const adm = requireBaseUrl('ADMIN_BASE_URL', env.ADMIN_BASE_URL);
  const entryDateHash = env.ENTRY_DATE_HASH ?? '';
  if (!HASH_RE.test(entryDateHash)) {
    throw new ConfigError('ENTRY_DATE_HASH is missing or malformed — run `npm run setup` first');
  }
  const cookieSecure = env.COOKIE_SECURE !== 'false';
  if (!cookieSecure && !(isLocalOrigin(pub.origin) && isLocalOrigin(adm.origin))) {
    throw new ConfigError('COOKIE_SECURE=false is only allowed when both base URLs point at localhost');
  }
  return {
    publicBaseUrl: pub.url,
    adminBaseUrl: adm.url,
    publicOrigin: pub.origin,
    adminOrigin: adm.origin,
    publicPort: parsePort('PUBLIC_PORT', env.PUBLIC_PORT, 3000),
    adminPort: parsePort('ADMIN_PORT', env.ADMIN_PORT, 3001),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    entryDateHash,
    cookieSecure,
    trustProxy: env.TRUST_PROXY !== 'false',
    webDir: path.resolve(env.WEB_DIR ?? './dist/web'),
    // Accepted choice: the public OpenStreetMap Nominatim service, used within its usage policy.
    // It can be switched off or pointed elsewhere in 推送设置 → 地区识别 without a code change.
    geocoder: { enabled: true, baseUrl: GEO.defaultBaseUrl },
  };
}

export { HASH_RE };
