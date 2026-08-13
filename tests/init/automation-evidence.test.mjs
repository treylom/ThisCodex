import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  automationEvidencePaths,
  issueHandoffReceipt,
  observeCurrentTurnEvidence,
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
  writeFileSync(paths.evidence, `${JSON.stringify({
    schema_version: 1, thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1',
    provider, tool: 'browser.navigate', status,
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
  assert.equal(observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'discord-portal', provider: 'caller-browser', status: 'human_required', now: NOW,
  }).code, 'provider_not_allowed');
  writeFileSync(paths.activeTurn, JSON.stringify({
    schema_version: 1, thread_id: 'thread-2', turn_id: 'turn-2', started_at: '2026-08-13T07:59:00.000Z',
  }));
  assert.equal(observeCurrentTurnEvidence({
    dir, policy, gatePolicy, flow: 'discord-portal', provider: 'playwright', status: 'human_required', now: NOW,
  }).code, 'matching_evidence_missing');
  rmSync(dir, { recursive: true, force: true });
});

test('receipt is bound to the active bridge turn and never embeds tool payload', () => {
  const { dir, paths } = fixture('playwright', 'completed');
  const receipt = issueHandoffReceipt({
    dir, gate: 'discord_hcaptcha', flow: 'discord-portal', provider: 'playwright', now: NOW,
  });
  assert.equal(receipt.ok, true);
  assert.match(receipt.marker, /^<!-- thiscodex-automation-receipt:[a-f0-9]{48} -->$/);
  const stored = readFileSync(paths.receipts, 'utf8');
  assert.match(stored, /"thread_id":"thread-1"/);
  assert.doesNotMatch(stored, /arguments|result|https?:|token-value/i);
  chmodSync(paths.receipts, 0o600);
  rmSync(dir, { recursive: true, force: true });
});
