import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const HOOKS = [
  'hooks/lib/hookkit.sh',
  'hooks/reply-gate.sh',
  'hooks/completion-gate.sh',
  'hooks/dispatch-verify.sh',
  'hooks/kst-timestamp.sh',
  'hooks/automation-no-interactive.sh',
  'hooks/automation-handoff-gate.py',
  'hooks/verify-before-push.sh',
  'hooks/meeting-liveness.py',
  'hooks/tests/run-hook-tests.sh',
];

function runHook(hook, input, env = {}) {
  return spawnSync('bash', [hook], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
  });
}

function runPythonHook(hook, input, env = {}) {
  return spawnSync('python3', [hook], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
  });
}

function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-hook-'));
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, lines.map(v => JSON.stringify(v)).join('\n') + '\n');
  return { dir, file };
}

test('package ships hard hook files', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.files.includes('hooks/'), 'hooks/ missing from package files');
  for (const path of HOOKS) {
    assert.ok(existsSync(path), `${path} missing`);
  }
});

test('Stop reply gate emits Codex-compatible decision:block JSON', () => {
  const { dir, file } = writeTranscript([
    { type: 'user', message: { role: 'user', content: '<channel source="discord" chat_id="T">ping</channel>' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'terminal only' }] } },
  ]);
  const res = runHook('hooks/reply-gate.sh', { transcript_path: file, stop_hook_active: false });
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.decision, 'block');
  assert.ok(!('hookSpecificOutput' in payload), 'Stop hooks must not emit hookSpecificOutput');
  rmSync(dir, { recursive: true, force: true });
});

test('PreToolUse automation guard denies with permissionDecision JSON', () => {
  const res = runHook(
    'hooks/automation-no-interactive.sh',
    { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} },
    { HK_AUTOMATION: '1' },
  );
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(payload.hookSpecificOutput.permissionDecisionReason, /AskUserQuestion|무인 자동화/);
});

test('packaged Python hook decisions stay ASCII JSON on strict console encodings', () => {
  const env = {
    PYTHONIOENCODING: 'ascii:strict',
    FABLE_GATE_OFF: '0',
    FABLE_GATE_PILOT: '',
    FABLE_SESSION_NAME: '',
  };

  const continuationDir = mkdtempSync(join(tmpdir(), 'tcx-continuation-'));
  const continuationTranscript = join(continuationDir, 'transcript.jsonl');
  writeFileSync(continuationTranscript, `${JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: "I'll finish this tomorrow" }] },
  })}\n`);
  const continuation = runPythonHook('hooks/tofable/continuation-gate.py', {
    session_id: 'strict-console-continuation',
    cwd: '/workspace/example-project',
    transcript_path: continuationTranscript,
    stop_hook_active: false,
  }, { ...env, FABLE_STATE_DIR: continuationDir });
  assert.equal(continuation.status, 0, continuation.stderr);
  assert.doesNotMatch(continuation.stdout, /[^\x00-\x7F\r\n]/u);
  assert.equal(JSON.parse(continuation.stdout).decision, 'block');
  rmSync(continuationDir, { recursive: true, force: true });

  const verificationDir = mkdtempSync(join(tmpdir(), 'tcx-verification-'));
  const session = { session_id: 'strict-console-verification', cwd: '/workspace/example-project' };
  const ledger = runPythonHook('hooks/tofable/verify-ledger.py', {
    ...session,
    tool_name: 'Edit',
    tool_input: { file_path: '/workspace/example-project/code.py' },
  }, { ...env, FABLE_STATE_DIR: verificationDir });
  assert.equal(ledger.status, 0, ledger.stderr);
  const verification = runPythonHook('hooks/tofable/stop-verify-gate.py', session, {
    ...env, FABLE_STATE_DIR: verificationDir,
  });
  assert.equal(verification.status, 0, verification.stderr);
  assert.doesNotMatch(verification.stdout, /[^\x00-\x7F\r\n]/u);
  assert.equal(JSON.parse(verification.stdout).decision, 'block');
  rmSync(verificationDir, { recursive: true, force: true });

  const dispatchDir = mkdtempSync(join(tmpdir(), 'tcx-dispatch-console-'));
  const workspace = join(dispatchDir, 'workspace');
  const roster = join(dispatchDir, 'bot-roster.yaml');
  mkdirSync(workspace);
  writeFileSync(roster, 'bots:\n  konan:\n    user_id: "222222222222222222"\n');
  writeFileSync(join(dispatchDir, 'dispatch-gate.json'), JSON.stringify({
    top_channels: ['111111111111111111'],
    roster_path: roster,
    workspace_roots: [workspace],
  }));
  const dispatch = runPythonHook('hooks/dispatch-room-gate.py', {
    cwd: workspace,
    tool_name: 'mcp__discord__reply',
    tool_input: {
      chat_id: '111111111111111111',
      text: '<@222222222222222222> 작업 착수',
    },
  }, { ...env, MEETING_WATCHDOG_STATE_DIR: dispatchDir });
  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.doesNotMatch(dispatch.stdout, /[^\x00-\x7F\r\n]/u);
  assert.equal(JSON.parse(dispatch.stdout).hookSpecificOutput.permissionDecision, 'deny');
  rmSync(dispatchDir, { recursive: true, force: true });
});

test('all packaged Python hooks avoid raw-Unicode json.dumps on stdout', () => {
  const scanner = String.raw`
import ast
from pathlib import Path

violations = []
for path in Path("hooks").rglob("*.py"):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Name) or node.func.id != "print" or not node.args:
            continue
        dumped = node.args[0]
        if not isinstance(dumped, ast.Call) or not isinstance(dumped.func, ast.Attribute):
            continue
        if not isinstance(dumped.func.value, ast.Name) or dumped.func.value.id != "json" or dumped.func.attr != "dumps":
            continue
        for keyword in dumped.keywords:
            if keyword.arg == "ensure_ascii" and isinstance(keyword.value, ast.Constant) and keyword.value.value is False:
                violations.append(f"{path}:{node.lineno}")
if violations:
    raise SystemExit("raw-Unicode stdout JSON: " + ", ".join(violations))
`;
  const result = spawnSync('python3', ['-c', scanner], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('automatic handoff hook flow state denies unmarked prose and atomically consumes a receipt once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-handoff-'));
  const input = {
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__discord__reply',
    tool_input: { text: '<!-- thiscodex-manual-handoff --> 직접 로그인해 주세요.' },
  };
  const run = value => spawnSync('python3', ['hooks/automation-handoff-gate.py'], {
    cwd: process.cwd(), encoding: 'utf8', input: JSON.stringify(value),
    env: { ...process.env, THISCODEX_AUTOMATION_EVIDENCE_DIR: dir, THISCODEX_AUTOMATION_MODE: 'auto' },
  });
  const denied = run(input);
  assert.doesNotMatch(denied.stdout, /[^\x00-\x7F\r\n]/u,
    'hook JSON must remain writable on Windows code pages');
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  for (const text of [
    'Please enter your GitHub login credentials to continue.',
    'GitHub 계정으로 로그인해 주세요.',
  ]) {
    const natural = run({ ...input, tool_input: { text } });
    assert.equal(JSON.parse(natural.stdout).hookSpecificOutput.permissionDecision, 'deny');
  }

  const token = 'a'.repeat(48);
  writeFileSync(join(dir, 'active-turn.json'), JSON.stringify({
    thread_id: 'thread-1', turn_id: 'turn-1', started_at: new Date().toISOString(),
  }));
  writeFileSync(join(dir, 'active-flow.json'), JSON.stringify({
    thread_id: 'thread-1', flow: 'discord-portal', provider: 'playwright',
    started_at: new Date().toISOString(),
  }));
  const unmarked = run({
    ...input, tool_input: { text: 'Please sign in to Discord in the current browser window, then tell me when finished.' },
  });
  assert.equal(JSON.parse(unmarked.stdout).hookSpecificOutput.permissionDecision, 'deny');
  writeFileSync(join(dir, 'handoff-receipts.jsonl'), `${JSON.stringify({
    schema_version: 1, token, thread_id: 'thread-1', turn_id: 'turn-1',
    gate: 'discord_hcaptcha', flow: 'discord-portal', provider: 'playwright',
    resume_required: true,
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(),
  })}\n`);
  const withReceipt = {
    ...input,
    tool_input: { text: `${input.tool_input.text}\n<!-- thiscodex-automation-receipt:${token} -->` },
  };
  assert.equal(JSON.parse(run(withReceipt).stdout).hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(JSON.parse(run(withReceipt).stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(JSON.parse(readFileSync(join(dir, 'active-flow.json'), 'utf8')).provider, 'playwright');
  const afterPause = run({
    ...input, tool_input: { text: 'Please sign in to Discord, then tell me when finished.' },
  });
  assert.equal(JSON.parse(afterPause.stdout).hookSpecificOutput.permissionDecision, 'deny');

  const parallelToken = 'b'.repeat(48);
  writeFileSync(join(dir, 'active-flow.json'), JSON.stringify({
    thread_id: 'thread-1', flow: 'discord-portal', provider: 'playwright',
    started_at: new Date().toISOString(),
  }));
  writeFileSync(join(dir, 'handoff-receipts.jsonl'), `${JSON.stringify({
    schema_version: 1, token: parallelToken, thread_id: 'thread-1', turn_id: 'turn-1',
    gate: 'discord_hcaptcha', flow: 'discord-portal', provider: 'playwright',
    resume_required: true,
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(),
  })}\n`, { flag: 'a' });
  const parallelInput = JSON.stringify({
    ...input,
    tool_input: { text: `Please sign in to Discord. <!-- thiscodex-automation-receipt:${parallelToken} -->` },
  });
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn('python3', ['hooks/automation-handoff-gate.py'], {
      cwd: process.cwd(),
      env: { ...process.env, THISCODEX_AUTOMATION_EVIDENCE_DIR: dir, THISCODEX_AUTOMATION_MODE: 'auto' },
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve(JSON.parse(stdout).hookSpecificOutput.permissionDecision));
    child.stdin.end(parallelInput);
  });
  const decisions = await Promise.all([invoke(), invoke()]);
  assert.deepEqual(decisions.sort(), ['allow', 'deny']);

  writeFileSync(join(dir, 'active-flow.json'), JSON.stringify({
    thread_id: 'thread-1', flow: 'discord-portal', provider: 'playwright',
    started_at: new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString(),
  }));
  const staleFlow = run({
    ...input, tool_input: { text: 'Ordinary automatic progress update.' },
  });
  assert.equal(JSON.parse(staleFlow.stdout).hookSpecificOutput.permissionDecision, 'allow');
  rmSync(dir, { recursive: true, force: true });
});

test('verify-before-push denies git push when enforce is on and no verify command exists', () => {
  const { dir, file } = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }] } },
  ]);
  const res = runHook(
    'hooks/verify-before-push.sh',
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: file },
    { A1_ENFORCE: '1', DISCORD_STATE_DIR: '/tmp/discord-konan' },
  );
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  rmSync(dir, { recursive: true, force: true });
});

test('meeting-liveness dry-run detects stale participants without sending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-live-'));
  const progress = join(dir, '02-progress.md');
  writeFileSync(progress, '# progress\n[00:00 KST] konan | 시작 | old\n');
  const res = spawnSync('python3', [
    'hooks/meeting-liveness.py',
    '--progress', progress,
    '--thread-id', '123456789012345678',
    '--participants', 'konan:222222222222222222',
    '--threshold', '1',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /DRY-RUN/);
  assert.match(res.stdout, /konan/);
  rmSync(dir, { recursive: true, force: true });
});
