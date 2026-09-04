import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { automationHandoffHookReady, verifyStep, detectStaleSuperpowersWrapper, rolloutFilesForThread } from '../../scripts/lib/doctor.mjs';
import { flattenHooks, hookTrustHash, hooksDocument, pluginTrustKey } from '../../scripts/lib/hooks-contract.mjs';

function trustedConfig(pluginId = 'thiscodex@test') {
  const lines = [`[plugins."${pluginId}"]`, 'enabled = true', '', '[hooks.state]', ''];
  for (const row of flattenHooks(hooksDocument())) {
    lines.push(
      `[hooks.state."${pluginTrustKey(pluginId, row.event, row.groupIndex, row.hookIndex)}"]`,
      `trusted_hash = "${hookTrustHash(row.event, row.matcher, row.hook)}"`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

test('hooks-migration-applied verify is recognized and fails while proven legacy entries remain', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const codex = join(home, '.codex');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, 'hooks.json'), `${JSON.stringify({
    hooks: { Stop: [{ hooks: [
      { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
    ] }] },
  }, null, 2)}\n`);
  const env = {
    ...process.env,
    HOME: home,
    THISCODEX_REPO_ROOT: process.cwd(),
    THISCODEX_PROJECT_ROOT: home,
  };
  try {
    const pending = await verifyStep({ verify: { type: 'hooks-migration-applied' } }, {}, env);
    assert.equal(pending.ok, false);
    assert.match(pending.message, /legacy hook conflict/i);
    rmSync(join(codex, 'hooks.json'));
    const clean = await verifyStep({ verify: { type: 'hooks-migration-applied' } }, {}, env);
    assert.equal(clean.ok, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('path-writable verify passes for existing writable path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const result = await verifyStep({ verify: { type: 'path-writable', state_key: 'confirmed_bot_wd' } }, { confirmed_bot_wd: dir });
  assert.equal(result.ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('legacy readiness API now delegates to the aggregate 11-hook bundle and trust contract', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const codex = join(home, '.codex');
  mkdirSync(codex, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    THISCODEX_REPO_ROOT: process.cwd(),
    THISCODEX_PROJECT_ROOT: home,
    THISCODEX_PLUGIN_ID: 'thiscodex@test',
  };
  assert.equal(automationHandoffHookReady(home, env).ok, false);
  writeFileSync(join(codex, 'config.toml'), trustedConfig());
  const ready = automationHandoffHookReady(home, env);
  assert.equal(ready.ok, true);
  assert.match(ready.message, /HOOKS PASS/);
  const missingTrust = readFileSync(join(codex, 'config.toml'), 'utf8').replace(/trusted_hash = .*\n/, '');
  writeFileSync(join(codex, 'config.toml'), missingTrust);
  assert.equal(automationHandoffHookReady(home, env).ok, false);
  rmSync(home, { recursive: true, force: true });
});

test('path-writable verify fails with friendly message', async () => {
  const result = await verifyStep({ verify: { type: 'path-writable', state_key: 'confirmed_bot_wd' } }, { confirmed_bot_wd: '/definitely/no/such/path' });
  assert.equal(result.ok, false);
  assert.match(result.message, /not writable|missing/i);
});

test('stale using-superpowers wrapper detection reports latest installed version', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const base = join(home, '.codex', 'plugins', 'cache', 'openai-curated', 'superpowers');
  mkdirSync(join(base, '5.0.7'), { recursive: true });
  mkdirSync(join(base, '5.1.0'), { recursive: true });
  const stale = detectStaleSuperpowersWrapper({ wrapperVersion: '5.0.7', home });
  assert.equal(stale.stale, true);
  assert.equal(stale.latest, '5.1.0');
  assert.match(stale.next_command, /using-superpowers|superpowers/);
  rmSync(home, { recursive: true, force: true });
});

test('rolloutFilesForThread finds rollout files containing thread id', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const tid = '12345678-1234-1234-1234-123456789abc';
  const dir = join(home, '.codex', 'sessions', '2026', '05', '17');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-test-${tid}.jsonl`), '{}\n');
  assert.equal(rolloutFilesForThread(home, tid).length, 1);
  rmSync(home, { recursive: true, force: true });
});

test('rollout-materialized verify reads .codex-thread-id from BOT_WD', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const tid = '12345678-1234-1234-1234-123456789abc';
  const dir = join(home, '.codex', 'sessions', '2026', '05', '17');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(bot, '.codex-thread-id'), `${tid}\n`);
  writeFileSync(join(dir, `rollout-test-${tid}.jsonl`), '{}\n');
  const result = await verifyStep(
    { verify: { type: 'rollout-materialized' } },
    { confirmed_bot_wd: bot },
    { HOME: home },
  );
  assert.equal(result.ok, true);
  rmSync(home, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
});

test('superpowers verifier passes only when plugin path exists', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  let result = await verifyStep({ verify: { type: 'superpowers-available' } }, {}, { HOME: home });
  assert.equal(result.ok, false);
  assert.match(result.message, /superpowers/i);
  mkdirSync(join(home, '.codex', 'plugins', 'cache', 'openai-curated', 'superpowers'), { recursive: true });
  result = await verifyStep({ verify: { type: 'superpowers-available' } }, {}, { HOME: home });
  assert.equal(result.ok, true);
  rmSync(home, { recursive: true, force: true });
});

test('rollout-materialized skips with reason when no codex thread exists (CI-like)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = await verifyStep(
    { verify: { type: 'rollout-materialized' } },
    {},
    { HOME: home },
  );
  assert.equal(result.ok, true);
  assert.match(result.message, /skip/i);
  rmSync(home, { recursive: true, force: true });
});

test('wiki-path-optional verify never fails when no wiki path was provided', async () => {
  const result = await verifyStep({ verify: { type: 'wiki-path-optional', state_key: 'wiki_path' } }, { answers: {} });
  assert.equal(result.ok, true);
  assert.match(result.message, /not provided/i);
});

test('wiki-path-optional verify never fails when the given path does not exist, but warns', async () => {
  const result = await verifyStep(
    { verify: { type: 'wiki-path-optional', state_key: 'wiki_path' } },
    { answers: { wiki_path: '/definitely/no/such/wiki/path' } },
  );
  assert.equal(result.ok, true);
  assert.match(result.message, /WARN/);
  assert.match(result.message, /does not exist/i);
});

test('wiki-path-optional verify passes silently when the given path exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-wiki-'));
  const result = await verifyStep(
    { verify: { type: 'wiki-path-optional', state_key: 'wiki_path' } },
    { answers: { wiki_path: dir } },
  );
  assert.equal(result.ok, true);
  assert.equal(result.message, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('rollout-materialized hard-fails when thread exists but rollout missing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  writeFileSync(join(bot, '.codex-thread-id'), 'aaaa1111-2222-3333-4444-555566667777\n');
  const result = await verifyStep(
    { verify: { type: 'rollout-materialized' } },
    { confirmed_bot_wd: bot },
    { HOME: home },
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /not materialized/i);
  rmSync(home, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
});
