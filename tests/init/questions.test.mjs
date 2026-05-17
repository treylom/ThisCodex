import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRIPT, isInScope, nextQuestion } from '../../scripts/lib/questions.mjs';

test('SCRIPT includes ThisCodex-specific Q3c-f and Q6c-e', () => {
  const ids = SCRIPT.map(q => q.id);
  for (const id of ['codex_auth', 'codex_skill_layer', 'codex_marketplace', 'codex_config', 'codex_runner', 'codex_launch_compat', 'codex_yolo']) {
    assert.ok(ids.includes(id), `${id} missing`);
  }
});

test('Codex-specific Q3c-f active only when harness includes codex', () => {
  const q = SCRIPT.find(q => q.id === 'codex_skill_layer');
  assert.equal(isInScope(q, { os: 'mac', answers: { harness: 'claude' } }), false);
  assert.equal(isInScope(q, { os: 'mac', answers: { harness: 'codex' } }), true);
  assert.equal(isInScope(q, { os: 'mac', answers: { harness: 'both' } }), true);
});

test('Q6c-e active only when daemon guide is yes and harness includes codex', () => {
  const q = SCRIPT.find(q => q.id === 'codex_launch_compat');
  assert.equal(isInScope(q, { os: 'mac', answers: { harness: 'codex', daemon_guide: 'no' } }), false);
  assert.equal(isInScope(q, { os: 'mac', answers: { harness: 'codex', daemon_guide: 'yes' } }), true);
});

test('nextQuestion skips completed and out-of-scope', () => {
  const q = nextQuestion({ os: 'mac', answers: { tone: 'plain' } }, ['tone']);
  assert.equal(q.id, 'os_confirm');
});
