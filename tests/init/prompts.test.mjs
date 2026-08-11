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

test('confirm_wiki_path prompt names the wiki (Obsidian vault) connection as optional', () => {
  const prompt = promptForStep({ id: 'confirm_wiki_path', reason: 'fallback' }, { answers: {} });
  assert.match(prompt.question, /wiki|vault/i);
  assert.match(prompt.question, /optional/i);
  assert.doesNotMatch(prompt.question, /^confirm_wiki_path:/);
  assert.equal(prompt.defaultValue, '');
});

test('confirm_wiki_path prompt resumes a previously answered wiki path as its default', () => {
  const prompt = promptForStep({ id: 'confirm_wiki_path', reason: 'fallback' }, { answers: { wiki_path: '/Users/x/vault' } });
  assert.equal(prompt.defaultValue, '/Users/x/vault');
});

test('bot launch aliases are a default-yes recommendation skipped only by explicit no', () => {
  const step = {
    id: 'ask_alias_consent',
    reason: 'fallback',
    verify: { type: 'answer-one-of', choices: 'yes,no' },
  };
  const prompt = promptForStep(step, { detected: { alias_consent: 'yes' } });
  assert.equal(prompt.defaultValue, 'yes');
  assert.match(prompt.question, /recommend|recommended/i);
  assert.match(prompt.question, /explicit.*no|no.*skip/i);
  assert.match(prompt.question, /restart|previous.*session/i);
});
