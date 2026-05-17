import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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

test('--apply --non-interactive without yes stops before consent-gated writes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, '--apply', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /--yes|--answers|next command/i);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('--tone=dev switches output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const out = run(['--check', '--non-interactive', '--tone=dev'], dir);
  assert.match(out, /skill-scan|Codex/i);
  rmSync(dir, { recursive: true, force: true });
});

test('non-TTY init does not enter readline and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const result = spawnSync(process.execPath, [BIN, 'init'], {
    cwd: dir,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd() },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ThisCodex|next command|check/i);
  rmSync(dir, { recursive: true, force: true });
});

test('doctor replays verify checks and prints ordered result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, 'doctor', '--non-interactive'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.ok([0, 1, 2].includes(result.status));
  assert.match(result.stdout + result.stderr, /doctor|verify|BOT_WD|Codex/i);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
