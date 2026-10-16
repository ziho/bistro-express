#!/usr/bin/env node
// Initialise private credentials in .env (no npm dependencies required).
//
//   npm run setup                         # prompts for the entry date
//   BISTRO_ENTRY_DATE=YYYY-MM-DD npm run setup
//   echo YYYY-MM-DD | npm run setup
//
// The public entry date is stored only as a salted scrypt hash. Admin access relies on Tailscale.
import { randomBytes, scrypt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const DATA_DIR = path.join(ROOT, 'data');

if (process.argv.length > 2) {
  console.error('后台通过 Tailscale 免密码访问；setup 不接受管理密码或其他参数。');
  process.exit(1);
}

/** Must match server/lib/crypto.ts. */
const entryDateSecret = (date) => `bistro-entry-date:v1:${date}`;

function hashScrypt(secret, N = 32768, r = 8, p = 1) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(secret.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${derived.toString('base64url')}`);
    });
  });
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function readEnvLines() {
  const source = fs.existsSync(ENV_FILE) ? ENV_FILE : ENV_EXAMPLE;
  return fs.readFileSync(source, 'utf8').split('\n');
}

function getValue(lines, key) {
  const line = lines.find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

function setValue(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const entry = `${key}=${value}`;
  if (idx === -1) return [...lines, entry];
  return lines.map((l, i) => (i === idx ? entry : l));
}

async function promptLine(question) {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      rl.close();
      return line.trim();
    }
    return '';
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function main() {
  let lines = readEnvLines().filter((line) => !line.startsWith('ADMIN_PASSWORD_HASH='));
  const changes = [];

  const existingDateHash = getValue(lines, 'ENTRY_DATE_HASH');
  let date = (process.env.BISTRO_ENTRY_DATE ?? '').trim();
  if (!date) {
    const hint = existingDateHash ? '（直接回车保留现有设置）' : '';
    date = await promptLine(`请输入入口日期 YYYY-MM-DD${hint}: `);
  }
  if (date) {
    if (!isValidDate(date)) {
      console.error('✗ 日期格式无效，应为 YYYY-MM-DD');
      process.exit(1);
    }
    lines = setValue(lines, 'ENTRY_DATE_HASH', await hashScrypt(entryDateSecret(date)));
    changes.push('入口日期哈希已更新');
  } else if (!existingDateHash) {
    console.error('✗ 尚未配置入口日期，请提供 BISTRO_ENTRY_DATE 或在提示时输入');
    process.exit(1);
  }

  for (const key of ['PUBLIC_BASE_URL', 'ADMIN_BASE_URL']) {
    const provided = (process.env[key] ?? '').trim();
    if (provided) {
      if (!/^https?:\/\/[^/]+\/bistro\/?$/.test(provided)) {
        console.error(`✗ ${key} 必须形如 https://host/bistro`);
        process.exit(1);
      }
      lines = setValue(lines, key, provided.replace(/\/$/, ''));
      changes.push(`${key} 已设置`);
    } else if (getValue(lines, key).includes('example.')) {
      console.warn(`! ${key} 仍是示例值，请通过环境变量传入或手动编辑 .env`);
    }
  }

  if (typeof process.getuid === 'function') {
    lines = setValue(lines, 'APP_UID', String(process.getuid()));
    lines = setValue(lines, 'APP_GID', String(process.getgid()));
  }

  fs.writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  console.log('✓ .env 已写入（权限 600）');
  for (const change of changes) console.log(`✓ ${change}`);
  console.log('✓ data/ 目录已就绪');
}

main().catch((err) => {
  console.error(`✗ setup 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
