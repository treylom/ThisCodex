import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManifest, sortSteps, validateManifest } from '../../scripts/lib/manifest.mjs';

test('manifest loads ordered ThisCodex steps', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  assert.equal(manifest.product, 'thiscodex');
  const ids = sortSteps(manifest.steps).map(s => s.id);
  for (const id of [
    'choose_automation_mode',
    'detect_environment',
    'choose_install_surface',
    'confirm_repo_root',
    'confirm_workspace_root',
    'confirm_bot_wd',
    'confirm_runtime_name',
    'codex_skill_layer',
    'browser_tools_bootstrap',
    'config_ceiling_patch',
    'tmux_install_consent',
    'alias_consent',
    'doctor_rollout_materialized',
  ]) {
    assert.ok(ids.includes(id), `${id} missing`);
  }
});

test('automatic/manual is the first interaction and remains separate from install surface', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const ordered = sortSteps(manifest.steps);
  const firstPrompt = ordered.find(step => step.action === 'prompt');
  const mode = manifest.steps.find(step => step.id === 'choose_automation_mode');
  const detect = manifest.steps.find(step => step.id === 'detect_environment');
  const surface = manifest.steps.find(step => step.id === 'choose_install_surface');

  assert.equal(firstPrompt?.id, 'choose_automation_mode');
  assert.equal(mode.verify.state_key, 'automation_mode');
  assert.equal(mode.verify.choices, 'auto,manual');
  assert.ok(mode.order < detect.order);
  assert.notEqual(mode.verify.state_key, surface.verify.state_key);
});

test('browser tools policy has an executable install and E2E consumer', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const step = manifest.steps.find(candidate => candidate.id === 'browser_tools_bootstrap');
  const source = readFileSync('bin/thiscodex.mjs', 'utf8');

  assert.equal(step.action, 'apply');
  assert.equal(step.verify.type, 'browser-tools-ready');
  assert.match(step.reason, /installs Playwright CLI and MCP/i);
  assert.match(step.reason, /E2E/i);
  assert.match(source, /step\.id === 'browser_tools_bootstrap'/);
  assert.match(source, /ensureBrowserTools\(\{/);
  assert.match(source, /command === 'browser-e2e'/);
});

test('guided onboarding asks for the bot runtime name before generating aliases', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const byId = Object.fromEntries(manifest.steps.map(step => [step.id, step]));
  assert.equal(byId.confirm_runtime_name.action, 'prompt');
  assert.equal(byId.confirm_runtime_name.verify.type, 'runtime-name');
  assert.equal(byId.confirm_runtime_name.verify.state_key, 'session');
  assert.ok(byId.confirm_runtime_name.order < byId.materialize_runner.order);
  assert.ok(byId.confirm_runtime_name.order < byId.alias_consent.order);
});

test('manifest separates placement-only from guided onboarding', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const ids = sortSteps(manifest.steps).map(s => s.id);
  assert.ok(ids.includes('choose_install_surface'));
  assert.ok(ids.includes('confirm_workspace_root'));
  const surface = manifest.steps.find(s => s.id === 'choose_install_surface');
  assert.equal(surface.verify.state_key, 'install_surface');
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
  assert.doesNotMatch(text, new RegExp(`${['thiscodex', 'current', 'bot'].join('-')}|/${['home', 'tofu'].join('/')}`));
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

test('manifest interviews for progress reporting cadence', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const step = manifest.steps.find(s => s.id === 'progress_report_cadence');
  assert.ok(step, 'progress_report_cadence missing');
  assert.equal(step.action, 'prompt');
  assert.equal(step.verify.state_key, 'progress_report_cadence');
  assert.match(step.reason, /progress|report/i);
});

test('default-recommended aliases are emitted only after cadence and runner materialization', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const byId = Object.fromEntries(manifest.steps.map(step => [step.id, step]));
  assert.ok(byId.progress_report_cadence.order < byId.materialize_runner.order);
  assert.ok(byId.materialize_runner.order < byId.alias_consent.order);
  assert.match(byId.ask_alias_consent.when, /daemon_guide.*yes/);
  assert.match(byId.alias_consent.when, /daemon_guide.*yes/);
  assert.match(byId.ask_alias_consent.reason, /explicit no|explicit.*no/i);
});

// B4 (PRD 59-pm-prd-night-batch success criteria 6-8): the wiki (Obsidian vault)
// path is a first-class guided-init question, but its verify must never be
// consent-gated or otherwise able to block bot creation when left blank.
test('manifest asks a first-class, non-blocking wiki path question', () => {
  const manifest = loadManifest('install/thiscodex.install.json');
  const step = manifest.steps.find(s => s.id === 'confirm_wiki_path');
  assert.ok(step, 'confirm_wiki_path missing');
  assert.equal(step.action, 'prompt');
  assert.equal(step.verify.type, 'wiki-path-optional');
  assert.equal(step.verify.state_key, 'wiki_path');
  assert.notEqual(step.safety, 'consent-gated');
  assert.match(step.reason, /optional/i);
  // ordered before confirm_state_dir, alongside the other confirm_* guided questions
  const wikiOrder = step.order;
  const stateDirOrder = manifest.steps.find(s => s.id === 'confirm_state_dir').order;
  assert.ok(wikiOrder < stateDirOrder);
});
