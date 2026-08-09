import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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
  const infra = readFileSync(files.infra, 'utf8');
  assert.match(infra, /DISCORD_STATE_DIR=/);
  // A guided install must end in a bootable bot: infra-launch.sh wires the
  // reference bridge instead of leaving a placeholder guide (2026-08-09 field
  // finding — the placeholder meant "follow every step, bot never starts").
  assert.match(infra, /codex app-server .*--listen/);
  assert.match(infra, new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/examples/bot\\.py`));
  assert.match(infra, /requirements\.txt/);
  assert.doesNotMatch(infra, /replace this guide command/);
  // Y2/Y4 (2026-08-09 review): crash-loop evidence survives one boot, and the
  // supervisor restarts the PAIR when either side dies.
  assert.match(infra, /READY_LOG\.prev/);
  assert.match(infra, /BOT_PID/);
  assert.match(infra, />= \(2, 3\)/);
  // B1: probe and launch must use the SAME interpreter, overridable via
  // THISCODEX_PYTHON (venv installs are unreachable otherwise).
  assert.match(infra, /PY="\$\{THISCODEX_PYTHON:-python3\}"/);
  assert.doesNotMatch(infra, /^python3 /m);
  assert.doesNotMatch(infra, /pipx/);
  // 막힘 19/20 (2026-08-09): pin the discord tool to THIS bot's state dir, and
  // warn when the instruction file / MCP registration is absent.
  assert.match(infra, /-c "mcp_servers\.discord\.env\.DISCORD_STATE_DIR=\$DISCORD_STATE_DIR"/);
  assert.match(infra, /AGENTS\.md missing/);
  assert.match(infra, /mcp_servers.discord\] —/);
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

test('planBotFiles names the missing field instead of TypeErroring later', () => {
  assert.throws(() => planBotFiles({
    confirmed_repo_root: '/repo',
    confirmed_bot_wd: '/bot',
  }), /confirmed_state_dir missing/);
});

test('materializeBotFiles seeds access.json.example into the state dir and never overwrites', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  mkdirSync(join(root, 'examples'), { recursive: true });
  writeFileSync(join(root, 'examples', 'access.json.example'), '{"dmPolicy":"allowlist"}\n');
  const s = { confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state };
  materializeBotFiles(s);
  assert.match(readFileSync(join(state, 'access.json.example'), 'utf8'), /allowlist/);
  writeFileSync(join(state, 'access.json.example'), '{"custom":true}\n');
  materializeBotFiles(s);
  assert.match(readFileSync(join(state, 'access.json.example'), 'utf8'), /custom/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('materializeBotFiles seeds BOT_WD/AGENTS.md from examples and never overwrites', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  mkdirSync(join(root, 'examples'), { recursive: true });
  writeFileSync(join(root, 'examples', 'AGENTS.md'), '# ref\nDiscord Reply Rule\n');
  const s = { confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state };
  materializeBotFiles(s);
  assert.match(readFileSync(join(bot, 'AGENTS.md'), 'utf8'), /Discord Reply Rule/);
  writeFileSync(join(bot, 'AGENTS.md'), '# customized by operator\n');
  materializeBotFiles(s);
  assert.match(readFileSync(join(bot, 'AGENTS.md'), 'utf8'), /customized by operator/);
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
