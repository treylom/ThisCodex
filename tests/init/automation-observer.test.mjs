import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function classify(item) {
  const program = [
    'import json,sys',
    'from automation_observer import classify_automation_item',
    'item=json.load(sys.stdin)',
    'print(json.dumps(classify_automation_item(item, {"playwright","claude-in-chrome"})))',
  ].join(';');
  const result = spawnSync('python3', ['-c', program], {
    cwd: process.cwd(), encoding: 'utf8', input: JSON.stringify(item),
    env: { ...process.env, PYTHONPATH: 'examples' },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function route(record, boundProvider, expectedToolClass) {
  const program = [
    'import json,sys',
    'from automation_observer import route_automation_record',
    'record,bound,expected=json.load(sys.stdin)',
    'print(json.dumps(route_automation_record(record,bound,expected)))',
  ].join(';');
  const result = spawnSync('python3', ['-c', program], {
    cwd: process.cwd(), encoding: 'utf8',
    input: JSON.stringify([record, boundProvider, expectedToolClass]),
    env: { ...process.env, PYTHONPATH: 'examples' },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('bridge classifier keeps only provider/tool/status/error class from MCP completion', () => {
  const output = classify({
    type: 'mcpToolCall', id: 'item-1', server: 'playwright', tool: 'browser_navigate',
    status: 'failed', arguments: { url: 'https://secret.example/token' },
    result: { text: 'credential-value' }, error: { message: 'secret raw failure' },
  });
  assert.deepEqual(JSON.parse(output), {
    provider: 'playwright', tool: 'browser_navigate', tool_class: 'browser_action',
    status: 'failed', error_class: 'mcp_error',
  });
  assert.doesNotMatch(output, /secret|credential|https?:|arguments|result/i);
});

test('bridge classifier ignores unrelated commands and records clipboard/provider setup envelopes only', () => {
  assert.equal(classify({ type: 'commandExecution', command: 'curl https://example.com', exitCode: 1 }), 'null');
  const clipboard = classify({
    type: 'commandExecution', command: "printf 'super-secret' | pbcopy", exitCode: 1,
    output: 'super-secret',
  });
  assert.deepEqual(JSON.parse(clipboard), {
    provider: 'model-blind-clipboard', tool: 'clipboard-receipt-command',
    tool_class: 'clipboard',
    status: 'failed', error_class: 'tool_error',
  });
  assert.doesNotMatch(clipboard, /super-secret|pbcopy|output/);
  assert.equal(classify({ type: 'commandExecution', command: 'codex mcp list playwright', exitCode: 1 }), 'null');
  assert.equal(classify({
    type: 'mcpToolCall', id: 'item-close', server: 'playwright', tool: 'browser_close',
    status: 'completed',
  }).includes('"tool_class": "browser_other"'), true);
});

test('the first browser completion binds provider even when its tool class cannot satisfy the attempt', () => {
  const navigate = { provider: 'claude-in-chrome', tool_class: 'browser_action' };
  const first = route(navigate, '', 'browser_inspect');
  assert.deepEqual(first, {
    provider_allowed: true, next_provider: 'claude-in-chrome', evidence_eligible: false,
  });
  const laterSnapshot = route(
    { provider: 'playwright', tool_class: 'browser_inspect' },
    first.next_provider,
    'browser_inspect',
  );
  assert.deepEqual(laterSnapshot, {
    provider_allowed: false, next_provider: 'claude-in-chrome', evidence_eligible: false,
  });
  const alreadyBoundAlternateAction = route(
    { provider: 'claude-in-chrome', tool_class: 'browser_action' },
    'playwright',
    'browser_inspect',
  );
  assert.equal(alreadyBoundAlternateAction.provider_allowed, false);
  const clipboard = route(
    { provider: 'model-blind-clipboard', tool_class: 'clipboard' },
    'playwright',
    'clipboard',
  );
  assert.deepEqual(clipboard, {
    provider_allowed: true, next_provider: 'playwright', evidence_eligible: true,
  });
});
