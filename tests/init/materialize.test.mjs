import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planBotFiles, materializeBotFiles, aliasBlock, runScript, infraScript } from '../../scripts/lib/materialize.mjs';

// Runs the generated `export <varName>=...` line from a materialize.mjs output
// through REAL bash and reports what actually landed. Bracketed by MARKER
// lines that must both survive — evidence the block genuinely executed
// (2026-08-10 review lesson: an assertion on unchanged bytes/strings can stay
// green even when the probed block never ran at all).
function runGeneratedExportLine(scriptText, varName) {
  const line = scriptText.split('\n').find(l => l.includes(`export ${varName}=`));
  assert.ok(line, `export ${varName} line not found in generated script`);
  const probe = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    line,
    'echo "MARKER-RAN-START"',
    `printf '%s' "\$${varName}"`,
    'echo',
    'echo "MARKER-RAN-END"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', probe], { encoding: 'utf8' });
  return { ...result, line };
}

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

// B3/B4 (2026-08-10 night batch, PRD 59-pm-prd-night-batch success criteria 3-8):
// rules-seed.md copy-once install + first-class OPTIONAL wiki (Obsidian vault) path.

test('materializeBotFiles seeds rules-seed.md from examples and never overwrites', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  mkdirSync(join(root, 'examples'), { recursive: true });
  writeFileSync(join(root, 'examples', 'rules-seed.md'), '<!-- rules-seed v1.0.0 -->\nRule 1\nRule 2\n');
  const s = { confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state };
  materializeBotFiles(s);
  assert.match(readFileSync(join(bot, 'rules-seed.md'), 'utf8'), /rules-seed v1\.0\.0/);
  writeFileSync(join(bot, 'rules-seed.md'), '<!-- rules-seed v1.0.0 -->\ncustomized by operator\n');
  materializeBotFiles(s);
  assert.match(readFileSync(join(bot, 'rules-seed.md'), 'utf8'), /customized by operator/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('materializeBotFiles skips rules-seed.md seeding when no source exists (no crash, bot creation proceeds)', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  // deliberately no examples/rules-seed.md under root
  const files = materializeBotFiles({ confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state });
  assert.ok(existsSync(files.run));
  assert.equal(existsSync(join(bot, 'rules-seed.md')), false);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('infra-launch.sh carries a boot-time rules-seed staleness WARN that never auto-merges', () => {
  const infra = infraScript({ confirmed_repo_root: '/repo', confirmed_bot_wd: '/bot', confirmed_state_dir: '/state' });
  assert.match(infra, /rules-seed v\[0-9\.\]\+/);
  // Direction-neutral wording (2026-08-10 review fix): a plain string !=
  // compare cannot tell "older" from "newer" — the message must not claim one.
  assert.match(infra, /rules-seed \$BOT_RULES_VER differs from product \$PRODUCT_RULES_VER — update by explicit command only/);
  assert.doesNotMatch(infra, /available/);
  assert.match(infra, /never auto-merges or auto-updates/);
});

test('materializeBotFiles lands THISCODEX_WIKI_PATH in run.sh and infra-launch.sh when a wiki path is provided', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const wiki = mkdtempSync(join(tmpdir(), 'tcx-wiki-'));
  const files = materializeBotFiles({
    confirmed_repo_root: root,
    confirmed_bot_wd: bot,
    confirmed_state_dir: state,
    answers: { wiki_path: wiki },
  });
  const runText = readFileSync(files.run, 'utf8');
  const infraText = readFileSync(files.infra, 'utf8');
  // single-quoted (shQuote), not a double-quoted "${...}" interpolation — see
  // the 2026-08-10 review shell-re-interpretation fix below.
  assert.match(runText, new RegExp(`THISCODEX_WIKI_PATH='${wiki.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(infraText, new RegExp(`THISCODEX_WIKI_PATH='${wiki.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
  rmSync(wiki, { recursive: true, force: true });
});

test('materializeBotFiles omits THISCODEX_WIKI_PATH when no wiki path is provided, and bot creation still succeeds', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  // no answers.wiki_path at all — the PRD constraint: absence never blocks creation.
  const files = materializeBotFiles({ confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state });
  assert.ok(existsSync(files.run));
  assert.ok(existsSync(files.infra));
  assert.doesNotMatch(readFileSync(files.run, 'utf8'), /THISCODEX_WIKI_PATH/);
  assert.doesNotMatch(readFileSync(files.infra, 'utf8'), /THISCODEX_WIKI_PATH/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('runScript/infraScript also omit THISCODEX_WIKI_PATH for an explicit empty-string wiki_path answer', () => {
  const state = { confirmed_repo_root: '/repo', confirmed_bot_wd: '/bot', confirmed_state_dir: '/state', answers: { wiki_path: '' } };
  assert.doesNotMatch(runScript(state), /THISCODEX_WIKI_PATH/);
  assert.doesNotMatch(infraScript(state), /THISCODEX_WIKI_PATH/);
});

// 2026-08-10 review 🔴: a bare `export THISCODEX_WIKI_PATH="${wikiPath}"` lets
// bash RE-INTERPRET the answer at boot time ($HOME expands, an embedded "
// breaks the quoting, a trailing `"; cmd; :"` runs as a real command) — and
// wiki_path is the one guided-init answer with no path-exists/enum gate
// upstream (wiki-path-optional never fails verify). Fixed with shQuote
// (single-quoted, bash never expands/executes inside '...'). Each case below
// actually runs the generated line through bash (see runGeneratedExportLine)
// and requires BOTH markers in stdout as positive proof the block executed —
// not just a string/byte comparison that would stay green on a no-op.
test('THISCODEX_WIKI_PATH lands as a literal value in run.sh and infra-launch.sh — the shell never re-interprets it', () => {
  const cases = [
    ['dollar-sign / $HOME-shaped', '/Users/t/$HOME-vault'],
    ['embedded space', '/Users/t/My Vault'],
    ['embedded double quote', '/Users/t/My "Vault"'],
    ['embedded single quote (exercises shQuote escaping itself)', "/Users/t/O'Brien's Vault"],
    ['command-injection attempt', '/tmp/v"; echo INJECTED-BY-WIKI-PATH; :"'],
  ];
  for (const scriptFn of [runScript, infraScript]) {
    for (const [label, wikiPath] of cases) {
      const script = scriptFn({ confirmed_repo_root: '/repo', confirmed_bot_wd: '/bot', confirmed_state_dir: '/state', answers: { wiki_path: wikiPath } });
      const { status, stdout, stderr, line } = runGeneratedExportLine(script, 'THISCODEX_WIKI_PATH');
      const ctx = `[${scriptFn.name} / ${label}] line=${line}`;
      assert.equal(status, 0, `${ctx} bash exited nonzero: ${stderr}`);
      // positive proof the probe genuinely ran, not a vacuously-passing no-op
      assert.match(stdout, /MARKER-RAN-START/, ctx);
      assert.match(stdout, /MARKER-RAN-END/, ctx);
      const body = stdout.split('MARKER-RAN-START\n')[1]?.split('MARKER-RAN-END')[0]?.replace(/\n$/, '');
      assert.equal(body, wikiPath, `${ctx} value was re-interpreted by the shell (expected literal [${wikiPath}], got [${body}])`);
      // the injection payload must never surface as a STANDALONE output line —
      // that would mean it ran as its own command rather than landing as text
      // inside the printed value.
      assert.doesNotMatch(stdout, /^INJECTED-BY-WIKI-PATH$/m, `${ctx} injection payload executed as a separate command`);
    }
  }
});
