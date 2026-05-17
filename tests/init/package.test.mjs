import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('package exposes thiscodex Node bin', () => {
  assert.equal(pkg.name, '@treylom/thiscodex');
  assert.equal(pkg.bin.thiscodex, 'bin/thiscodex.mjs');
  assert.match(pkg.engines.node, />=18/);
});

test('package ships installer, skills, rules, docs, plugin, scripts', () => {
  for (const entry of ['bin/', 'scripts/', 'skills/', 'rules/', 'docs/', '.codex-plugin/', 'examples/']) {
    assert.ok(pkg.files.includes(entry), `${entry} missing from files[]`);
  }
});

test('contributors include Codex', () => {
  assert.match(JSON.stringify(pkg.contributors), /Codex/i);
});

test('test script uses node --test', () => {
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
});
