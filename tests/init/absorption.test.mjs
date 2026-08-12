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
  assert.doesNotMatch(docs, new RegExp(['thiscodex', 'current', 'bot'].join('-')));
});

test('getting-started books say aliases are printed, not silently persisted', () => {
  const books = [
    readFileSync('docs/getting-started/book.typ', 'utf8'),
    readFileSync('docs/getting-started/book.en.typ', 'utf8'),
  ].join('\n');
  assert.match(books, /prints? an alias|alias.*출력/i);
  assert.match(books, /source|붙여 넣/i);
  assert.doesNotMatch(books, /writes? (it|the alias).*persist|자동.*(저장|기록)/i);
});

test('README onboarding names the runtime identity that drives tmux, BOT_NAME, and aliases', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /runtime name[\s\S]{0,200}tmux[\s\S]{0,120}BOT_NAME[\s\S]{0,120}alias|런타임 이름[\s\S]{0,200}tmux[\s\S]{0,120}BOT_NAME[\s\S]{0,120}alias/i);
  assert.match(docs, /one-word launcher|한 단어 런처/i);
});

test('docs separate placement-only from full guided onboarding', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /Skill placement.*guided onboarding|스킬 배치.*guided onboarding|스킬 배치.*가이드/i);
  assert.match(docs, /SKILL\.md.*not.*guided|SKILL\.md.*가이드.*아님|copying.*SKILL\.md.*not/i);
});

test('docs describe WSL to Windows skill sync as a first-class step', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /WSL.*Windows.*sync|Windows.*skill.*sync|WSL.*윈도우.*동기화|윈도우.*스킬.*동기화/i);
  assert.match(docs, /%USERPROFILE%.*\.agents.*skills.*thiscodex|\/mnt\/c\/Users.*\.agents.*skills.*thiscodex/i);
});

test('docs state non-interactive mode is CI or diagnostic, not guided onboarding', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /non-interactive.*CI.*diagnostic|CI.*diagnostic.*non-interactive|비대화형.*CI.*진단/i);
  assert.match(docs, /not.*guided onboarding|guided onboarding.*not|가이드.*아님/i);
});

test('docs require superpowers availability or a clear next command', () => {
  const docs = [
    readFileSync('README.md', 'utf8'),
    readFileSync('README.ko.md', 'utf8'),
    readFileSync('docs/SETUP-CONFIG-GUIDE.md', 'utf8'),
  ].join('\n');
  assert.match(docs, /superpowers.*Next command|superpowers.*next command|superpowers.*다음 명령/i);
  assert.match(docs, /\/using-superpowers/i);
});
