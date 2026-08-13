import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/thiscodex.mjs', import.meta.url));
const PRODUCTION_POLICY = fileURLToPath(new URL('../../install/automation-policy.yaml', import.meta.url));
const TEST_POLICY_ROOT = mkdtempSync(join(tmpdir(), 'tcx-cli-policy-'));
const TEST_POLICY = join(TEST_POLICY_ROOT, 'automation-policy.yaml');
writeFileSync(
  TEST_POLICY,
  readFileSync(PRODUCTION_POLICY, 'utf8')
    .replace('browser_tools_required: true', 'browser_tools_required: false'),
);
const TEST_CLI_ENV = { THISCODEX_AUTOMATION_POLICY: TEST_POLICY };
process.on('exit', () => rmSync(TEST_POLICY_ROOT, { recursive: true, force: true }));
const run = (args, cwd, extraEnv = {}) => execFileSync(process.execPath, [BIN, ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, ...TEST_CLI_ENV, ...extraEnv },
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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

test('automation gate consumes bridge-observed evidence and emits a current-turn receipt', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const audit = join(home, 'attempts.jsonl');
  const evidenceDir = join(home, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'active-turn.json'), JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', started_at: new Date(Date.now() - 1000).toISOString(),
  }));
  const common = [
    '--gate', 'browser_provider_setup', '--automation-mode', 'auto',
    '--status', 'failed', '--provider', 'playwright',
    '--surface', 'browser', '--flow', 'browser-provider',
    '--operation', 'register-restart-redetect-provider',
    '--terminal', 'tool_failed', '--reason-code', 'provider_not_callable',
    '--audit-file', audit,
  ];
  const cliEnv = { ...process.env, ...TEST_CLI_ENV, THISCODEX_AUTOMATION_POLICY: PRODUCTION_POLICY,
    THISCODEX_REPO_ROOT: process.cwd(), HOME: home, THISCODEX_AUTOMATION_EVIDENCE_DIR: evidenceDir };
  const started = spawnSync(process.execPath, [BIN, 'automation-flow', '--start', '--flow', 'browser-provider'], {
    encoding: 'utf8', env: cliEnv,
  });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const prepared = spawnSync(process.execPath, [BIN, 'automation-attempt', '--gate', 'browser_provider_setup'], {
    encoding: 'utf8', env: cliEnv,
  });
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const attempt = JSON.parse(prepared.stdout).attempt;
  const blocked = spawnSync(process.execPath, [BIN, 'automation-gate',
    ...common,
  ], {
    encoding: 'utf8',
    env: cliEnv,
  });
  assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).code, 'matching_evidence_missing');

  writeFileSync(join(evidenceDir, 'browser-evidence.jsonl'), `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
    attempt_id: attempt.attempt_id, gate: 'browser_provider_setup', flow: 'browser-provider',
    operation: 'register-restart-redetect-provider', provider: 'playwright', tool: 'provider-setup-command',
    tool_class: 'provider_setup', status: 'failed', error_class: 'tool_error',
    observed_at: new Date().toISOString(),
  })}\n`);

  const failed = spawnSync(process.execPath, [BIN, 'automation-gate',
    ...common,
  ], {
    encoding: 'utf8',
    env: cliEnv,
  });
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  const result = JSON.parse(failed.stdout);
  assert.equal(result.code, 'verified_handoff_allowed');
  assert.equal(result.handoff_allowed, true);
  assert.match(result.receipt_marker, /thiscodex-automation-receipt/);
  const rows = readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.decision), ['blocked', 'handoff_allowed']);
  assert.equal(rows[1].evidence_item_id, 'item-1');
  assert.equal(rows[1].evidence_attempt_id, attempt.attempt_id);
  assert.equal(rows[1].evidence_gate, 'browser_provider_setup');
  assert.equal(rows[1].evidence_operation, 'register-restart-redetect-provider');

  writeFileSync(join(evidenceDir, 'active-turn.json'), JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-2', started_at: new Date(Date.now() - 1000).toISOString(),
  }));
  const completionPrepared = spawnSync(process.execPath, [BIN, 'automation-attempt', '--gate', 'browser_provider_ready'], {
    encoding: 'utf8', env: cliEnv,
  });
  assert.equal(completionPrepared.status, 0, completionPrepared.stdout + completionPrepared.stderr);
  const completionAttempt = JSON.parse(completionPrepared.stdout).attempt;
  writeFileSync(join(evidenceDir, 'browser-evidence.jsonl'), `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-2', item_id: 'item-2',
    attempt_id: completionAttempt.attempt_id, gate: 'browser_provider_ready', flow: 'browser-provider',
    operation: 'verify-browser-provider-callable', provider: 'playwright', tool: 'browser_snapshot',
    tool_class: 'browser_inspect', status: 'completed', error_class: 'none',
    observed_at: new Date().toISOString(),
  })}\n`, { flag: 'a' });
  const completed = spawnSync(process.execPath, [BIN, 'automation-gate',
    '--gate', 'browser_provider_ready', '--automation-mode', 'auto',
    '--status', 'succeeded', '--provider', 'playwright',
    '--surface', 'browser', '--flow', 'browser-provider',
    '--operation', 'verify-browser-provider-callable',
    '--terminal', 'flow_completed', '--reason-code', 'automatic_flow_completed',
    '--audit-file', audit,
  ], { encoding: 'utf8', env: cliEnv });
  assert.equal(completed.status, 0, completed.stdout + completed.stderr);
  const completion = JSON.parse(completed.stdout);
  assert.equal(completion.code, 'attempt_succeeded_continue');
  assert.equal(completion.flow_result, 'flow_cleared');
  assert.equal(existsSync(join(evidenceDir, 'active-flow.json')), false);
  rmSync(home, { recursive: true, force: true });
});

test('concurrent automation gates can consume one observed attempt only once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const evidenceDir = join(home, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const startedAt = new Date(Date.now() - 1000).toISOString();
  writeFileSync(join(evidenceDir, 'active-turn.json'), JSON.stringify({
    schema_version: 1, thread_id: 'thread-race', turn_id: 'turn-race', started_at: startedAt,
  }));
  writeFileSync(join(evidenceDir, 'active-flow.json'), JSON.stringify({
    schema_version: 1, thread_id: 'thread-race', flow: 'slack-auth', provider: 'playwright',
    started_at: startedAt, updated_at: startedAt,
  }));
  writeFileSync(join(evidenceDir, 'active-attempt.json'), JSON.stringify({
    schema_version: 1, thread_id: 'thread-race', turn_id: 'turn-race',
    attempt_id: 'attempt-race', gate: 'slack_browser_auth', flow: 'slack-auth',
    operation: 'login-ticket-confirm-challenge', evidence_tool: 'browser_action', started_at: startedAt,
  }));
  writeFileSync(join(evidenceDir, 'browser-evidence.jsonl'), `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-race', turn_id: 'turn-race', item_id: 'item-race',
    attempt_id: 'attempt-race', gate: 'slack_browser_auth', flow: 'slack-auth',
    operation: 'login-ticket-confirm-challenge', provider: 'playwright', tool: 'browser_click',
    tool_class: 'browser_action', status: 'failed', error_class: 'tool_error',
    observed_at: new Date().toISOString(),
  })}\n`);
  const args = [BIN, 'automation-gate',
    '--gate', 'slack_browser_auth', '--automation-mode', 'auto',
    '--status', 'failed', '--provider', 'playwright', '--surface', 'browser',
    '--flow', 'slack-auth', '--operation', 'login-ticket-confirm-challenge',
    '--terminal', 'tool_failed', '--reason-code', 'browser_tool_failed',
    '--audit-file', join(home, 'attempts.jsonl'),
  ];
  const env = { ...process.env, ...TEST_CLI_ENV, THISCODEX_AUTOMATION_POLICY: PRODUCTION_POLICY,
    THISCODEX_REPO_ROOT: process.cwd(), HOME: home,
    THISCODEX_AUTOMATION_EVIDENCE_DIR: evidenceDir };
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([invoke(), invoke(), invoke(), invoke()]);
  assert.equal(results.filter(result => result.status === 0).length, 1, JSON.stringify(results));
  assert.equal(results.filter(result => JSON.parse(result.stdout).code === 'verified_handoff_allowed').length, 1);
  const receipts = readFileSync(join(evidenceDir, 'handoff-receipts.jsonl'), 'utf8').trim().split('\n');
  assert.equal(receipts.length, 1);
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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

test('malformed install automation policy does not block the unrelated Discord thread CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-policy-'));
  const policy = join(dir, 'bad.yaml');
  writeFileSync(policy, 'not: valid: policy\n');
  const result = spawnSync(process.execPath, [BIN, 'discord-thread', 'public',
    '--channel-id', '123456789012345678', '--channel-type', '0',
    '--message-id', '223456789012345678', '--name', 'thread',
  ], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_AUTOMATION_POLICY: policy, THISCODEX_REPO_ROOT: process.cwd() },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('interactive init chooses automatic/manual before environment detection', () => {
  const source = readFileSync(BIN, 'utf8');
  assert.ok(
    source.indexOf('await chooseAutomationModeBeforeDetection()') < source.indexOf('const env = detectEnv()'),
    'detectEnv ran before the first automatic/manual interaction',
  );
});

test('implicit non-TTY guided init stops before detection until auto/manual is relayed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const result = spawnSync(process.execPath, [BIN, 'init'], {
    cwd: dir,
    encoding: 'utf8',
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd() },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /automation_mode|auto.*manual/i);
  assert.doesNotMatch(result.stdout, /OS=/);
  rmSync(dir, { recursive: true, force: true });
});

test('doctor replays verify checks and prints ordered result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = spawnSync(process.execPath, [BIN, 'doctor', '--non-interactive'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    automation_mode: 'auto',
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    automation_mode: 'auto',
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    automation_mode: 'auto',
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    automation_mode: 'auto',
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
  const env = { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home };
  const apply = spawnSync(process.execPath, [BIN, 'init', '--apply', '--yes', '--answers', answers], {
    cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env,
  });
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{
    matcher: 'mcp__discord__reply|mcp__discord__edit_message',
    hooks: [{ type: 'command', command: `python3 ${join(process.cwd(), 'hooks', 'automation-handoff-gate.py')}` }],
  }] } }));
  writeFileSync(join(home, '.codex', 'config.toml'), '[hooks.state."hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "sha256:test"\n');
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
    automation_mode: 'auto',
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    automation_mode: 'auto',
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
    automation_mode: 'auto',
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
    env: { ...process.env, ...TEST_CLI_ENV, THISCODEX_REPO_ROOT: process.cwd(), HOME: home },
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
