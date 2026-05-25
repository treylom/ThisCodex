import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOKS = [
  'hooks/lib/hookkit.sh',
  'hooks/reply-gate.sh',
  'hooks/completion-gate.sh',
  'hooks/dispatch-verify.sh',
  'hooks/kst-timestamp.sh',
  'hooks/automation-no-interactive.sh',
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
