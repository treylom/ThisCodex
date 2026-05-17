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
