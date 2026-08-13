import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const ASCII_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const EVIDENCE_TTL_MS = 15 * 60 * 1000;
const RECEIPT_TTL_MS = 10 * 60 * 1000;

function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function appendPrivateJsonl(path, row) {
  ensurePrivateDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function writePrivateJson(path, value) {
  ensurePrivateDir(dirname(path));
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

export function automationEvidenceDir(env = process.env) {
  if (env.THISCODEX_AUTOMATION_EVIDENCE_DIR) return resolve(env.THISCODEX_AUTOMATION_EVIDENCE_DIR);
  if (env.DISCORD_STATE_DIR) return join(resolve(env.DISCORD_STATE_DIR), '.thiscodex-automation');
  return join(env.HOME || env.USERPROFILE || homedir(), '.config', 'thiscodex', 'automation-evidence');
}

export function automationEvidencePaths(dir) {
  return {
    activeTurn: join(dir, 'active-turn.json'),
    evidence: join(dir, 'browser-evidence.jsonl'),
    consumed: join(dir, 'consumed-evidence.jsonl'),
    flows: join(dir, 'flow-bindings.json'),
    receipts: join(dir, 'handoff-receipts.jsonl'),
    usedReceipts: join(dir, 'used-handoff-receipts.jsonl'),
  };
}

function validEvidence(row) {
  return row
    && row.schema_version === 1
    && ASCII_ID.test(String(row.thread_id || ''))
    && ASCII_ID.test(String(row.turn_id || ''))
    && ASCII_ID.test(String(row.item_id || ''))
    && ASCII_ID.test(String(row.provider || ''))
    && ASCII_ID.test(String(row.tool || ''))
    && ['completed', 'failed'].includes(row.status)
    && ['none', 'mcp_error', 'tool_error', 'cancelled', 'unknown'].includes(row.error_class)
    && Number.isFinite(Date.parse(row.observed_at));
}

function validateId(name, value) {
  if (!ASCII_ID.test(String(value || ''))) throw new Error(`${name} must be a stable ASCII identifier`);
}

export function readActiveAutomationTurn(dir, now = new Date()) {
  const active = readJson(automationEvidencePaths(dir).activeTurn);
  if (!active?.thread_id || !active?.turn_id || !active?.started_at) return null;
  const startedAt = Date.parse(active.started_at);
  if (!Number.isFinite(startedAt) || now.getTime() - startedAt > EVIDENCE_TTL_MS) return null;
  return active;
}

export function observeCurrentTurnEvidence({
  dir,
  policy,
  gatePolicy,
  flow,
  provider,
  status,
  now = new Date(),
}) {
  validateId('flow', flow);
  validateId('provider', provider);
  if (flow !== gatePolicy.flow) return { ok: false, code: 'flow_mismatch' };
  const allowedCommandProvider = gatePolicy.evidence === 'command'
    && (provider === 'model-blind-clipboard' || policy.browserProviders.has(provider));
  if (gatePolicy.evidence === 'browser' && !policy.browserProviders.has(provider)) {
    return { ok: false, code: 'provider_not_allowed' };
  }
  if (gatePolicy.evidence === 'command' && !allowedCommandProvider) {
    return { ok: false, code: 'provider_not_allowed' };
  }

  const paths = automationEvidencePaths(dir);
  const active = readActiveAutomationTurn(dir, now);
  if (!active) {
    return { ok: false, code: 'bridge_evidence_unavailable' };
  }
  const activeStarted = Date.parse(active.started_at);
  const nowMs = now.getTime();
  if (!Number.isFinite(activeStarted) || nowMs - activeStarted > EVIDENCE_TTL_MS) {
    return { ok: false, code: 'stale_active_turn' };
  }

  const consumed = new Set(readJsonl(paths.consumed).map(row => `${row.turn_id}:${row.item_id}`));
  const candidates = readJsonl(paths.evidence)
    .filter(validEvidence)
    .filter(row => row.thread_id === active.thread_id && row.turn_id === active.turn_id)
    .filter(row => row.provider === provider)
    .filter(row => Date.parse(row.observed_at) >= activeStarted)
    .filter(row => nowMs - Date.parse(row.observed_at) <= EVIDENCE_TTL_MS)
    .filter(row => !consumed.has(`${row.turn_id}:${row.item_id}`))
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));

  const expectedStatus = status === 'failed' ? 'failed' : 'completed';
  const evidence = candidates.find(row => row.status === expectedStatus);
  if (!evidence) return { ok: false, code: 'matching_evidence_missing' };

  const flows = readJson(paths.flows, { schema_version: 1, bindings: {} });
  flows.bindings ||= {};
  const flowKey = `${active.thread_id}:${flow}`;
  const prior = flows.bindings[flowKey];
  if (prior?.provider && prior.provider !== provider) {
    return { ok: false, code: 'provider_mismatch' };
  }
  flows.bindings[flowKey] = {
    thread_id: active.thread_id,
    flow,
    provider,
    first_turn_id: prior?.first_turn_id || active.turn_id,
    updated_at: now.toISOString(),
  };
  writePrivateJson(paths.flows, flows);

  appendPrivateJsonl(paths.consumed, {
    schema_version: 1,
    thread_id: active.thread_id,
    turn_id: active.turn_id,
    item_id: evidence.item_id,
    flow,
    provider,
    consumed_at: now.toISOString(),
  });
  return {
    ok: true,
    code: 'observed_current_turn_evidence',
    evidence: {
      thread_id: evidence.thread_id,
      turn_id: evidence.turn_id,
      item_id: evidence.item_id,
      provider: evidence.provider,
      tool: evidence.tool,
      status: evidence.status,
      error_class: evidence.error_class,
      observed_at: evidence.observed_at,
    },
  };
}

export function issueHandoffReceipt({ dir, evidence, gate, flow, provider, now = new Date() }) {
  const paths = automationEvidencePaths(dir);
  const active = evidence?.turn_id ? evidence : readActiveAutomationTurn(dir, now);
  if (!active?.thread_id || !active?.turn_id) {
    return { ok: false, code: 'active_turn_required' };
  }
  const token = randomBytes(24).toString('hex');
  const row = {
    schema_version: 1,
    token,
    thread_id: active.thread_id,
    turn_id: active.turn_id,
    gate,
    flow,
    provider: provider || '',
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
  };
  appendPrivateJsonl(paths.receipts, row);
  return { ok: true, token, marker: `<!-- thiscodex-automation-receipt:${token} -->`, expires_at: row.expires_at };
}
