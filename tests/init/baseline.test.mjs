import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('bot baseline files exist', () => {
  for (const f of [
    'examples/bot.py',
  ]) {
    assert.equal(existsSync(f), true, `${f} missing`);
  }
});

test('python baseline files compile', () => {
  execFileSync('python3', ['-m', 'py_compile', 'examples/bot.py'], { stdio: 'pipe' });
});
