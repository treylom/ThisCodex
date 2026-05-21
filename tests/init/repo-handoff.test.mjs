// Spec 2026-05-18-repo-handoff-interactive-default: regression locks for the
// transcript-proven defects (A7 entry-doc first command, A2 safe-stop next_command,
// A1 SKILL.md agent instruction). RED before the fix, GREEN after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readmeMd = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const readmeKo = readFileSync(new URL('../../README.ko.md', import.meta.url), 'utf8');
const skill = readFileSync(new URL('../../skills/thiscodex/SKILL.md', import.meta.url), 'utf8');
const installJson = JSON.parse(
  readFileSync(new URL('../../install/thiscodex.install.json', import.meta.url), 'utf8'),
);

// First command line that invokes `init` inside any fenced code block.
function firstInitCommand(md) {
  const blocks = md.split('```');
  for (let i = 1; i < blocks.length; i += 2) {
    const cmd = blocks[i]
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .find((l) => /\binit\b/.test(l));
    if (cmd) return cmd;
  }
  return '';
}

for (const [name, md] of [
  ['README.md', readmeMd],
  ['README.ko.md', readmeKo],
]) {
  // A7 (spec §6 test 9): the first recommended install command is interactive guided.
  test(`A7: ${name} first init command is guided (no --non-interactive/--check/--yes/--answers)`, () => {
    const first = firstInitCommand(md);
    assert.ok(first, `${name}: no fenced \`init\` command found`);
    assert.doesNotMatch(
      first,
      /--non-interactive|--check|--yes|--answers/,
      `${name}: first init command must be guided, got: ${first}`,
    );
  });

  // A7: non-interactive flags documented only under an explicit CI/automation section.
  test(`A7: ${name} introduces --non-interactive only after a CI/automation heading`, () => {
    const idx = md.indexOf('--non-interactive');
    if (idx === -1) return;
    const before = md.slice(0, idx);
    assert.match(
      before,
      /CI|automation|자동화|diagnostic|진단|non-interactive.*mode/i,
      `${name}: --non-interactive appears before any CI/automation framing`,
    );
  });
}

// A2 (spec §6 test 8): safe-stop next_command must not be the answers-only escape.
test('A2: choose_install_surface next_command offers interactive recovery, not only --answers', () => {
  const step = (installJson.steps || []).find((s) => s.id === 'choose_install_surface');
  assert.ok(step, 'choose_install_surface step missing');
  const nc = step.on_fail?.next_command ?? '';
  const isAnswersOnlyEscape =
    /--answers <answers\.json>/.test(nc) &&
    !/non-interactive|interactive|guided|대화형|abort|중단|recover/i.test(nc);
  assert.ok(
    !isAnswersOnlyEscape,
    `safe-stop next_command must present interactive recovery, not only the --answers escape: "${nc}"`,
  );
});

// A1: SKILL.md instructs guided run + question relay + forbids "copied = installed".
test('A1: SKILL.md instructs guided init, question relay, and forbids placement-as-done', () => {
  assert.match(skill, /\binit\b/, 'SKILL.md must reference init');
  assert.match(
    skill,
    /relay|중계|ask the user|사용자에게 (묻|질문)/i,
    'SKILL.md must instruct relaying questions to the user',
  );
  assert.match(
    skill,
    /not .*(report|claim).*(install|onboard)|복사.*설치.*아님|placement is not (guided|onboarding)/i,
    'SKILL.md must forbid reporting copied = installed',
  );
});

// A8 (spec §6 test 10): plugin path honestly labeled incomplete on codex 0.130,
// never presented before the init / loose-skill entry. code-review-bot raw verify 2026-05-18.
test('A8: SKILL.md plugin mention carries the incomplete / future-packaging caveat', () => {
  assert.match(
    skill,
    /codex plugin marketplace|\.codex-plugin/i,
    'SKILL.md should still mention the plugin path (so it can be honestly caveated)',
  );
  assert.match(
    skill,
    /incomplete|미완|not (a )?usable|future .*marketplace packaging|\.agents\/plugins\/marketplace\.json|does not contain a supported manifest/i,
    'plugin mention must state it is incomplete on codex 0.130 (A8)',
  );
});

test('A8: plugin path is not presented before the init / loose-skill entry step', () => {
  const entryIdx = skill.search(/##\s*Install — read this|thiscodex init/i);
  const pluginIdx = skill.search(/codex plugin marketplace add/i);
  assert.ok(entryIdx !== -1, 'SKILL.md must have the init entry section');
  assert.ok(
    pluginIdx === -1 || pluginIdx > entryIdx,
    'plugin marketplace mention must come after the init/loose-skill entry, not before (A8)',
  );
});

// J-2 cross-ref (spec §10): ThisCodex reuses the same external discord plugin,
// so the bot-drop issue + recipe pointer must be carried here too. Regression
// lock — porting-infra §2 each-repo-self-tests, no cross-repo fs coupling.
test('J-2: ThisCodex SKILL.md cross-refs the shared discord server.ts bot-drop', () => {
  assert.match(
    skill,
    /msg\.author\.bot/,
    'must name the exact gate so it is greppable in ThisCodex too',
  );
  assert.match(skill, /server\.ts/, 'must point at the external discord plugin server.ts');
  assert.match(
    skill,
    /08-debug-노하우\.md|J-2/,
    'must point at the canonical recipe (ThisCode docs/08-debug-노하우.md J-2)',
  );
  assert.match(
    skill,
    /external|not\*?\*? ThisCodex|overwritten on plugin update|marketplaces\//i,
    'must state root cause is the external plugin (re-apply note)',
  );
});
