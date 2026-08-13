import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const ASCII_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const EVIDENCE_TTL_MS = 15 * 60 * 1000;
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const FLOW_TTL_MS = 2 * 60 * 60 * 1000;

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

function claimEvidenceOnce(dir, evidence, now) {
  const digest = createHash('sha256')
    .update(`${evidence.turn_id}:${evidence.item_id}`)
    .digest('hex');
  const marker = join(dir, `evidence-${digest}.used`);
  ensurePrivateDir(dir);
  try {
    writeFileSync(marker, `${JSON.stringify({
      schema_version: 1,
      turn_id: evidence.turn_id,
      item_id: evidence.item_id,
      claimed_at: now.toISOString(),
    })}\n`, { flag: 'wx', mode: 0o600 });
    chmodSync(marker, 0o600);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

export function automationEvidenceDir(env = process.env) {
  if (env.THISCODEX_AUTOMATION_EVIDENCE_DIR) return resolve(env.THISCODEX_AUTOMATION_EVIDENCE_DIR);
  if (env.DISCORD_STATE_DIR) return join(resolve(env.DISCORD_STATE_DIR), '.thiscodex-automation');
  return join(env.HOME || env.USERPROFILE || homedir(), '.config', 'thiscodex', 'automation-evidence');
}

export function automationEvidencePaths(dir) {
  return {
    activeTurn: join(dir, 'active-turn.json'),
    activeFlow: join(dir, 'active-flow.json'),
    activeAttempt: join(dir, 'active-attempt.json'),
    evidence: join(dir, 'browser-evidence.jsonl'),
    consumed: join(dir, 'consumed-evidence.jsonl'),
    receipts: join(dir, 'handoff-receipts.jsonl'),
    usedReceipts: join(dir, 'used-handoff-receipts.jsonl'),
  };
}

export function readActiveAutomationAttempt(dir, now = new Date()) {
  const attempt = readJson(automationEvidencePaths(dir).activeAttempt);
  if (!attempt?.thread_id || !attempt?.turn_id || !attempt?.attempt_id
      || !attempt?.gate || !attempt?.flow || !attempt?.operation
      || !attempt?.evidence_tool || !attempt?.started_at) return null;
  const startedAt = Date.parse(attempt.started_at);
  if (!Number.isFinite(startedAt) || now.getTime() - startedAt > EVIDENCE_TTL_MS) return null;
  return attempt;
}

export function startAutomationAttempt({ dir, policy, gate, now = new Date() }) {
  validateId('gate', gate);
  const gatePolicy = policy.gates.get(gate);
  if (!gatePolicy) return { ok: false, code: 'unknown_gate' };
  if (gatePolicy.evidence === 'none') return { ok: false, code: 'attempt_not_required' };
  const active = readActiveAutomationTurn(dir, now);
  if (!active) return { ok: false, code: 'bridge_evidence_unavailable' };
  const flow = readActiveAutomationFlow(dir, now);
  if (!flow || flow.thread_id !== active.thread_id || flow.flow !== gatePolicy.flow) {
    return { ok: false, code: 'active_flow_required' };
  }
  const row = {
    schema_version: 1,
    thread_id: active.thread_id,
    turn_id: active.turn_id,
    attempt_id: randomBytes(16).toString('hex'),
    gate: gatePolicy.name,
    flow: gatePolicy.flow,
    operation: gatePolicy.operation,
    evidence_tool: gatePolicy.evidence_tool,
    started_at: now.toISOString(),
  };
  writePrivateJson(automationEvidencePaths(dir).activeAttempt, row);
  return { ok: true, code: 'attempt_started', attempt: row };
}

export function readActiveAutomationFlow(dir, now = new Date()) {
  const flow = readJson(automationEvidencePaths(dir).activeFlow);
  if (!flow?.thread_id || !flow?.flow || !flow?.started_at) return null;
  const startedAt = Date.parse(flow.started_at);
  if (!Number.isFinite(startedAt) || now.getTime() - startedAt > FLOW_TTL_MS) return null;
  return flow;
}

export function startAutomationFlow({ dir, policy, flow, now = new Date() }) {
  validateId('flow', flow);
  if (![...policy.gates.values()].some(gate => gate.flow === flow)) {
    return { ok: false, code: 'unknown_flow' };
  }
  const active = readActiveAutomationTurn(dir, now);
  if (!active) return { ok: false, code: 'bridge_evidence_unavailable' };
  const prior = readActiveAutomationFlow(dir, now);
  if (prior && (prior.thread_id !== active.thread_id || prior.flow !== flow)) {
    return { ok: false, code: 'different_flow_already_active' };
  }
  const row = {
    schema_version: 1,
    thread_id: active.thread_id,
    flow,
    provider: prior?.provider || '',
    started_at: prior?.started_at || now.toISOString(),
    updated_at: now.toISOString(),
  };
  writePrivateJson(automationEvidencePaths(dir).activeFlow, row);
  return { ok: true, code: prior ? 'flow_already_active' : 'flow_started', flow: row };
}

export function clearAutomationFlow({ dir, flow, threadId = '', now = new Date() }) {
  const paths = automationEvidencePaths(dir);
  const active = readActiveAutomationFlow(dir, now);
  if (!active) return { ok: true, code: 'flow_already_clear' };
  if (active.flow !== flow || (threadId && active.thread_id !== threadId)) {
    return { ok: false, code: 'active_flow_mismatch' };
  }
  try {
    unlinkSync(paths.activeFlow);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { ok: true, code: 'flow_cleared' };
}

function validEvidence(row) {
  return row
    && row.schema_version === 2
    && ASCII_ID.test(String(row.thread_id || ''))
    && ASCII_ID.test(String(row.turn_id || ''))
    && ASCII_ID.test(String(row.item_id || ''))
    && ASCII_ID.test(String(row.attempt_id || ''))
    && ASCII_ID.test(String(row.gate || ''))
    && ASCII_ID.test(String(row.flow || ''))
    && ASCII_ID.test(String(row.operation || ''))
    && ASCII_ID.test(String(row.provider || ''))
    && ASCII_ID.test(String(row.tool || ''))
    && ['browser_inspect', 'browser_action', 'provider_setup', 'clipboard'].includes(row.tool_class)
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
  const activeFlow = readActiveAutomationFlow(dir, now);
  if (!activeFlow || activeFlow.thread_id !== active.thread_id || activeFlow.flow !== flow) {
    return { ok: false, code: 'active_flow_required' };
  }
  const auxiliaryProvider = provider === 'model-blind-clipboard';
  if (activeFlow.provider && activeFlow.provider !== provider && !auxiliaryProvider) {
    return { ok: false, code: 'provider_mismatch' };
  }
  const activeAttempt = readActiveAutomationAttempt(dir, now);
  if (!activeAttempt
      || activeAttempt.thread_id !== active.thread_id
      || activeAttempt.turn_id !== active.turn_id
      || activeAttempt.gate !== gatePolicy.name
      || activeAttempt.flow !== flow
      || activeAttempt.operation !== gatePolicy.operation
      || activeAttempt.evidence_tool !== gatePolicy.evidence_tool) {
    return { ok: false, code: 'active_attempt_required' };
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
    .filter(row => row.attempt_id === activeAttempt.attempt_id)
    .filter(row => row.gate === gatePolicy.name)
    .filter(row => row.flow === flow)
    .filter(row => row.operation === gatePolicy.operation)
    .filter(row => row.provider === provider)
    .filter(row => row.tool_class === gatePolicy.evidence_tool)
    .filter(row => Date.parse(row.observed_at) >= activeStarted)
    .filter(row => nowMs - Date.parse(row.observed_at) <= EVIDENCE_TTL_MS)
    .filter(row => !consumed.has(`${row.turn_id}:${row.item_id}`))
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));

  const expectedStatus = status === 'failed' ? 'failed' : 'completed';
  const evidence = candidates
    .filter(row => row.status === expectedStatus)
    .find(row => claimEvidenceOnce(dir, row, now));
  if (!evidence) return { ok: false, code: 'matching_evidence_missing' };

  appendPrivateJsonl(paths.consumed, {
    schema_version: 1,
    thread_id: active.thread_id,
    turn_id: active.turn_id,
    item_id: evidence.item_id,
    attempt_id: evidence.attempt_id,
    gate: gatePolicy.name,
    flow,
    operation: gatePolicy.operation,
    provider,
    consumed_at: now.toISOString(),
  });
  try {
    unlinkSync(paths.activeAttempt);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return {
    ok: true,
    code: 'observed_current_turn_evidence',
    evidence: {
      thread_id: evidence.thread_id,
      turn_id: evidence.turn_id,
      item_id: evidence.item_id,
      attempt_id: evidence.attempt_id,
      gate: evidence.gate,
      operation: evidence.operation,
      provider: evidence.provider,
      tool: evidence.tool,
      tool_class: evidence.tool_class,
      status: evidence.status,
      error_class: evidence.error_class,
      observed_at: evidence.observed_at,
    },
  };
}

export function issueHandoffReceipt({
  dir,
  evidence,
  gate,
  flow,
  provider,
  resumeRequired = false,
  now = new Date(),
}) {
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
    resume_required: resumeRequired === true,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
  };
  appendPrivateJsonl(paths.receipts, row);
  return { ok: true, token, marker: `<!-- thiscodex-automation-receipt:${token} -->`, expires_at: row.expires_at };
}
