import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState, mergeAnswer, resumeSummary } from '../../scripts/lib/state.mjs';

test('fresh state skeleton', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const s = loadState(dir);
  assert.equal(s.version, 1);
  assert.deepEqual(s.completed_steps, []);
  rmSync(dir, { recursive: true, force: true });
});

test('mergeAnswer persists answer and completed step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  let s = mergeAnswer(loadState(dir), 'codex_skill_layer', 'user');
  saveState(dir, s);
  const r = loadState(dir);
  assert.equal(r.answers.codex_skill_layer, 'user');
  assert.ok(r.completed_steps.includes('codex_skill_layer'));
  rmSync(dir, { recursive: true, force: true });
});

test('resumeSummary names prior answers', () => {
  const s = mergeAnswer(loadState('/tmp'), 'tone', 'plain');
  assert.match(resumeSummary(s), /tone/);
});
