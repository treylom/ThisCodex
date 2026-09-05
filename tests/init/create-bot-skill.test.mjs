import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

test('create-bot skill ports the Discord portal browser contract to Codex', () => {
  const skill = read('skills/create-bot/SKILL.md');

  assert.match(skill, /^---\nname: create-bot\n/m);
  assert.match(skill, /capabilit(?:y|ies).*not.*(?:tool )?name/is);
  assert.match(skill, /navigate.*snapshot.*click.*(?:type|fill).*wait/is);
  assert.match(skill, /codex mcp add playwright -- npx -y @playwright\/mcp@latest/);
  assert.match(skill, /restart Codex/i);

  for (const gate of ['login', 'MFA', 'hCaptcha', 'Reset Token']) {
    assert.match(skill, new RegExp(gate, 'i'), `${gate} gate missing`);
  }
  for (const intent of ['Message Content Intent', 'Server Members Intent']) {
    assert.match(skill, new RegExp(intent), `${intent} missing`);
  }

  assert.match(skill, /permissions=395137117248/);
  assert.match(skill, /do not.*(?:screenshot|snapshot).*token/is);
  assert.match(skill, /dry-run.*must not navigate/is);
  assert.match(skill, /automation-gate/);
  assert.match(skill, /attempt.*result.*manual|manual.*attempt.*result/is);
  assert.match(skill, /browser.*terminal.*reason|terminal.*reason.*browser/is);
  assert.match(skill, /discord_portal_login/);
  assert.match(skill, /discord_hcaptcha/);
  assert.match(skill, /discord_reset_token_modal/);
});

test('create-bot setup and public docs expose the MCP path', () => {
  const setup = read('docs/SETUP.md');
  const readme = read('README.md');
  const readmeKo = read('README.ko.md');
  const help = read('skills/help/SKILL.md');

  assert.match(setup, /## 3\. Discord Bot Creation With Browser Automation/);
  assert.match(setup, /\[mcp_servers\.playwright\]/);
  assert.match(setup, /@playwright\/mcp@latest/);
  assert.match(readme, /`\/create-bot`/);
  assert.match(readmeKo, /`\/create-bot`/);
  assert.match(help, /`\/create-bot`/);
  assert.doesNotMatch(help, /앱 생성·토큰 발급은 원리상 사람 몫/);
});

test('plugin lock pins the shipped create-bot skill bytes', () => {
  const bytes = Buffer.from(read('skills/create-bot/SKILL.md'), 'utf8');
  const lock = JSON.parse(read('plugin.lock.json'));
  const entry = lock.skills.find(skill => skill.id === 'create-bot');

  assert.ok(entry, 'create-bot lock entry missing');
  assert.equal(entry.vendoredPath, 'skills/create-bot');
  assert.equal(
    entry.integrity,
    `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
  );
});
