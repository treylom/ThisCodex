import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendAutomationAudit,
  decideManualHandoff,
  loadAutomationPolicy,
  parseAutomationPolicyYaml,
} from '../../scripts/lib/automation-policy.mjs';

const POLICY = 'install/automation-policy.yaml';

test('strict YAML policy is consumed with auto as the code-gated default', () => {
  const policy = loadAutomationPolicy(POLICY);
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.defaultMode, 'auto');
  assert.equal(policy.browserToolsRequired, true);
  assert.equal(policy.manualAllowedWithoutAttempt.get('discord_hcaptcha'), 'CAPTCHA completion cannot be delegated or bypassed.');
});

test('strict YAML parser rejects unknown, duplicate, and incomplete policy fields', () => {
  assert.throws(() => parseAutomationPolicyYaml('schema_version: 1\ninstall:\n  default_mode: auto\n  browser_tools_required: true\n  surprise: value\n  manual_allowed_without_attempt:\n'), /unknown|unsupported/i);
  assert.throws(() => parseAutomationPolicyYaml('schema_version: 1\nschema_version: 1\ninstall:\n  default_mode: auto\n  browser_tools_required: true\n  manual_allowed_without_attempt:\n'), /duplicate/i);
  assert.throws(() => parseAutomationPolicyYaml('schema_version: 1\ninstall:\n  default_mode: auto\n  browser_tools_required: true\n  manual_allowed_without_attempt:\n    - name: login\n'), /reason/i);
  assert.throws(() => parseAutomationPolicyYaml('schema_version: 1\ninstall:\n  default_mode: auto\n  browser_tools_required: true\n  manual_allowed_without_attempt:\n    - name: login\n      reason: first\n      reason: second\n'), /duplicate/i);
});

test('auto mode blocks an unlisted handoff until a real attempt result exists', () => {
  const policy = loadAutomationPolicy(POLICY);
  const blocked = decideManualHandoff({ gate: 'browser_provider_setup', mode: 'auto', policy });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.handoffAllowed, false);
  assert.equal(blocked.code, 'attempt_required');

  const failed = decideManualHandoff({
    gate: 'browser_provider_setup',
    mode: 'auto',
    policy,
    attempt: { attempted: true, status: 'failed', provider: 'playwright', operation: 'register-and-redetect', reason: 'provider did not become callable' },
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.handoffAllowed, true);
  assert.equal(failed.code, 'attempt_failed_handoff_allowed');

  const completed = decideManualHandoff({
    gate: 'browser_provider_setup',
    mode: 'auto',
    policy,
    attempt: { attempted: true, status: 'succeeded', provider: 'playwright', operation: 'register-and-redetect', reason: '' },
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.handoffAllowed, false);
  assert.equal(completed.code, 'attempt_succeeded_continue');
});

test('only named human-security gates bypass an attempt in auto mode', () => {
  const policy = loadAutomationPolicy(POLICY);
  const listed = decideManualHandoff({
    gate: 'discord_portal_login',
    mode: 'auto',
    policy,
    attempt: { attempted: false, status: 'human_required', provider: 'playwright', operation: 'inspect-login-page', reason: 'login form is visible' },
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.handoffAllowed, true);
  assert.equal(listed.code, 'declared_human_security_gate');

  const unknown = decideManualHandoff({
    gate: 'discord_new_unknown_gate',
    mode: 'auto',
    policy,
    attempt: { attempted: false, status: 'human_required', reason: 'unknown' },
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'attempt_required');
});

test('named browser security gates still require provider and terminal evidence', () => {
  const policy = loadAutomationPolicy(POLICY);
  const blocked = decideManualHandoff({
    gate: 'discord_hcaptcha',
    mode: 'auto',
    policy,
    attempt: { status: 'human_required', reason: 'challenge visible', surface: 'browser', operation: 'inspect-challenge' },
  });
  assert.equal(blocked.code, 'browser_provider_required');

  const allowed = decideManualHandoff({
    gate: 'discord_hcaptcha',
    mode: 'auto',
    policy,
    attempt: {
      status: 'human_required',
      reason: 'challenge visible',
      surface: 'browser',
      provider: 'playwright',
      operation: 'inspect-challenge',
      browserTerminalReason: 'human_security_challenge',
    },
  });
  assert.equal(allowed.code, 'declared_human_security_gate');
});

test('named human gates still require a stable observed operation', () => {
  const policy = loadAutomationPolicy(POLICY);
  const blocked = decideManualHandoff({
    gate: 'codex_hook_trust_approval',
    mode: 'auto',
    policy,
    attempt: { status: 'human_required', reason: 'trust prompt visible' },
  });
  assert.equal(blocked.code, 'attempt_operation_required');
});

test('manual mode allows guidance while still producing an audit record', () => {
  const policy = loadAutomationPolicy(POLICY);
  const decision = decideManualHandoff({ gate: 'browser_provider_setup', mode: 'manual', policy });
  assert.equal(decision.ok, true);
  assert.equal(decision.handoffAllowed, true);
  assert.equal(decision.code, 'manual_mode');

  const dir = mkdtempSync(join(tmpdir(), 'tcx-audit-'));
  const path = join(dir, 'automation-attempts.jsonl');
  appendAutomationAudit(path, decision.audit);
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gate, 'browser_provider_setup');
  assert.equal(rows[0].mode, 'manual');
  rmSync(dir, { recursive: true, force: true });
});

test('browser attempts require a callable provider and a terminal reason', () => {
  const policy = loadAutomationPolicy(POLICY);
  const missingProvider = decideManualHandoff({
    gate: 'discord_desktop_approval',
    mode: 'auto',
    policy,
    attempt: { attempted: true, status: 'failed', surface: 'browser', operation: 'approve', reason: 'window detached', browserTerminalReason: 'detached_window' },
  });
  assert.equal(missingProvider.code, 'browser_provider_required');

  const missingTerminal = decideManualHandoff({
    gate: 'discord_desktop_approval',
    mode: 'auto',
    policy,
    attempt: { attempted: true, status: 'failed', surface: 'browser', provider: 'playwright', operation: 'approve', reason: 'window detached' },
  });
  assert.equal(missingTerminal.code, 'browser_terminal_reason_required');
});
