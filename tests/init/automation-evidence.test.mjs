import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  automationEvidencePaths,
  clearAutomationFlow,
  issueHandoffReceipt,
  observeCurrentTurnEvidence,
  startAutomationFlow,
} from '../../scripts/lib/automation-evidence.mjs';
import { loadAutomationPolicy } from '../../scripts/lib/automation-policy.mjs';

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
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
    flow, provider, tool: 'browser_click', tool_class: 'browser_action', status,
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
  assert.equal(second.code, 'matching_evidence_missing');
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
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
    flow: 'discord-portal', provider: 'playwright', tool: 'browser_snapshot',
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
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-other',
    flow: 'discord-portal', provider: 'claude-in-chrome', tool: 'browser_snapshot',
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
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'clip-1',
    flow: 'discord-portal', provider: 'model-blind-clipboard', tool: 'clipboard-receipt-command',
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
