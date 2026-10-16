import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HASH_RE, loadConfig } from '../server/config.js';
import { TEST_ENTRY_DATE } from './helpers.js';

const base = {
  PUBLIC_BASE_URL: 'https://public.test/bistro',
  ADMIN_BASE_URL: 'https://admin.test:8788/bistro',
  ENTRY_DATE_HASH: 'scrypt:1024:8:1:dGVzdA:dGVzdA',
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('passwordless admin configuration', () => {
  it('starts with no admin password and ignores an obsolete password hash', () => {
    expect(loadConfig(base)).not.toHaveProperty('adminPasswordHash');
    expect(loadConfig({ ...base, ADMIN_PASSWORD_HASH: 'obsolete-invalid-value' })).not.toHaveProperty('adminPasswordHash');
  });

  it('still requires the public date hash', () => {
    expect(() => loadConfig({ ...base, ENTRY_DATE_HASH: '' })).toThrow('ENTRY_DATE_HASH');
  });

  it('setup writes only the public gate credential, for new and existing installs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bistro-setup-test-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'scripts'));
    const script = path.join(root, 'scripts/setup.mjs');
    fs.copyFileSync(new URL('../scripts/setup.mjs', import.meta.url), script);
    fs.copyFileSync(new URL('../.env.example', import.meta.url), path.join(root, '.env.example'));
    const env = { ...process.env, ...base, BISTRO_ENTRY_DATE: TEST_ENTRY_DATE };
    execFileSync(process.execPath, [script], { env, input: '', stdio: ['pipe', 'pipe', 'pipe'] });
    const first = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const hash = first.split('\n').find((line) => line.startsWith('ENTRY_DATE_HASH='))!.split('=').slice(1).join('=');
    expect(hash).toMatch(HASH_RE);
    expect(first).not.toContain('ADMIN_PASSWORD_HASH=');
    expect(fs.existsSync(path.join(root, 'secrets'))).toBe(false);
    fs.appendFileSync(path.join(root, '.env'), '\nADMIN_PASSWORD_HASH=obsolete-value\n');
    execFileSync(process.execPath, [script], { env, input: '', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).not.toContain('ADMIN_PASSWORD_HASH=');
    expect(fs.existsSync(path.join(root, 'secrets'))).toBe(false);
  });
});
