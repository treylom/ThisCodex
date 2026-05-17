import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadState,
  saveState,
  mergeAnswer,
  resumeSummary,
  statePath,
  loadInstallState,
  saveInstallState,
  confirmPath,
  rejectProvisionalPath,
  freshInstallState,
  withDetectedDefaults,
  markPlacementOnly,
} from '../../scripts/lib/state.mjs';

test('fresh state skeleton', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const s = loadState(dir);
  assert.equal(s.version, 1);
  assert.deepEqual(s.completed_steps, []);
  rmSync(dir, { recursive: true, force: true });
});

test('mergeAnswer persists answer and completed step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  let s = mergeAnswer(loadState(dir), 'codex_skill_layer', 'user');
  saveState(dir, s);
  const r = loadState(dir);
  assert.equal(r.answers.codex_skill_layer, 'user');
  assert.ok(r.completed_steps.includes('codex_skill_layer'));
  rmSync(dir, { recursive: true, force: true });
});

test('resumeSummary names prior answers', () => {
  const s = mergeAnswer(loadState('/tmp'), 'tone', 'plain');
  assert.match(resumeSummary(s), /tone/);
});

test('install state lives in ~/.config/thiscodex/install-state.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  assert.equal(statePath({ HOME: home }), join(home, '.config', 'thiscodex', 'install-state.json'));
  rmSync(home, { recursive: true, force: true });
});

test('confirmed paths persist outside the repo', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  let s = loadInstallState({ HOME: home });
  s = confirmPath(s, 'confirmed_repo_root', repo);
  saveInstallState(s, { HOME: home });
  const file = statePath({ HOME: home });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).confirmed_repo_root, repo);
  assert.equal(existsSync(join(repo, '.thiscodex-init-state.json')), false);
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test('provisional paths are rejected before persistent state write', () => {
  const provisional = ['/', 'home', 'tofu', ['thiscodex', 'current', 'bot'].join('-')].join('/');
  assert.throws(() => rejectProvisionalPath(provisional), /provisional/);
  assert.doesNotThrow(() => rejectProvisionalPath('/home/alice/bots/sonseokhee'));
});

test('detected defaults do not become confirmed state', () => {
  const state = freshInstallState();
  const next = withDetectedDefaults(state, { repo_root: '/repo', cwd: '/tmp/bot' });
  assert.equal(next.confirmed_repo_root, null);
  assert.equal(next.confirmed_bot_wd, null);
  assert.equal(next.detected.repo_root, '/repo');
  assert.equal(next.detected.cwd, '/tmp/bot');
});

test('placement-only state does not persist guided confirmed paths', () => {
  const state = markPlacementOnly(freshInstallState(), { skillLayer: 'user' });
  assert.equal(state.placement_only, true);
  assert.equal(state.confirmed_skill_layer, 'user');
  assert.equal(state.confirmed_bot_wd, null);
  assert.equal(state.confirmed_state_dir, null);
});
