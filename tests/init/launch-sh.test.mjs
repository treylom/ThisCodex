import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const text = readFileSync('scripts/launch.sh', 'utf8');

test('launch.sh never contains bare codex --remote fallback', () => {
  assert.doesNotMatch(text, /codex --remote/);
  assert.match(text, /codex resume/);
});

test('launch.sh re-reads TID while waiting for rollout', () => {
  assert.match(text, /waiting rollout/);
  assert.match(text, /TID=\$\(cat '\$TID_FILE'\)|cat '\$TID_FILE'/);
});

test('launch.sh has rollout timeout recovery text', () => {
  assert.match(text, /rollout timeout|timeout.*rollout|recovery command/i);
});

test('launch.sh syntax is valid bash', () => {
  execFileSync('bash', ['-n', 'scripts/launch.sh']);
});
