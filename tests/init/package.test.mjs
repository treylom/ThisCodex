import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('package exposes thiscodex Node bin', () => {
  assert.equal(pkg.name, '@treylom/thiscodex');
  assert.equal(pkg.bin.thiscodex, 'bin/thiscodex.mjs');
  assert.match(pkg.engines.node, />=18/);
});

test('package ships installer, hooks, skills, rules, docs, plugin, scripts', () => {
  for (const entry of ['bin/', 'scripts/', 'hooks/', 'skills/', 'rules/', 'docs/', '.codex-plugin/', 'examples/']) {
    assert.ok(pkg.files.includes(entry), `${entry} missing from files[]`);
  }
});

test('package excludes generated Python bytecode', () => {
  assert.ok(pkg.files.includes('!**/__pycache__/**'), 'package files[] must exclude __pycache__ directories');
  assert.ok(pkg.files.includes('!**/*.py[co]'), 'package files[] must exclude Python bytecode');
});

test('package bytecode exclusions remove real tar members with a positive control', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'thiscodex-pack-bytecode-'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packMembers = files => {
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({
      name: '@treylom/thiscodex-pack-bytecode-fixture',
      version: '1.0.0',
      files,
    }));
    const result = spawnSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: fixture,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout)[0].files.map(entry => entry.path);
  };

  try {
    mkdirSync(join(fixture, 'examples', '__pycache__'), { recursive: true });
    writeFileSync(join(fixture, 'examples', 'bot.py'), 'print("positive control")\n');
    writeFileSync(join(fixture, 'examples', 'decoy.pyc'), 'bytecode-decoy\n');
    writeFileSync(join(fixture, 'examples', '__pycache__', 'bot.cpython-312.pyc'), 'cache-decoy\n');

    const withoutExclusions = packMembers(pkg.files.filter(entry => !entry.startsWith('!**/')));
    assert.ok(withoutExclusions.includes('examples/bot.py'), 'positive source member must be packed');
    assert.ok(withoutExclusions.some(path => /(?:__pycache__|\.py[co]$)/.test(path)), 'positive bytecode decoy must be observed before exclusions');

    const withExclusions = packMembers(pkg.files);
    assert.ok(withExclusions.includes('examples/bot.py'), 'positive source member must remain packed');
    assert.equal(withExclusions.filter(path => /(?:__pycache__|\.py[co]$)/.test(path)).length, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('contributors include Codex', () => {
  assert.match(JSON.stringify(pkg.contributors), /Codex/i);
});

test('test script uses node --test', () => {
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
});
