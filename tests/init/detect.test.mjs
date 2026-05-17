import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOS, whichSync, detectCodexAuth, detectCodexConfig, detectPluginCapability } from '../../scripts/lib/detect.mjs';

test('detectOS returns supported bucket', () => {
  assert.ok(['mac', 'linux', 'wsl', 'win'].includes(detectOS()));
});

test('whichSync finds node and returns null for unknown', () => {
  assert.ok(whichSync('node'));
  assert.equal(whichSync('definitely-not-a-binary-xyz'), null);
});

test('detectCodexAuth checks auth.json under CODEX_HOME or ~/.codex', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  mkdirSync(join(home, '.codex'), { recursive: true });
  assert.equal(detectCodexAuth({ HOME: home }).present, false);
  writeFileSync(join(home, '.codex', 'auth.json'), '{}');
  assert.equal(detectCodexAuth({ HOME: home }).present, true);
  rmSync(home, { recursive: true, force: true });
});

test('detectCodexConfig reports config path and presence', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  mkdirSync(join(home, '.codex'), { recursive: true });
  const c = detectCodexConfig({ HOME: home });
  assert.match(c.path, /\.codex\/config\.toml$/);
  assert.equal(c.present, false);
  rmSync(home, { recursive: true, force: true });
});

test('detectPluginCapability parses help text for marketplace only', () => {
  const cap = detectPluginCapability('Usage: codex plugin marketplace add\n');
  assert.equal(cap.marketplace, true);
  assert.equal(cap.install, false);
});
