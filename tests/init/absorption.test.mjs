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

test('docs describe manifest runner, doctor verify replay, and WSL-first safety line', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /manifest|매니페스트/i);
  assert.match(docs, /doctor.*verify|verify.*doctor|진단.*검증/i);
  assert.match(docs, /WSL/i);
  assert.match(docs, /tmux.*one|tmux.*한 줄|한 줄.*tmux/i);
});

test('docs warn that aliases are generated only after confirmed paths', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /confirmed.*BOT_WD|확정.*BOT_WD/i);
  assert.doesNotMatch(docs, /thiscodex-current-bot/);
});
