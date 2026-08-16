import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('rules/INDEX.md', 'utf8');
const orchestration = readFileSync('rules/orchestration.md', 'utf8');

test('INDEX routes delegation, Workflow, and bot-document research to orchestration §11', () => {
  const row = index.split('\n').find(line => line.includes('[orchestration.md](orchestration.md)')) || '';
  assert.match(row, /delegat|위임|Delegating/i);
  assert.match(row, /Workflow/);
  assert.match(row, /bot-document research|repository research/i);
  assert.match(row, /R1–R5/);
});

test('orchestration §11 exposes all five delegation defaults', () => {
  assert.match(orchestration, /^## 11\. Delegation and parallel-work defaults \(R1–R5\)$/m);
  for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5']) {
    assert.match(orchestration, new RegExp(`\\*\\*${rule} —`));
  }
});
