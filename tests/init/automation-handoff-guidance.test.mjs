import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

test('every shipped installer-facing skill routes manual handoff through the code gate', () => {
  const consumers = {
    createBot: read('skills/create-bot/SKILL.md'),
    help: read('skills/help/SKILL.md'),
    setup: read('skills/setup/SKILL.md'),
    slackBridge: read('skills/slack-bridge/SKILL.md'),
    thiscodex: read('skills/thiscodex/SKILL.md'),
  };
  assert.equal(Object.keys(consumers).length, 5);
  for (const [name, body] of Object.entries(consumers)) {
    assert.match(body, /thiscodex automation-gate/, `${name} bypasses the code gate`);
  }
});

test('browser consumers require attempt evidence, terminal reason, and continuation with the same provider', () => {
  for (const path of ['skills/create-bot/SKILL.md', 'skills/help/SKILL.md', 'skills/slack-bridge/SKILL.md']) {
    const body = read(path);
    assert.match(body, /--attempted/);
    assert.match(body, /browser[- ]terminal[- ]reason/i);
    assert.match(body, /same (?:browser )?provider|같은 provider/i);
    assert.match(body, /handoff_allowed/);
  }
});

test('human security exceptions are named, not an open-ended bypass', () => {
  const policy = read('install/automation-policy.yaml');
  for (const name of [
    'discord_portal_login',
    'discord_hcaptcha',
    'discord_reset_token_modal',
    'browser_provider_install_declined',
    'token_direct_entry',
    'slack_browser_login',
    'host_package_install_consent',
    'codex_privilege_config_consent',
    'codex_hook_trust_approval',
    'shell_profile_persistence',
    'slack_workspace_admin_approval',
    'slack_app_reinstall_approval',
  ]) {
    assert.match(policy, new RegExp(`- name: ${name}\\n\\s+reason:`));
  }
  assert.doesNotMatch(policy, /allow_all|wildcard|\*:/i);
});
