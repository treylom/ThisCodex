import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync('examples/bot.py', 'utf8');

test('reference bridge materializes rollout before writing .codex-thread-id', () => {
  const materializeCall = text.indexOf('await self.materialize_thread_for_tui(tid)');
  const threadIdWrite = text.indexOf('THREAD_ID_PATH.write_text(tid)');

  assert.notEqual(materializeCall, -1);
  assert.notEqual(threadIdWrite, -1);
  assert.ok(materializeCall < threadIdWrite);
});

test('reference bridge materializes via thread/inject_items marker', () => {
  assert.match(text, /async def materialize_thread_for_tui/);
  assert.match(text, /thread\/inject_items/);
  assert.match(text, /rollout materialized for local TUI attach/);
});
