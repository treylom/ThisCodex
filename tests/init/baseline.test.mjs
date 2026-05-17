import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('tool-equivalence baseline files exist', () => {
  for (const f of [
    'examples/bot.py',
    'docs/tool-equivalence-contract.md',
    'scripts/obsidian_cli_wrapper.py',
    'scripts/codex_worker_orchestrator.py',
  ]) {
    assert.equal(existsSync(f), true, `${f} missing`);
  }
});

test('contract references both wrappers it ships with', () => {
  const c = readFileSync('docs/tool-equivalence-contract.md', 'utf8');
  assert.match(c, /obsidian_cli_wrapper\.py/);
  assert.match(c, /codex_worker_orchestrator\.py/);
});

test('python baseline files compile', () => {
  execFileSync('python3', ['-m', 'py_compile', 'examples/bot.py', 'scripts/obsidian_cli_wrapper.py', 'scripts/codex_worker_orchestrator.py'], { stdio: 'pipe' });
});
