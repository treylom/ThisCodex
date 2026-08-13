import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  automationEvidencePaths,
  clearAutomationFlow,
  issueHandoffReceipt,
  observeCurrentTurnEvidence,
  startAutomationAttempt,
  startAutomationFlow,
} from '../../scripts/lib/automation-evidence.mjs';
import { loadAutomationPolicy, parseAutomationPolicyYaml } from '../../scripts/lib/automation-policy.mjs';

const NOW = new Date('2026-08-13T08:00:00.000Z');

function fixture(provider = 'playwright', status = 'failed') {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-evidence-'));
  const paths = automationEvidencePaths(dir);
  writeFileSync(paths.activeTurn, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1',
    started_at: '2026-08-13T07:59:00.000Z',
  }));
  const flow = status === 'failed' ? 'slack-auth' : 'discord-portal';
  writeFileSync(paths.activeFlow, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', flow, provider,
    started_at: '2026-08-13T07:58:00.000Z', updated_at: '2026-08-13T07:59:00.000Z',
  }));
  const gate = status === 'failed' ? 'slack_browser_auth' : 'discord_portal_complete';
  const operation = status === 'failed' ? 'login-ticket-confirm-challenge' : 'verify-discord-portal-complete';
  const evidenceTool = status === 'failed' ? 'browser_action' : 'browser_inspect';
  writeFileSync(paths.activeAttempt, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', attempt_id: 'attempt-1',
    gate, flow, operation, evidence_tool: evidenceTool,
    started_at: '2026-08-13T07:59:10.000Z',
  }));
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
    attempt_id: 'attempt-1', gate, flow, operation,
    provider, tool: status === 'failed' ? 'browser_click' : 'browser_snapshot',
    tool_class: evidenceTool, status,
    error_class: status === 'failed' ? 'tool_error' : 'none',
    observed_at: '2026-08-13T07:59:30.000Z',
  })}\n`);
  return { dir, paths };
}

test('current-turn evidence is consumed once and binds a flow to one provider', () => {
  const policy = loadAutomationPolicy();
  const gatePolicy = policy.gates.get('slack_browser_auth');
  const { dir, paths } = fixture();
  const first = observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'slack-auth', provider: 'playwright', status: 'failed', now: NOW,
  });
  assert.equal(first.ok, true);
  assert.equal(first.evidence.item_id, 'item-1');
  const second = observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'slack-auth', provider: 'playwright', status: 'failed', now: NOW,
  });
  assert.equal(second.code, 'active_attempt_required');
  assert.equal(statSync(paths.consumed).mode & 0o777, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

test('stale, foreign-turn, and caller-claimed providers fail closed', () => {
  const policy = loadAutomationPolicy();
  const gatePolicy = policy.gates.get('discord_hcaptcha');
  const { dir, paths } = fixture();
  writeFileSync(paths.activeFlow, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', flow: 'discord-portal', provider: 'playwright',
    started_at: '2026-08-13T07:58:00.000Z', updated_at: '2026-08-13T07:59:00.000Z',
  }));
  writeFileSync(paths.activeAttempt, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', attempt_id: 'attempt-hcaptcha',
    gate: 'discord_hcaptcha', flow: 'discord-portal', operation: 'inspect-discord-hcaptcha',
    evidence_tool: 'browser_inspect', started_at: '2026-08-13T07:59:10.000Z',
  }));
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
    attempt_id: 'attempt-hcaptcha', gate: 'discord_hcaptcha', flow: 'discord-portal',
    operation: 'inspect-discord-hcaptcha', provider: 'playwright', tool: 'browser_snapshot',
    tool_class: 'browser_inspect', status: 'completed', error_class: 'none',
    observed_at: '2026-08-13T07:59:30.000Z',
  })}\n`);
  assert.equal(observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'discord-portal', provider: 'caller-browser', status: 'human_required', now: NOW,
  }).code, 'provider_not_allowed');
  writeFileSync(paths.activeTurn, JSON.stringify({
    schema_version: 1, thread_id: 'thread-2', turn_id: 'turn-2', started_at: '2026-08-13T07:59:00.000Z',
  }));
  assert.equal(observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'discord-portal', provider: 'playwright', status: 'human_required', now: NOW,
  }).code, 'active_flow_required');
  rmSync(dir, { recursive: true, force: true });
});

test('an active browser flow rejects a different allowed provider', () => {
  const policy = loadAutomationPolicy();
  const gatePolicy = policy.gates.get('discord_portal_complete');
  const { dir, paths } = fixture('playwright', 'completed');
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-other',
    attempt_id: 'attempt-1', gate: 'discord_portal_complete', flow: 'discord-portal',
    operation: 'verify-discord-portal-complete', provider: 'claude-in-chrome', tool: 'browser_snapshot',
    tool_class: 'browser_inspect', status: 'completed', error_class: 'none',
    observed_at: '2026-08-13T07:59:30.000Z',
  })}\n`);
  const result = observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'discord-portal', provider: 'claude-in-chrome',
    status: 'succeeded', now: NOW,
  });
  assert.equal(result.code, 'provider_mismatch');
  rmSync(dir, { recursive: true, force: true });
});

test('receipt is bound to the active bridge turn and never embeds tool payload', () => {
  const { dir, paths } = fixture('playwright', 'completed');
  const receipt = issueHandoffReceipt({
    dir, gate: 'discord_hcaptcha', flow: 'discord-portal', provider: 'playwright',
    resumeRequired: true, now: NOW,
  });
  assert.equal(receipt.ok, true);
  assert.match(receipt.marker, /^<!-- thiscodex-automation-receipt:[a-f0-9]{48} -->$/);
  const stored = readFileSync(paths.receipts, 'utf8');
  assert.match(stored, /"thread_id":"thread-1"/);
  assert.match(stored, /"resume_required":true/);
  assert.doesNotMatch(stored, /arguments|result|https?:|token-value/i);
  chmodSync(paths.receipts, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

test('a terminal success clears one active flow and a new flow may bind another provider', () => {
  const policy = loadAutomationPolicy();
  const { dir, paths } = fixture('playwright', 'completed');
  assert.equal(clearAutomationFlow({
    dir, flow: 'discord-portal', threadId: 'thread-1', now: NOW,
  }).code, 'flow_cleared');
  assert.equal(startAutomationFlow({
    dir, policy, flow: 'discord-portal', now: NOW,
  }).code, 'flow_started');
  const active = JSON.parse(readFileSync(paths.activeFlow, 'utf8'));
  assert.equal(active.provider, '');
  rmSync(dir, { recursive: true, force: true });
});

test('model-blind clipboard evidence is auxiliary to the bound Discord browser flow', () => {
  const policy = loadAutomationPolicy();
  const gatePolicy = policy.gates.get('token_direct_entry');
  const { dir, paths } = fixture('playwright', 'completed');
  writeFileSync(paths.activeAttempt, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', attempt_id: 'attempt-clip',
    gate: 'token_direct_entry', flow: 'discord-portal', operation: 'model-blind-token-receipt',
    evidence_tool: 'clipboard', started_at: '2026-08-13T07:59:10.000Z',
  }));
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'clip-1',
    attempt_id: 'attempt-clip', gate: 'token_direct_entry', flow: 'discord-portal',
    operation: 'model-blind-token-receipt', provider: 'model-blind-clipboard', tool: 'clipboard-receipt-command',
    tool_class: 'clipboard', status: 'failed', error_class: 'tool_error',
    observed_at: '2026-08-13T07:59:30.000Z',
  })}\n`);
  const result = observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'discord-portal', provider: 'model-blind-clipboard',
    status: 'failed', now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.item_id, 'clip-1');
  assert.equal(JSON.parse(readFileSync(paths.activeFlow, 'utf8')).provider, 'playwright');
  rmSync(dir, { recursive: true, force: true });
});

test('an attempt binds one policy gate and operation before evidence can be consumed', () => {
  const policy = loadAutomationPolicy();
  const { dir, paths } = fixture('playwright', 'completed');
  writeFileSync(paths.activeTurn, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-2',
    started_at: '2026-08-13T07:59:00.000Z',
  }));
  writeFileSync(paths.activeFlow, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', flow: 'discord-portal', provider: 'playwright',
    started_at: '2026-08-13T07:58:00.000Z', updated_at: '2026-08-13T07:59:00.000Z',
  }));
  const prepared = startAutomationAttempt({ dir, policy, gate: 'discord_hcaptcha', now: NOW });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.attempt.operation, 'inspect-discord-hcaptcha');
  assert.equal(prepared.attempt.evidence_tool, 'browser_inspect');
  assert.equal(startAutomationAttempt({ dir, policy, gate: 'github_auth_login', now: NOW }).code, 'attempt_not_required');
  rmSync(dir, { recursive: true, force: true });
});

test('browser_tools_required prevents a browser attempt record when policy disables the tools', () => {
  const yaml = readFileSync('install/automation-policy.yaml', 'utf8');
  const required = parseAutomationPolicyYaml(yaml);
  const disabled = parseAutomationPolicyYaml(yaml.replace(
    'browser_tools_required: true',
    'browser_tools_required: false',
  ));
  const dir = mkdtempSync(join(tmpdir(), 'tcx-browser-policy-'));
  const paths = automationEvidencePaths(dir);
  writeFileSync(paths.activeTurn, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1',
    started_at: '2026-08-13T07:59:00.000Z',
  }));
  writeFileSync(paths.activeFlow, JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', flow: 'discord-portal', provider: 'playwright',
    started_at: '2026-08-13T07:58:00.000Z', updated_at: '2026-08-13T07:59:00.000Z',
  }));

  const blocked = startAutomationAttempt({
    dir, policy: disabled, gate: 'discord_hcaptcha', now: NOW,
  });
  assert.equal(blocked.code, 'browser_tools_disabled_by_policy');
  assert.equal(existsSync(paths.activeAttempt), false);

  const started = startAutomationAttempt({
    dir, policy: required, gate: 'discord_hcaptcha', now: NOW,
  });
  assert.equal(started.code, 'attempt_started');
  assert.equal(existsSync(paths.activeAttempt), true);
  rmSync(dir, { recursive: true, force: true });
});

test('same-flow evidence for another gate or operation cannot satisfy the claimed attempt', () => {
  const policy = loadAutomationPolicy();
  const gatePolicy = policy.gates.get('slack_browser_auth');
  const { dir, paths } = fixture();
  const base = {
    schema_version: 2, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-wrong',
    attempt_id: 'attempt-1', flow: 'slack-auth', provider: 'playwright',
    tool: 'browser_click', tool_class: 'browser_action', status: 'failed',
    error_class: 'tool_error', observed_at: '2026-08-13T07:59:30.000Z',
  };
  writeFileSync(paths.evidence, `${JSON.stringify({
    ...base, gate: 'slack_browser_login', operation: 'inspect-slack-login',
  })}\n`);
  assert.equal(observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'slack-auth', provider: 'playwright', status: 'failed', now: NOW,
  }).code, 'matching_evidence_missing');
  writeFileSync(paths.evidence, `${JSON.stringify({
    ...base, item_id: 'item-wrong-operation', gate: 'slack_browser_auth', operation: 'unrelated-click',
  })}\n`);
  assert.equal(observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'slack-auth', provider: 'playwright', status: 'failed', now: NOW,
  }).code, 'matching_evidence_missing');
  rmSync(dir, { recursive: true, force: true });
});
