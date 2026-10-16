import path from 'node:path';
import { BASE_PATH } from '../shared/constants.js';

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
  adminPasswordHash: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  /** Directory with the built SPA (index.html, assets). */
  webDir: string;
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
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH ?? '';
  if (!HASH_RE.test(entryDateHash)) {
    throw new ConfigError('ENTRY_DATE_HASH is missing or malformed — run `npm run setup` first');
  }
  if (!HASH_RE.test(adminPasswordHash)) {
    throw new ConfigError('ADMIN_PASSWORD_HASH is missing or malformed — run `npm run setup` first');
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
    adminPasswordHash,
    cookieSecure,
    trustProxy: env.TRUST_PROXY !== 'false',
    webDir: path.resolve(env.WEB_DIR ?? './dist/web'),
  };
}

export { HASH_RE };
