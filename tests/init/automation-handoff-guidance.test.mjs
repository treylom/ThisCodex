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

  const consumers = SKILL_PATHS.map(read).join('\n').replace(/\\\n\s*/g, ' ');
  const calls = [...consumers.matchAll(/thiscodex automation-gate --gate ([A-Za-z0-9_.-]+)[^\n]*/g)];
  const calledNames = new Set(calls.map(match => match[1]));
  assert.deepEqual(calledNames, new Set(policy.gates.keys()), 'policy gate lacks a real skill invocation');
  for (const [name, gate] of policy.gates) {
    const matching = calls.filter(match => match[1] === name).map(match => match[0]);
    assert.ok(matching.some(call => (
      call.includes(`--surface ${gate.surface}`)
      && call.includes(`--flow ${gate.flow}`)
      && call.includes(`--operation ${gate.operation}`)
      && call.includes(`--terminal ${gate.terminal}`)
      && call.includes(`--reason-code ${gate.reason_code}`)
    )), `${name} consumer metadata drifts from policy`);
  }
});

test('browser consumers require observed evidence, same-provider continuation, and receipt-bound output', () => {
  const bodies = SKILL_PATHS.map(read).join('\n');
  assert.doesNotMatch(bodies, /--attempted|--browser-terminal-reason|--reason\s+['"]/);
  assert.match(bodies, /current-turn|현재 턴/i);
  assert.match(bodies, /same provider|같은 provider|first observed.*provider|처음.*provider/is);
  assert.match(bodies, /receipt_marker/);
  assert.match(bodies, /thiscodex-manual-handoff/);
  const createBot = read('skills/create-bot/SKILL.md');
  const slack = read('skills/slack-bridge/SKILL.md');
  const flatBodies = bodies.replace(/\\\n\s*/g, ' ');
  assert.match(createBot, /automation-flow --start --flow browser-provider/);
  assert.match(createBot, /automation-flow --start --flow discord-portal/);
  assert.match(slack, /automation-flow --start --flow browser-provider/);
  assert.match(slack, /automation-flow --start --flow slack-auth/);
  for (const gate of ['browser_provider_ready', 'discord_portal_complete', 'slack_browser_auth_complete']) {
    assert.match(flatBodies, new RegExp(`automation-gate --gate ${gate}[^\\n]*--status succeeded`));
  }
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
