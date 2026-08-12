import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('setup skill is generated through prompt-skill discipline', () => {
  const text = readFileSync('skills/setup/SKILL.md', 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /^---\nname: setup\n/m);
  assert.match(text, /\/prompt --batch GPT-5\.6 상세/);
  assert.match(text, /thiscodex setup|thiscodex init/i);
  assert.match(text, /progress_report_cadence/);
  assert.match(text, /tmux/i);
  assert.match(text, /Do not use cmux/i);
  assert.match(text, /source/i);
});

test('setup skill turns the operator address into an exact non-negotiating persona contract', () => {
  const text = readFileSync('skills/setup/SKILL.md', 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /exact operator address/i);
  assert.match(text, /always\s+address\s+the operator/i);
  assert.match(text, /do not reconfirm|never reconfirm/i);
  assert.match(text, /너는 나를 뭐라고 불러야 해/);
  assert.match(text, /without.*follow-up question/i);
});

test('setup completion contract records the fixed operator address', () => {
  const text = readFileSync('skills/setup/SKILL.md', 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /operator_address:\s*<exact address>/);
});

test('setup hands off optional Slack onboarding instead of leaving it undiscoverable', () => {
  const text = readFileSync('skills/setup/SKILL.md', 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /Slack/i);
  assert.match(text, /\/slack-bridge/);
  assert.match(text, /optional|non-blocking/i);
  assert.match(text, /slack_bridge:\s*configured \| deferred\(<reason>\)/);
});
