import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBotFiles, materializeBotFiles, aliasBlock } from '../../scripts/lib/materialize.mjs';

test('planBotFiles rejects provisional BOT_WD', () => {
  assert.throws(() => planBotFiles({
    confirmed_repo_root: '/repo',
    confirmed_bot_wd: ['/', 'home', 'tofu', ['thiscodex', 'current', 'bot'].join('-')].join('/'),
    confirmed_state_dir: '/state',
  }), /provisional/);
});

test('materializeBotFiles writes run and infra launch files with parameterized paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const files = materializeBotFiles({ confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state });
  assert.ok(existsSync(files.run));
  assert.match(readFileSync(files.run, 'utf8'), new RegExp(`BOT_WD="${bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(readFileSync(files.infra, 'utf8'), /DISCORD_STATE_DIR=/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('materializeBotFiles writes selected progress cadence for bridge consumption', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const files = materializeBotFiles({
    confirmed_repo_root: root,
    confirmed_bot_wd: bot,
    confirmed_state_dir: state,
    answers: { progress_report_cadence: '3m' },
  });
  const cfg = JSON.parse(readFileSync(join(state, 'progress-reporting.json'), 'utf8'));
  assert.equal(cfg.progress_report_cadence, '3m');
  assert.equal(cfg.heartbeat_interval_sec, 180);
  assert.equal(cfg.mode, 'heartbeat');
  assert.match(readFileSync(files.run, 'utf8'), /THISCODEX_PROGRESS_CADENCE="3m"/);
  assert.match(readFileSync(files.run, 'utf8'), /THISCODEX_HEARTBEAT_SEC="180"/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('per_task cadence does not create a heartbeat timer', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const files = materializeBotFiles({
    confirmed_repo_root: root,
    confirmed_bot_wd: bot,
    confirmed_state_dir: state,
    answers: { progress_report_cadence: 'per_task' },
  });
  const cfg = JSON.parse(readFileSync(join(state, 'progress-reporting.json'), 'utf8'));
  assert.equal(cfg.heartbeat_interval_sec, 0);
  assert.equal(cfg.mode, 'on_complete');
  assert.match(readFileSync(files.run, 'utf8'), /THISCODEX_HEARTBEAT_SEC="0"/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('aliasBlock enters confirmed repo root and confirmed BOT_WD', () => {
  const text = aliasBlock({ confirmed_repo_root: '/repo/ThisCodex', confirmed_bot_wd: '/bots/sonseokhee', session: 'thiscodex' });
  assert.ok(text.includes("cd '/repo/ThisCodex'"));
  assert.ok(text.includes("BOT_WD='/bots/sonseokhee'"));
  assert.doesNotMatch(text, new RegExp(['thiscodex', 'current', 'bot'].join('-')));
});

test('aliasBlock gives a tmux-only Discord flow and YOLO helpers without cmux', () => {
  const text = aliasBlock({
    confirmed_repo_root: '/repo/ThisCodex',
    confirmed_bot_wd: '/bots/sonseokhee',
    confirmed_state_dir: '/state/discord-sonseokhee',
    session: 'thiscodex',
  });
  assert.match(text, /thiscodex-discord/);
  assert.match(text, /thiscodex-yolo-on/);
  assert.match(text, /thiscodex-yolo-off/);
  assert.match(text, /tmux attach/);
  assert.doesNotMatch(text, /cmux/i);
});

test('aliasBlock exports heartbeat env from selected progress cadence', () => {
  const text = aliasBlock({
    confirmed_repo_root: '/repo/ThisCodex',
    confirmed_bot_wd: '/bots/reviewer',
    confirmed_state_dir: '/state/discord-reviewer',
    session: 'thiscodex',
    answers: { progress_report_cadence: '1m' },
  });
  assert.match(text, /THISCODEX_PROGRESS_CADENCE='1m'/);
  assert.match(text, /THISCODEX_HEARTBEAT_SEC='60'/);
});
