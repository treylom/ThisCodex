import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('ThisCodex does not ship a separate sync-skills-to-codex shell path', () => {
  assert.equal(existsSync('scripts/sync-skills-to-codex.sh'), false);
});

test('docs point Codex skill placement to Node installer, not shell sync', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /node bin\/thiscodex\.mjs --apply|npx github:treylom\/ThisCodex/);
  assert.doesNotMatch(docs, /sync-skills-to-codex\.sh/);
});

test('launch.sh is documented as fallback, not primary installer', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /legacy|fallback|보조|대체/i);
  assert.match(docs, /THISCODEX_SHELL|Node runner|node runner/i);
});
