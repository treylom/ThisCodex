import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DISCORD_USER_ID = /^\d{17,20}$/;

export function validateDiscordUserId(value) {
  const id = String(value || '').trim();
  if (!DISCORD_USER_ID.test(id)) {
    throw new Error('Discord user ID must contain 17-20 digits');
  }
  return id;
}

function timestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function writeJsonAtomic(path, value, mode = 0o600) {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  let fd = null;
  try {
    fd = openSync(temp, 'wx', mode);
    fchmodSync(fd, mode);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temp, path);
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function mergeAccessAllowFrom({ stateDir, userId, username = '', now = new Date() }) {
  const id = validateDiscordUserId(userId);
  const root = resolve(stateDir);
  mkdirSync(root, { recursive: true });
  const path = join(root, 'access.json');
  let existingStat = null;
  try {
    existingStat = lstatSync(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existingStat?.isSymbolicLink()) {
    throw new Error('access.json symlinks require human review');
  }
  const existed = Boolean(existingStat);
  let value = {
    dmPolicy: 'allowlist',
    allowFrom: [],
    groups: {},
    mentionPatterns: [],
    ackReaction: '',
  };

  if (existed) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('access.json must contain one JSON object');
    }
    value = parsed;
  }

  if (value.allowFrom !== undefined && !Array.isArray(value.allowFrom)) {
    throw new Error('access.json allowFrom must be an array');
  }
  const before = Array.isArray(value.allowFrom) ? value.allowFrom.map(String) : [];
  const changed = !before.includes(id);
  if (!changed) {
    return {
      ok: true,
      changed: false,
      path,
      backup: null,
      user: { username: String(username || ''), last4: id.slice(-4) },
    };
  }

  const next = { ...value, allowFrom: [...before, id] };
  let backup = null;
  if (existed) {
    backup = `${path}.thiscodex-${timestamp(now)}.bak`;
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
  }
  writeJsonAtomic(path, next, existed ? statSync(path).mode & 0o777 : 0o600);
  return {
    ok: true,
    changed: true,
    path,
    backup,
    user: { username: String(username || ''), last4: id.slice(-4) },
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(argv) {
  const value = name => {
    const index = argv.indexOf(name);
    const next = index >= 0 ? argv[index + 1] || '' : '';
    return next && !next.startsWith('--') ? next : '';
  };
  const stateDir = value('--state-dir');
  if (!stateDir || !argv.includes('--user-id-stdin')) {
    throw new Error('usage: access-control.mjs --state-dir <path> --user-id-stdin [--username <name>]');
  }
  const result = mergeAccessAllowFrom({
    stateDir,
    userId: await readStdin(),
    username: value('--username'),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`ACCESS FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
