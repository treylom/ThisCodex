import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = process.cwd();

function runFeatureTest(args = []) {
  return spawnSync(process.execPath, ['scripts/feature-test.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('feature-test default run excludes the expensive graphrag benchmark', () => {
  const result = runFeatureTest();

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}\n${result.stderr}`;
  for (const id of ['memory', 'tmux', 'graphrag', 'meeting', 'rules', 'hooks', 'install']) {
    assert.match(output, new RegExp(`\\b${id}\\b`));
  }
  assert.doesNotMatch(output, /\bgraphrag-bench\b/);
  assert.match(output, /Summary:/);
});

test('feature-test dispatches a single fuzzy feature query', () => {
  const result = runFeatureTest(['check', 'tmux', 'setup']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /\btmux\b/);
  assert.doesNotMatch(output, /\bmemory\b/);
  assert.match(output, /Summary:/);
});

test('feature-test bench mode includes graphrag-bench', () => {
  const result = runFeatureTest(['--bench']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /\bgraphrag-bench\b/);
  assert.match(output, /Summary:/);
});

test('/test skill entrypoint points at the feature-test harness', () => {
  const skillPath = join(repoRoot, 'skills', 'test', 'SKILL.md');

  assert.equal(existsSync(skillPath), true);
  const body = readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
  assert.match(body, /^name:\s*test$/m);
  assert.match(body, /\/test/);
  assert.match(body, /node scripts\/feature-test\.mjs/);
});
