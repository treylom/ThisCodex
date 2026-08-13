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

function requestFor(gate, overrides = {}) {
  return {
    surface: gate.surface,
    flow: gate.flow,
    operation: gate.operation,
    terminal: gate.terminal,
    reasonCode: gate.reason_code,
    status: gate.requirement === 'named_human' ? 'human_required' : 'failed',
    provider: gate.evidence === 'browser' ? 'playwright' : gate.evidence === 'command' ? 'playwright' : '',
    ...overrides,
  };
}

function evidenceFor(request, overrides = {}) {
  return {
    ok: true,
    code: 'observed_current_turn_evidence',
    evidence: {
      thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
      provider: request.provider, tool: 'browser.navigate',
      status: request.status === 'failed' ? 'failed' : 'completed',
      error_class: request.status === 'failed' ? 'tool_error' : 'none',
      observed_at: '2026-08-13T00:00:00.000Z',
      ...overrides,
    },
  };
}

test('strict YAML policy exposes a closed gate inventory and auto default', () => {
  const policy = loadAutomationPolicy(POLICY);
  assert.equal(policy.schemaVersion, 2);
  assert.equal(policy.defaultMode, 'auto');
  assert.equal(policy.browserToolsRequired, true);
  assert.deepEqual([...policy.browserProviders], ['playwright', 'claude-in-chrome']);
  assert.equal(policy.gates.size, 21);
  assert.equal(policy.gates.get('discord_hcaptcha').reason_code, 'captcha_required');
});

test('strict YAML parser rejects unknown, duplicate, and incomplete fields', () => {
  const base = 'schema_version: 2\ninstall:\n  default_mode: auto\n  browser_tools_required: true\n';
  assert.throws(() => parseAutomationPolicyYaml(`${base}  surprise: value\n`), /unknown|unsupported/i);
  assert.throws(() => parseAutomationPolicyYaml(`schema_version: 2\nschema_version: 2\ninstall:\n  default_mode: auto\n`), /duplicate/i);
  assert.throws(() => parseAutomationPolicyYaml(`${base}  browser_provider_servers:\n    - playwright\n  handoff_gates:\n    - name: login\n      surface: browser\n`), /missing/i);
});

test('auto mode requires exact policy metadata and independently observed evidence', () => {
  const policy = loadAutomationPolicy(POLICY);
  const gate = policy.gates.get('browser_provider_setup');
  const request = requestFor(gate);

  const missing = decideManualHandoff({ gate: gate.name, mode: 'auto', policy, request });
  assert.equal(missing.code, 'observed_evidence_required');
  assert.equal(missing.handoffAllowed, false);

  const mismatch = decideManualHandoff({
    gate: gate.name, mode: 'auto', policy,
    request: { ...request, operation: 'caller-invented-operation' },
  });
  assert.equal(mismatch.code, 'operation_mismatch');

  const failed = decideManualHandoff({
    gate: gate.name, mode: 'auto', policy, request, evidence: evidenceFor(request),
  });
  assert.equal(failed.code, 'verified_handoff_allowed');
  assert.equal(failed.handoffAllowed, true);
});

test('successful observed attempts continue automatically instead of handing off', () => {
  const policy = loadAutomationPolicy(POLICY);
  const gate = policy.gates.get('slack_browser_auth');
  const request = requestFor(gate, { status: 'succeeded' });
  const decision = decideManualHandoff({
    gate: gate.name, mode: 'auto', policy, request,
    evidence: evidenceFor(request, { status: 'completed' }),
  });
  assert.equal(decision.code, 'attempt_succeeded_continue');
  assert.equal(decision.handoffAllowed, false);
});

test('named browser human gates still require completed evidence from an allowed provider', () => {
  const policy = loadAutomationPolicy(POLICY);
  const gate = policy.gates.get('discord_hcaptcha');
  const request = requestFor(gate);
  const bad = decideManualHandoff({
    gate: gate.name, mode: 'auto', policy, request,
    evidence: evidenceFor(request, { provider: 'caller-claimed-browser' }),
  });
  assert.equal(bad.code, 'browser_provider_required');

  const allowed = decideManualHandoff({
    gate: gate.name, mode: 'auto', policy, request, evidence: evidenceFor(request),
  });
  assert.equal(allowed.code, 'verified_handoff_allowed');
});

test('manual mode allows a known gate but unknown gates fail closed', () => {
  const policy = loadAutomationPolicy(POLICY);
  const known = decideManualHandoff({ gate: 'browser_provider_setup', mode: 'manual', policy });
  assert.equal(known.code, 'manual_mode');
  assert.equal(known.handoffAllowed, true);
  const unknown = decideManualHandoff({ gate: 'unlisted-gate', mode: 'manual', policy });
  assert.equal(unknown.code, 'unknown_gate');
  assert.equal(unknown.handoffAllowed, false);
});

test('audit contains fixed policy labels and evidence coordinates, never caller prose', () => {
  const policy = loadAutomationPolicy(POLICY);
  const gate = policy.gates.get('slack_browser_auth');
  const request = requestFor(gate);
  const decision = decideManualHandoff({
    gate: gate.name, mode: 'auto', policy, request, evidence: evidenceFor(request),
  });
  const dir = mkdtempSync(join(tmpdir(), 'tcx-audit-'));
  const path = join(dir, 'automation-attempts.jsonl');
  appendAutomationAudit(path, decision.audit);
  const row = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(row.reason_code, 'browser_tool_failed');
  assert.equal(row.evidence_turn_id, 'turn-1');
  assert.equal(row.evidence_item_id, 'item-1');
  assert.doesNotMatch(JSON.stringify(row), /reason\"|raw|argument|result|url/i);
  rmSync(dir, { recursive: true, force: true });
});
