import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptForStep } from '../../scripts/lib/prompts.mjs';

test('guided prompt is concrete and not the step id', () => {
  const prompt = promptForStep({ id: 'confirm_bot_wd', reason: 'fallback' }, {
    detected: { cwd: '/repo' },
  });
  assert.match(prompt.question, /bot working directory/i);
  assert.doesNotMatch(prompt.question, /^confirm_bot_wd:/);
  assert.equal(prompt.defaultValue, '/repo');
});

test('unknown prompt falls back to reason text', () => {
  const prompt = promptForStep({ id: 'custom_step', reason: 'Explain custom step' }, { detected: {} });
  assert.equal(prompt.question, 'Explain custom step');
  assert.equal(prompt.defaultValue, '');
});
