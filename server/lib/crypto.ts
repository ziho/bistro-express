import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Hash format (shared with scripts/setup.mjs):
 *   scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
 * No "$" so the value is safe inside docker compose env files.
 */
export function verifyScrypt(secret: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return Promise.resolve(false);
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(hashRaw, 'base64url');
  if (!N || !r || !p || expected.length < 16) return Promise.resolve(false);
  return new Promise((resolve) => {
    scrypt(secret.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, derived) => {
      if (err) return resolve(false);
      resolve(derived.length === expected.length && timingSafeEqual(derived, expected));
    });
  });
}

export function hashScrypt(secret: string, N = 32768, r = 8, p = 1): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(secret.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${derived.toString('base64url')}`);
    });
  });
}

/** Normalized secret for the entry date gate. Must match scripts/setup.mjs. */
export function entryDateSecret(date: string): string {
  return `bistro-entry-date:v1:${date}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const SHORT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function shortCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += SHORT_ALPHABET[byte % SHORT_ALPHABET.length];
  return out;
}
