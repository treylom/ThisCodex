// Regression net for the 2026-08-09 onboarding field report (fc-demo clean-room run):
// guided init died at an unasked question, promised runner files were never asked for,
// on_fail guidance referenced a flag that does not exist, and only one skill was installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest } from '../../scripts/lib/manifest.mjs';
import { applySkillInstall, listSkillNames } from '../../scripts/lib/apply.mjs';
import { promptForStep } from '../../scripts/lib/prompts.mjs';

const MANIFEST = 'install/thiscodex.install.json';
// answers keys that are intentionally CLI/answers-file only (no interactive prompt)
const CLI_ONLY_ANSWER_KEYS = ['codex_yolo'];

test('every answers.* gate has a prompt that produces the answer', () => {
  const manifest = loadManifest(MANIFEST);
  const produced = new Set(
    manifest.steps
      .filter(s => s.action === 'prompt' && s.verify?.state_key)
      .map(s => s.verify.state_key),
  );
  for (const step of manifest.steps) {
    for (const [, key] of String(step.when || '').matchAll(/answers\.([a-zA-Z0-9_]+)/g)) {
      assert.ok(
        produced.has(key) || CLI_ONLY_ANSWER_KEYS.includes(key),
        `step ${step.id} gates on answers.${key} but no prompt produces it`,
      );
    }
  }
});

test('on_fail guidance never references the nonexistent --check flag', () => {
  const manifest = loadManifest(MANIFEST);
  for (const step of manifest.steps) {
    assert.doesNotMatch(step.on_fail.next_command, /--check\b/, `step ${step.id}`);
  }
});

test('confirm_repo_root asks instead of failing an unasked question', () => {
  const manifest = loadManifest(MANIFEST);
  const step = manifest.steps.find(s => s.id === 'confirm_repo_root');
  assert.equal(step.action, 'prompt');
});

test('applySkillInstall copies every skill directory, not only thiscodex', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  for (const name of ['help', 'thiscodex']) {
    mkdirSync(join(repo, 'skills', name), { recursive: true });
    writeFileSync(join(repo, 'skills', name, 'SKILL.md'), `# ${name}`);
  }
  const r = applySkillInstall(repo, home, 'user');
  assert.deepEqual(r.installed, ['help', 'thiscodex']);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'help', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.agents', 'skills', 'thiscodex', 'SKILL.md')));
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('the real repo skill tree exposes help to listSkillNames', () => {
  assert.ok(listSkillNames('.').includes('help'), 'skills/help must be installable');
});

test('answer-one-of prompts surface their choices and a default', () => {
  const prompt = promptForStep(
    { id: 'choose_install_surface', reason: 'r', verify: { type: 'answer-one-of', choices: 'placement,guided' } },
    { detected: { install_surface: 'guided' } },
  );
  assert.match(prompt.question, /placement \/ guided/);
  assert.equal(prompt.defaultValue, 'guided');
});
