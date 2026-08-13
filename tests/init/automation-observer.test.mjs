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

test('bridge classifier keeps only provider/tool/status/error class from MCP completion', () => {
  const output = classify({
    type: 'mcpToolCall', id: 'item-1', server: 'playwright', tool: 'browser_navigate',
    status: 'failed', arguments: { url: 'https://secret.example/token' },
    result: { text: 'credential-value' }, error: { message: 'secret raw failure' },
  });
  assert.deepEqual(JSON.parse(output), {
    provider: 'playwright', tool: 'browser_navigate', status: 'failed', error_class: 'mcp_error',
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
    status: 'failed', error_class: 'tool_error',
  });
  assert.doesNotMatch(clipboard, /super-secret|pbcopy|output/);
});
