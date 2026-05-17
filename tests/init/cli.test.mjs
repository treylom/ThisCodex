import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/thiscodex.mjs', import.meta.url));
const run = (args, cwd, extraEnv = {}) => execFileSync(process.execPath, [BIN, ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, ...extraEnv },
});

test('--check --non-interactive writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const before = readdirSync(dir).sort();
  const out = run(['--check', '--non-interactive'], dir);
  assert.deepEqual(readdirSync(dir).sort(), before);
  assert.match(out, /check|점검|Codex/i);
  rmSync(dir, { recursive: true, force: true });
});

test('--apply --non-interactive creates state and can use fake HOME', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  run(['--apply', '--non-interactive'], repo, { THISCODEX_REPO_ROOT: process.cwd(), HOME: home });
  assert.ok(existsSync(join(repo, '.thiscodex-init-state.json')));
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('--tone=dev switches output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const out = run(['--check', '--non-interactive', '--tone=dev'], dir);
  assert.match(out, /skill-scan|Codex/i);
  rmSync(dir, { recursive: true, force: true });
});
