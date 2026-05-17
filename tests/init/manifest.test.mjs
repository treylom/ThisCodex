import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManifest, sortSteps, validateManifest } from '../../scripts/lib/manifest.mjs';

test('manifest loads ordered ThisCodex steps', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  assert.equal(manifest.product, 'thiscodex');
  const ids = sortSteps(manifest.steps).map(s => s.id);
  for (const id of [
    'detect_environment',
    'confirm_repo_root',
    'confirm_bot_wd',
    'codex_skill_layer',
    'config_ceiling_patch',
    'tmux_install_consent',
    'alias_consent',
    'doctor_rollout_materialized',
  ]) {
    assert.ok(ids.includes(id), `${id} missing`);
  }
});

test('manifest validation rejects missing required fields', () => {
  assert.throws(() => validateManifest({
    product: 'thiscodex',
    version: 1,
    steps: [{ id: 'x', order: 1 }],
  }), /missing action/);
});

test('every step has reason, safety, verify, and next command', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  for (const step of manifest.steps) {
    assert.ok(step.reason, `${step.id} reason missing`);
    assert.ok(step.safety, `${step.id} safety missing`);
    assert.ok(step.verify?.type, `${step.id} verify missing`);
    assert.ok(step.on_fail?.next_command, `${step.id} next command missing`);
  }
});

test('manifest text has no provisional machine path', () => {
  const text = readFileSync('install/thiscodex.install.json', 'utf8');
  assert.doesNotMatch(text, /thiscodex-current-bot|\/home\/tofu/);
});

test('consent gated steps are exactly the safety line steps', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const gated = manifest.steps.filter(s => s.safety === 'consent-gated').map(s => s.id).sort();
  assert.deepEqual(gated, ['alias_consent', 'config_ceiling_patch', 'materialize_runner', 'tmux_install_consent'].sort());
});

test('Codex prompt mapping contains all §6.A domain prompts', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const ids = manifest.steps.map(s => s.id);
  for (const id of ['codex_skill_layer', 'codex_marketplace', 'codex_config_check', 'config_ceiling_patch', 'tmux_install_consent', 'alias_consent']) {
    assert.ok(ids.includes(id), `${id} missing`);
  }
});
