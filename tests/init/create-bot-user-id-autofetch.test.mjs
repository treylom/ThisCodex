import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeAccessAllowFrom } from '../../scripts/lib/access-control.mjs';

const HELPER = fileURLToPath(new URL('../../scripts/lib/access-control.mjs', import.meta.url));
const TEST_ID = '123456789012345678';

test('create-bot user-ID contract tries response then avatar before manual fallback', () => {
  const skill = readFileSync('skills/create-bot/SKILL.md', 'utf8');
  const response = skill.indexOf('GET /api/v9/users/@me');
  const avatar = skill.indexOf('/avatars/<user-id>/');
  const manual = skill.indexOf('Manual user-ID fallback');
  assert.ok(response >= 0, 'portal response route missing');
  assert.ok(avatar > response, 'avatar route must follow response route');
  assert.ok(manual > avatar, 'manual fallback must follow both automatic routes');
  assert.match(skill, /cookie.*localStorage.*sessionStorage.*Authorization/is);
  assert.match(skill, /17-20 digits/);
  assert.match(skill, /last four digits/i);
});

test('access helper creates a minimal allowlist without printing the full ID', () => {
  const state = mkdtempSync(join(tmpdir(), 'tcx-access-'));
  try {
    const result = spawnSync(process.execPath, [HELPER, '--state-dir', state, '--user-id-stdin', '--username', 'student'], {
      encoding: 'utf8',
      input: `${TEST_ID}\n`,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TEST_ID));
    assert.match(result.stdout, /5678/);
    const access = JSON.parse(readFileSync(join(state, 'access.json'), 'utf8'));
    assert.deepEqual(access.allowFrom, [TEST_ID]);
    assert.equal(access.dmPolicy, 'allowlist');
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('access helper preserves unrelated keys, backs up once, and is idempotent', () => {
  const state = mkdtempSync(join(tmpdir(), 'tcx-access-'));
  const path = join(state, 'access.json');
  const original = {
    dmPolicy: 'allowlist',
    allowFrom: ['11111111111111111'],
    groups: { room: { requireMention: true } },
    custom: { keep: true },
  };
  writeFileSync(path, `${JSON.stringify(original, null, 2)}\n`);
  if (process.platform !== 'win32') chmodSync(path, 0o640);
  try {
    const beforeMode = statSync(path).mode & 0o777;
    const first = mergeAccessAllowFrom({ stateDir: state, userId: TEST_ID, now: new Date('2026-09-03T12:00:00Z') });
    assert.equal(first.changed, true);
    assert.ok(first.backup);
    assert.deepEqual(JSON.parse(readFileSync(first.backup, 'utf8')), original);
    const merged = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(merged.custom.keep, true);
    assert.deepEqual(merged.groups, original.groups);
    assert.deepEqual(merged.allowFrom, [...original.allowFrom, TEST_ID]);
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, beforeMode);
    const before = readFileSync(path, 'utf8');
    const second = mergeAccessAllowFrom({ stateDir: state, userId: TEST_ID });
    assert.equal(second.changed, false);
    assert.equal(second.backup, null);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('access helper refuses a symlink without changing its target', { skip: process.platform === 'win32' }, () => {
  const state = mkdtempSync(join(tmpdir(), 'tcx-access-'));
  const target = join(state, 'operator-owned.json');
  const path = join(state, 'access.json');
  const bytes = '{"allowFrom":[]}\n';
  writeFileSync(target, bytes);
  symlinkSync(target, path);
  try {
    assert.throws(() => mergeAccessAllowFrom({ stateDir: state, userId: TEST_ID }), /symlink/);
    assert.equal(readFileSync(target, 'utf8'), bytes);
    assert.equal(lstatSync(path).isSymbolicLink(), true);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('invalid input or malformed access.json leaves the original bytes unchanged', () => {
  const state = mkdtempSync(join(tmpdir(), 'tcx-access-'));
  const path = join(state, 'access.json');
  writeFileSync(path, '{not-json}\n');
  try {
    const before = readFileSync(path, 'utf8');
    assert.throws(() => mergeAccessAllowFrom({ stateDir: state, userId: TEST_ID }), /JSON/);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.throws(() => mergeAccessAllowFrom({ stateDir: state, userId: '1234' }), /17-20/);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('access helper rejects a missing state-dir value without writing', () => {
  const result = spawnSync(process.execPath, [HELPER, '--state-dir', '--user-id-stdin'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: `${TEST_ID}\n`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage:/);
});
