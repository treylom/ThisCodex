import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const plugin = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));

test('Codex plugin package exposes canonical plugin surface files', () => {
  for (const path of [
    'agents/openai.yaml',
    'skills/SKILL.md',
    'plugin.lock.json',
    'scripts/sync-to-codex-plugin.sh',
    '.github/workflows/publish-codex-plugin.yml',
  ]) {
    assert.ok(existsSync(path), `${path} missing`);
  }
});

test('plugin.json follows current Codex plugin interface conventions', () => {
  assert.equal(plugin.name, 'thiscodex');
  assert.equal(plugin.skills, './skills/');
  assert.equal(plugin.interface.displayName, 'ThisCodex');
  assert.equal(plugin.interface.category, 'Coding');
  assert.deepEqual(plugin.interface.capabilities, ['Interactive', 'Read', 'Write']);
  assert.ok(plugin.interface.privacyPolicyURL, 'privacyPolicyURL missing');
  assert.ok(plugin.interface.termsOfServiceURL, 'termsOfServiceURL missing');
  assert.match(plugin.interface.brandColor, /^#[0-9A-Fa-f]{6}$/);
  assert.match(plugin.interface.composerIcon, /^\.\/assets\/.+/);
  assert.match(plugin.interface.logo, /^\.\/assets\/.+/);
  assert.ok(Array.isArray(plugin.interface.screenshots), 'screenshots must be an array');
  assert.ok(plugin.interface.defaultPrompt.length <= 3, 'defaultPrompt max 3');
  for (const prompt of plugin.interface.defaultPrompt) {
    assert.ok(prompt.length <= 128, `prompt too long: ${prompt}`);
  }
});

test('root skill delegates to the ThisCodex skill without duplicating full docs', () => {
  const skill = readFileSync('skills/SKILL.md', 'utf8');
  assert.match(skill, /^---\nname: thiscodex-plugin\n/m);
  assert.match(skill, /skills\/thiscodex\/SKILL\.md/);
  assert.match(skill, /guided onboarding/i);
});

test('plugin lock records shipped skills and upstream packaging basis', () => {
  const lock = JSON.parse(readFileSync('plugin.lock.json', 'utf8'));
  assert.equal(lock.lockVersion, 1);
  assert.equal(lock.plugin.name, 'thiscodex');
  assert.equal(lock.plugin.version, plugin.version);
  assert.ok(lock.sources.some(s => s.repo === 'openai/plugins' && s.path === 'plugins/figma'));
  assert.ok(lock.sources.some(s => s.repo === 'obra/superpowers'));
  assert.deepEqual(lock.skills.map(s => s.id).sort(), ['prompt', 'thiscodex']);
});

test('README documents plugin packaging as canonical but keeps guided onboarding distinct', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /Codex plugin/i);
  assert.match(readme, /plugin packaging/i);
  assert.match(readme, /Guided onboarding/i);
});
