import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSuperpowers } from '../../scripts/lib/superpowers.mjs';

test('detectSuperpowers reports missing plugin path with next command', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = detectSuperpowers({ HOME: home });
  assert.equal(result.present, false);
  assert.match(result.next_command, /superpowers|plugin/i);
  rmSync(home, { recursive: true, force: true });
});

test('detectSuperpowers reports present plugin path', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  mkdirSync(join(home, '.codex', 'plugins', 'cache', 'openai-curated', 'superpowers'), { recursive: true });
  const result = detectSuperpowers({ HOME: home });
  assert.equal(result.present, true);
  assert.match(result.path, /superpowers$/);
  rmSync(home, { recursive: true, force: true });
});
