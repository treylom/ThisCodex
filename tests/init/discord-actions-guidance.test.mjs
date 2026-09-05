import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const consumers = {
  readme: read('README.md'),
  readmeKo: read('README.ko.md'),
  help: read('skills/help/SKILL.md'),
  features: read('skills/thiscodex/SKILL.md'),
  agents: read('examples/AGENTS.md'),
};

test('Discord reaction and thread-history guidance names the callable tools', () => {
  assert.equal(Object.keys(consumers).length, 5, 'consumer inventory must stay explicit');
  for (const [name, body] of Object.entries(consumers)) {
    assert.match(body, /mcp__discord__react/, `${name}: react guidance missing`);
    assert.match(body, /mcp__discord__fetch_messages/, `${name}: thread-history guidance missing`);
  }

  assert.match(consumers.help, /channel=<thread_id>/);
  assert.match(consumers.help, /최대 100건/);
  assert.match(consumers.agents, /parent channel must\s+be allowlisted/i);
});

test('five guidance consumers distinguish the ThisCodex thread CLI from the official MCP', () => {
  for (const [name, body] of Object.entries(consumers)) {
    assert.match(body, /reply_to/iu, `${name}: reply_to boundary missing`);
    assert.match(body, /thiscodex discord-thread/iu, `${name}: thread CLI guidance missing`);
    assert.match(body, /공개 스레드/u, `${name}: official Korean public-thread term missing`);
    assert.match(body, /비공개 스레드/u, `${name}: official Korean private-thread term missing`);
    assert.match(body, /official Discord MCP|공식 Discord MCP/iu, `${name}: MCP boundary missing`);
    assert.match(body, /operator-declared|운영자 선언/iu, `${name}: channel-type declaration boundary missing`);
    assert.match(body, /channel\s+object(?:'s)?.*type|채널\s+객체.*type/isu, `${name}: channel-type verification missing`);
    assert.match(body, /Discord(?: decides|가 판정)/iu, `${name}: mismatch authority missing`);
    assert.match(body, /invitable.*false/iu, `${name}: closed private-thread default missing`);
    assert.match(body, /--invitable true/iu, `${name}: explicit member-invite opt-in missing`);
  }

  const rulesSeed = read('examples/rules-seed.md');
  assert.match(rulesSeed, /rules-seed v1\.1\.2/);
  assert.match(rulesSeed, /thiscodex discord-thread/);
  assert.match(rulesSeed, /reply_to.*does not create a Discord thread/is);
  assert.doesNotMatch(
    Object.values(consumers).join('\n'),
    /mcp__discord__create_thread/,
    'must not invent a model-callable create-thread tool',
  );
});

test('rules seed independently rejects a fictitious model-callable create-thread tool', () => {
  const rulesSeed = read('examples/rules-seed.md');
  assert.doesNotMatch(
    rulesSeed,
    /mcp__discord__create_thread/,
    'copy-once rules must not teach a tool that the official MCP does not expose',
  );
});

test('help keeps Discord thread ids distinct from Codex app-server thread ids', () => {
  assert.match(consumers.help, /Discord 스레드 ID/);
  assert.match(consumers.help, /codex app-server.*thread\/start/s);
  assert.match(consumers.help, /서로 대신 쓰지 않는다/);
});

test('plugin lock pins the updated ThisCodex feature guidance', () => {
  const skill = Buffer.from(read('skills/thiscodex/SKILL.md'), 'utf8');
  const lock = JSON.parse(read('plugin.lock.json'));
  const entry = lock.skills.find(item => item.id === 'thiscodex');

  assert.ok(entry, 'thiscodex lock entry missing');
  assert.equal(
    entry.integrity,
    `sha256-${createHash('sha256').update(skill).digest('hex')}`,
  );
});
