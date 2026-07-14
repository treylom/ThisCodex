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

test('reference bridge preserves active turn after soft timeout for late completion', () => {
  assert.match(text, /asyncio\.shield\(fut\)/);
  assert.match(text, /turn exceeded soft timeout; preserving future for late completion/);
  assert.match(text, /TURN_RECONCILE_INTERVAL_SEC/);
  assert.match(text, /TURN_HARD_TIMEOUT_SEC/);
  assert.doesNotMatch(text, /except asyncio\.TimeoutError:\n\s+self\.turn_done\.pop\(turn_id, None\)\n\s+print\(f"\[CODEX-RPC\] turn timeout/);
});

test('reference bridge suppresses hard-timeout fallback after confirmed Discord reply', () => {
  assert.match(text, /ReplyAckState/);
  assert.match(text, /observe_discord_reply_item/);
  assert.match(text, /discord_reply_ack_marker/);
  assert.match(text, /interrupted_after_reply/);
  assert.match(text, /if blocked_reason and not reply_ack_marker/);
});
