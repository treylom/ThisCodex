import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/thiscodex.mjs', import.meta.url));
const run = (args, cwd, extraEnv = {}) => execFileSync(process.execPath, [BIN, ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, ...extraEnv },
});

test('--check --non-interactive writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const before = readdirSync(dir).sort();
  const out = run(['init', '--check', '--non-interactive'], dir);
  assert.deepEqual(readdirSync(dir).sort(), before);
  assert.match(out, /check|점검|Codex/i);
  rmSync(dir, { recursive: true, force: true });
});

test('--apply --non-interactive without yes stops before consent-gated writes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, '--apply', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /--yes|--answers|next command/i);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('--tone=dev switches output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const out = run(['init', '--check', '--non-interactive', '--tone=dev'], dir);
  assert.match(out, /skill-scan|Codex/i);
  rmSync(dir, { recursive: true, force: true });
});

test('automation gate consumes YAML policy, blocks missing attempts, and records a failed attempt before handoff', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const audit = join(home, 'attempts.jsonl');
  const blocked = spawnSync(process.execPath, [BIN, 'automation-gate',
    '--gate', 'browser_provider_setup',
    '--automation-mode', 'auto',
    '--audit-file', audit,
  ], {
    encoding: 'utf8',
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).code, 'attempt_required');

  const failed = spawnSync(process.execPath, [BIN, 'automation-gate',
    '--gate', 'browser_provider_setup',
    '--automation-mode', 'auto',
    '--attempted',
    '--status', 'failed',
    '--provider', 'playwright',
    '--operation', 'register-and-redetect',
    '--reason', 'provider did not become callable',
    '--browser-terminal-reason', 'provider_unavailable_after_install',
    '--audit-file', audit,
  ], {
    encoding: 'utf8',
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  const result = JSON.parse(failed.stdout);
  assert.equal(result.code, 'attempt_failed_handoff_allowed');
  assert.equal(result.handoff_allowed, true);
  const rows = readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.decision), ['blocked', 'handoff_allowed']);
  assert.equal(rows[1].browser_terminal_reason, 'provider_unavailable_after_install');
  rmSync(home, { recursive: true, force: true });
});

test('non-interactive apply cannot silently select an automation strategy', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /automation_mode|auto.*manual/i);
  assert.equal(existsSync(join(home, '.config', 'thiscodex', 'install-state.json')), false);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('CLI derives repo root with fileURLToPath for Windows-safe URLs', () => {
  const source = readFileSync(BIN, 'utf8');
  assert.match(source, /fileURLToPath\(new URL\('\.\.', import\.meta\.url\)\)/);
  assert.doesNotMatch(source, /new URL\('\.\.', import\.meta\.url\)\.pathname/);
});

test('non-TTY init does not enter readline and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const result = spawnSync(process.execPath, [BIN, 'init'], {
    cwd: dir,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd() },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ThisCodex|next command|check/i);
  rmSync(dir, { recursive: true, force: true });
});

test('doctor replays verify checks and prints ordered result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, 'doctor', '--non-interactive'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /doctor|verify|BOT_WD|Codex/i);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('non-TTY apply does not persist confirmed_* as check_only placeholder', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  const statePath = join(home, '.config', 'thiscodex', 'install-state.json');
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.notEqual(state.answers?.confirmed_bot_wd, 'check_only');
    assert.notEqual(state.answers?.confirmed_state_dir, 'check_only');
    assert.notEqual(state.answers?.confirmed_repo_root, 'check_only');
  }
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('non-interactive apply with yes but no answers stops before guided path persistence', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--non-interactive'], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /Next command:/);
  assert.equal(existsSync(join(home, '.config', 'thiscodex', 'install-state.json')), false);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('answers file confirms guided paths and persists them explicitly', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: '1m',
    alias_consent: 'no',
    daemon_guide: 'no',
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = JSON.parse(readFileSync(join(home, '.config', 'thiscodex', 'install-state.json'), 'utf8'));
  assert.equal(state.confirmed_repo_root, process.cwd());
  assert.equal(state.confirmed_workspace_root, workspace);
  assert.equal(state.confirmed_bot_wd, bot);
  assert.equal(state.confirmed_state_dir, stateDir);
  assert.equal(state.answers.progress_report_cadence, '1m');
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test('guided apply defaults launch helpers to yes and emits them after run.sh exists', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: 'per_task',
    daemon_guide: 'yes',
    // alias_consent deliberately omitted: detected default must remain yes.
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = JSON.parse(readFileSync(join(home, '.config', 'thiscodex', 'install-state.json'), 'utf8'));
  assert.equal(state.answers.alias_consent, 'yes');
  assert.ok(existsSync(join(bot, 'run.sh')));
  assert.match(result.stdout, /alias thiscodex-start=.*run\.sh/);
  assert.match(result.stdout, /alias thiscodex-stop=.*run\.sh/);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test('guided apply carries the chosen runtime name into session, BOT_NAME, and aliases', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    session: 'pt',
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: 'per_task',
    alias_consent: 'yes',
    daemon_guide: 'yes',
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = JSON.parse(readFileSync(join(home, '.config', 'thiscodex', 'install-state.json'), 'utf8'));
  assert.equal(state.answers.session, 'pt');
  assert.match(readFileSync(join(bot, 'run.sh'), 'utf8'), /export SESSION='pt'/);
  assert.match(readFileSync(join(bot, 'infra-launch.sh'), 'utf8'), /BOT_NAME='pt'/);
  assert.match(result.stdout, /^alias pt=/m);
  for (const dir of [repo, home, workspace, bot, stateDir]) rmSync(dir, { recursive: true, force: true });
});

test('doctor on a materialized install points to the exact runner instead of restarting onboarding', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), "tcx-bot user's-"));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    session: 'pt',
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: 'per_task',
    alias_consent: 'yes',
    daemon_guide: 'yes',
  }));
  const env = { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home };
  const apply = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env,
  });
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const doctor = spawnSync(process.execPath, [BIN, 'doctor', '--non-interactive'], {
    cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env,
  });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.doesNotMatch(doctor.stdout, /Next command: thiscodex init --apply/);
  assert.match(doctor.stdout, /Next command: .*tcx-bot user'\\''s-.*run\.sh' start/);
  assert.doesNotMatch(doctor.stdout, /doctor doctor completed/);
  assert.match(doctor.stdout, /doctor completed/);
  for (const dir of [repo, home, workspace, bot, stateDir]) rmSync(dir, { recursive: true, force: true });
});

test('guided apply rejects an unsafe runtime name before materializing runner files', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    session: 'pt; touch unsafe',
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: 'per_task',
    alias_consent: 'yes',
    daemon_guide: 'yes',
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /session.*letters|runtime|dash|underscore/i);
  assert.equal(existsSync(join(bot, 'run.sh')), false);
  for (const dir of [repo, home, workspace, bot, stateDir]) rmSync(dir, { recursive: true, force: true });
});

// B4 (PRD 59-pm-prd-night-batch): the wiki path prompt is free text, not an
// enum — the generic non-interactive fallback ('check_only') must never land
// as a literal wiki_path value, and its absence must never block --apply.
test('non-interactive guided apply without a wiki path completes with wiki_path empty, not check_only, and prints sample-vault guidance', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: 'per_task',
    alias_consent: 'no',
    daemon_guide: 'yes',
    // wiki_path deliberately omitted
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = JSON.parse(readFileSync(join(home, '.config', 'thiscodex', 'install-state.json'), 'utf8'));
  assert.notEqual(state.answers.wiki_path, 'check_only');
  assert.ok(!state.answers.wiki_path, `wiki_path should be empty/unset, got ${JSON.stringify(state.answers.wiki_path)}`);
  assert.match(result.stdout, /No Obsidian wiki \(vault\) connected/);
  assert.doesNotMatch(readFileSync(join(bot, 'run.sh'), 'utf8'), /THISCODEX_WIKI_PATH/);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

test('answers file with a wiki path lands THISCODEX_WIKI_PATH in the generated run.sh', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'tcx-workspace-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const wiki = mkdtempSync(join(tmpdir(), 'tcx-wiki-'));
  const answers = join(home, 'answers.json');
  writeFileSync(answers, JSON.stringify({
    install_surface: 'guided',
    confirmed_repo_root: process.cwd(),
    confirmed_workspace_root: workspace,
    confirmed_bot_wd: bot,
    confirmed_state_dir: stateDir,
    codex_skill_layer: 'user',
    codex_marketplace: 'no',
    codex_yolo: 'safe',
    progress_report_cadence: 'per_task',
    alias_consent: 'no',
    daemon_guide: 'yes',
    wiki_path: wiki,
  }));
  const result = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = JSON.parse(readFileSync(join(home, '.config', 'thiscodex', 'install-state.json'), 'utf8'));
  assert.equal(state.answers.wiki_path, wiki);
  // single-quoted (shQuote) — a double-quoted "${...}" would let the shell
  // re-interpret the answer at boot (2026-08-10 review fix).
  assert.match(readFileSync(join(bot, 'run.sh'), 'utf8'), new RegExp(`THISCODEX_WIKI_PATH='${wiki.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.doesNotMatch(result.stdout, /No Obsidian wiki \(vault\) connected/);
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(wiki, { recursive: true, force: true });
});
