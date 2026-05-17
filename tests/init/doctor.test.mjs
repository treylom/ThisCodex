import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyStep, detectStaleSuperpowersWrapper, rolloutFilesForThread } from '../../scripts/lib/doctor.mjs';

test('path-writable verify passes for existing writable path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const result = await verifyStep({ verify: { type: 'path-writable', state_key: 'confirmed_bot_wd' } }, { confirmed_bot_wd: dir });
  assert.equal(result.ok, true);
  rmSync(dir, { recursive: true, force: true });
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
