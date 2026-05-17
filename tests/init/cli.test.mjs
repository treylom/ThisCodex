import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const out = run(['init', '--check', '--non-interactive'], dir);
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
  const out = run(['init', '--check', '--non-interactive', '--tone=dev'], dir);
  assert.match(out, /skill-scan|Codex/i);
  rmSync(dir, { recursive: true, force: true });
});

test('CLI derives repo root with fileURLToPath for Windows-safe URLs', () => {
  const source = readFileSync(BIN, 'utf8');
  assert.match(source, /fileURLToPath\(new URL\('\.\.', import\.meta\.url\)\)/);
  assert.doesNotMatch(source, /new URL\('\.\.', import\.meta\.url\)\.pathname/);
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

test('non-TTY apply does not persist confirmed_* as check_only placeholder', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  const statePath = join(home, '.config', 'thiscodex', 'install-state.json');
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.notEqual(state.answers?.confirmed_bot_wd, 'check_only');
    assert.notEqual(state.answers?.confirmed_state_dir, 'check_only');
    assert.notEqual(state.answers?.confirmed_repo_root, 'check_only');
  }
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('non-interactive apply with yes but no answers stops before guided path persistence', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /Next command:/);
  assert.equal(existsSync(join(home, '.config', 'thiscodex', 'install-state.json')), false);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('answers file confirms guided paths and persists them explicitly', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    alias_consent: 'no',
    daemon_guide: 'no',
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = JSON.parse(readFileSync(join(home, '.config', 'thiscodex', 'install-state.json'), 'utf8'));
  assert.equal(state.confirmed_repo_root, process.cwd());
  assert.equal(state.confirmed_workspace_root, workspace);
  assert.equal(state.confirmed_bot_wd, bot);
  assert.equal(state.confirmed_state_dir, stateDir);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});
