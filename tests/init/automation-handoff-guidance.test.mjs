import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAutomationPolicy } from '../../scripts/lib/automation-policy.mjs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const SKILL_PATHS = [
  'skills/create-bot/SKILL.md', 'skills/help/SKILL.md',
  'skills/setup/SKILL.md', 'skills/slack-bridge/SKILL.md',
  'skills/thiscodex/SKILL.md',
];

test('every installer-facing skill routes manual handoff through the code gate', () => {
  assert.equal(SKILL_PATHS.length, 5);
  for (const path of SKILL_PATHS) {
    const body = read(path);
    assert.match(body, /thiscodex automation-gate/, `${path} bypasses the code gate`);
  }
});

test('shipped gate inventory and YAML policy are bidirectionally exhaustive', () => {
  const policy = loadAutomationPolicy();
  const setup = read('skills/setup/SKILL.md');
  const markers = [...setup.matchAll(/thiscodex-handoff-gate:([A-Za-z0-9_.-]+)/g)].map(match => match[1]);
  assert.deepEqual(new Set(markers), new Set(policy.gates.keys()));
  assert.equal(markers.length, policy.gates.size, 'duplicate or missing handoff marker');
  for (const name of markers) assert.ok(policy.gates.has(name), `source-only gate: ${name}`);
});

test('browser consumers require observed evidence, same-provider continuation, and receipt-bound output', () => {
  const bodies = SKILL_PATHS.map(read).join('\n');
  assert.doesNotMatch(bodies, /--attempted|--browser-terminal-reason|--reason\s+['"]/);
  assert.match(bodies, /current-turn|현재 턴/i);
  assert.match(bodies, /same provider|같은 provider|first observed.*provider|처음.*provider/is);
  assert.match(bodies, /receipt_marker/);
  assert.match(bodies, /thiscodex-manual-handoff/);
});

test('runtime bridge observes MCP completions and fallback cannot bypass the receipt gate', () => {
  const bridge = read('examples/bot.py');
  assert.match(bridge, /item\/completed/);
  assert.match(bridge, /observe_automation_item/);
  assert.match(bridge, /automation_fallback_handoff_allowed/);
  assert.match(bridge, /blocked manual handoff without current-turn receipt/);
  assert.doesNotMatch(
    bridge.slice(bridge.indexOf('def observe_automation_item'), bridge.indexOf('def _extract_discord_message_ids')),
    /"arguments"\s*:|"result"\s*:|"url"\s*:/,
  );
});

test('Slack guide delegates Discord portal creation to create-bot instead of shipping a raw manual bypass', () => {
  const slack = read('skills/slack-bridge/SKILL.md');
  assert.match(slack, /Discord.*\/create-bot/is);
  assert.doesNotMatch(slack, /New Application[^\n]{0,120}토큰 발급 \(수동/);
});
