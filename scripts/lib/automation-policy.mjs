import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const AUTOMATION_POLICY_REL = 'install/automation-policy.yaml';
export const AUTOMATION_AUDIT_REL = '.config/thiscodex/automation-attempts.jsonl';
const MODES = new Set(['auto', 'manual']);
const SURFACES = new Set(['browser', 'consent', 'host', 'secret']);
const REQUIREMENTS = new Set(['named_human', 'observed_attempt']);
const EVIDENCE_KINDS = new Set(['none', 'browser', 'command']);
const EVIDENCE_TOOLS = new Set(['none', 'browser_inspect', 'browser_action', 'provider_setup', 'clipboard']);
const TERMINALS = new Set(['human_security_gate', 'tool_failed', 'flow_completed']);
const GATE_KEYS = new Set([
  'surface', 'flow', 'requirement', 'evidence', 'evidence_tool', 'operation', 'terminal', 'reason_code',
]);
const ASCII_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;

function scalar(raw) {
  const value = raw.trim();
  if (!value) throw new Error('empty YAML scalar');
  if (/[[\]{}&*!|>]/.test(value)) throw new Error(`unsupported YAML syntax: ${value}`);
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function unique(seen, key) {
  if (seen.has(key)) throw new Error(`duplicate YAML key: ${key}`);
  seen.add(key);
}

function finishGate(policy, gate) {
  if (!gate) return;
  for (const key of GATE_KEYS) {
    if (!gate[key]) throw new Error(`handoff gate ${gate.name} missing ${key}`);
  }
  if (!SURFACES.has(gate.surface)) throw new Error(`handoff gate ${gate.name} has invalid surface`);
  if (!REQUIREMENTS.has(gate.requirement)) throw new Error(`handoff gate ${gate.name} has invalid requirement`);
  if (!EVIDENCE_KINDS.has(gate.evidence)) throw new Error(`handoff gate ${gate.name} has invalid evidence`);
  if (!EVIDENCE_TOOLS.has(gate.evidence_tool)) throw new Error(`handoff gate ${gate.name} has invalid evidence_tool`);
  if (!TERMINALS.has(gate.terminal)) throw new Error(`handoff gate ${gate.name} has invalid terminal`);
  for (const key of ['name', 'flow', 'operation', 'reason_code']) {
    if (!ASCII_ID.test(gate[key])) throw new Error(`handoff gate ${gate.name} has invalid ${key}`);
  }
  if (gate.surface === 'browser' && gate.evidence === 'none') {
    throw new Error(`browser gate ${gate.name} must require observed evidence`);
  }
  if (gate.requirement === 'observed_attempt' && gate.evidence === 'none') {
    throw new Error(`attempt gate ${gate.name} must require observed evidence`);
  }
  if ((gate.evidence === 'none') !== (gate.evidence_tool === 'none')) {
    throw new Error(`handoff gate ${gate.name} has incompatible evidence_tool`);
  }
  if (policy.gates.has(gate.name)) throw new Error(`duplicate handoff gate: ${gate.name}`);
  policy.gates.set(gate.name, Object.freeze({ ...gate }));
}

/** Parse only the shipped policy shape; unknown syntax fails closed. */
export function parseAutomationPolicyYaml(text) {
  const policy = {
    schemaVersion: null,
    defaultMode: null,
    browserToolsRequired: null,
    browserProviders: new Set(),
    gates: new Map(),
  };
  const seen = new Set();
  let inInstall = false;
  let section = '';
  let gate = null;
  let gateSeen = new Set();

  for (const [index, original] of String(text).replace(/\r\n/g, '\n').split('\n').entries()) {
    const lineNumber = index + 1;
    if (!original.trim() || original.trimStart().startsWith('#')) continue;
    const line = original.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    let match;

    if ((match = line.match(/^schema_version:\s*(.+)$/))) {
      unique(seen, 'schema_version');
      policy.schemaVersion = Number(scalar(match[1]));
      continue;
    }
    if (line === 'install:') {
      unique(seen, 'install');
      inInstall = true;
      continue;
    }
    if (!inInstall) throw new Error(`unknown YAML field at line ${lineNumber}: ${line}`);
    if ((match = line.match(/^  default_mode:\s*(.+)$/))) {
      unique(seen, 'install.default_mode');
      policy.defaultMode = scalar(match[1]);
      continue;
    }
    if ((match = line.match(/^  browser_tools_required:\s*(true|false)$/))) {
      unique(seen, 'install.browser_tools_required');
      policy.browserToolsRequired = match[1] === 'true';
      continue;
    }
    if (line === '  browser_provider_servers:') {
      unique(seen, 'install.browser_provider_servers');
      finishGate(policy, gate);
      gate = null;
      section = 'providers';
      continue;
    }
    if (line === '  handoff_gates:') {
      unique(seen, 'install.handoff_gates');
      finishGate(policy, gate);
      gate = null;
      section = 'gates';
      continue;
    }
    if (section === 'providers' && (match = line.match(/^    - ([A-Za-z0-9_.-]+)$/))) {
      if (policy.browserProviders.has(match[1])) throw new Error(`duplicate browser provider: ${match[1]}`);
      policy.browserProviders.add(match[1]);
      continue;
    }
    if (section === 'gates' && (match = line.match(/^    - name:\s*([A-Za-z0-9_.-]+)$/))) {
      finishGate(policy, gate);
      gate = { name: match[1] };
      gateSeen = new Set(['name']);
      continue;
    }
    if (section === 'gates' && (match = line.match(/^      ([a-z_]+):\s*(.+)$/))) {
      if (!gate) throw new Error(`handoff gate field without name at line ${lineNumber}`);
      const key = match[1];
      if (!GATE_KEYS.has(key)) throw new Error(`unknown handoff gate field at line ${lineNumber}: ${key}`);
      unique(gateSeen, key);
      gate[key] = scalar(match[2]);
      continue;
    }
    throw new Error(`unknown or unsupported YAML field at line ${lineNumber}: ${line}`);
  }
  finishGate(policy, gate);

  if (policy.schemaVersion !== 2) throw new Error('automation policy schema_version must be 2');
  if (!MODES.has(policy.defaultMode)) throw new Error('automation policy default_mode must be auto or manual');
  if (typeof policy.browserToolsRequired !== 'boolean') throw new Error('automation policy browser_tools_required missing');
  if (!policy.browserProviders.size) throw new Error('automation policy browser_provider_servers missing');
  if (!policy.gates.size) throw new Error('automation policy handoff_gates missing');
  return policy;
}

export function loadAutomationPolicy(path = AUTOMATION_POLICY_REL) {
  return parseAutomationPolicyYaml(readFileSync(path, 'utf8'));
}

export function resolveAutomationMode({ explicit, state, policy }) {
  const value = explicit || state?.answers?.automation_mode || policy.defaultMode;
  if (!MODES.has(value)) throw new Error('automation mode must be auto or manual');
  return value;
}

function auditBase(gatePolicy, mode, request, evidence) {
  const observed = evidence?.evidence || evidence;
  return {
    schema_version: 2,
    gate: gatePolicy.name,
    mode,
    surface: gatePolicy.surface,
    flow: gatePolicy.flow,
    requirement: gatePolicy.requirement,
    operation: gatePolicy.operation,
    terminal: gatePolicy.terminal,
    reason_code: gatePolicy.reason_code,
    provider: observed?.provider || request.provider || '',
    evidence_turn_id: observed?.turn_id || '',
    evidence_item_id: observed?.item_id || '',
    evidence_tool: observed?.tool_class || '',
    evidence_tool_name: observed?.tool || '',
    evidence_status: observed?.status || '',
  };
}

export function decideManualHandoff({ gate, mode, policy, request = {}, evidence = null }) {
  if (!ASCII_ID.test(String(gate || ''))) throw new Error('gate must be a stable ASCII identifier');
  if (!MODES.has(mode)) throw new Error('mode must be auto or manual');
  const gatePolicy = policy.gates.get(gate);
  if (!gatePolicy) return { ok: false, handoffAllowed: false, code: 'unknown_gate' };
  const base = auditBase(gatePolicy, mode, request, evidence);

  if (mode === 'manual') {
    return { ok: true, handoffAllowed: true, code: 'manual_mode', gatePolicy, audit: { ...base, decision: 'handoff_allowed' } };
  }
  for (const key of ['surface', 'flow', 'operation', 'terminal', 'reasonCode']) {
    const policyKey = key === 'reasonCode' ? 'reason_code' : key;
    if (request[key] !== gatePolicy[policyKey]) {
      return { ok: false, handoffAllowed: false, code: `${policyKey}_mismatch`, gatePolicy, audit: { ...base, decision: 'blocked' } };
    }
  }
  if (gatePolicy.evidence !== 'none' && !evidence) {
    return { ok: false, handoffAllowed: false, code: 'observed_evidence_required', gatePolicy, audit: { ...base, decision: 'blocked' } };
  }
  if (gatePolicy.evidence !== 'none' && evidence?.ok !== true) {
    return { ok: false, handoffAllowed: false, code: evidence?.code || 'observed_evidence_invalid', gatePolicy, audit: { ...base, decision: 'blocked' } };
  }
  const observed = evidence?.evidence || evidence;
  if (gatePolicy.evidence === 'browser' && !policy.browserProviders.has(observed?.provider)) {
    return { ok: false, handoffAllowed: false, code: 'browser_provider_required', gatePolicy, audit: { ...base, decision: 'blocked' } };
  }
  if (request.status === 'succeeded') {
    if (!observed || observed.status !== 'completed') {
      return { ok: false, handoffAllowed: false, code: 'successful_evidence_required', gatePolicy, audit: { ...base, decision: 'blocked' } };
    }
    return { ok: true, handoffAllowed: false, code: 'attempt_succeeded_continue', gatePolicy, audit: { ...base, decision: 'continue_automatic' } };
  }
  if (gatePolicy.terminal === 'flow_completed') {
    return { ok: false, handoffAllowed: false, code: 'completion_gate_requires_success', gatePolicy, audit: { ...base, decision: 'blocked' } };
  }
  if (gatePolicy.requirement === 'named_human') {
    if (request.status !== 'human_required') {
      return { ok: false, handoffAllowed: false, code: 'human_gate_evidence_required', gatePolicy, audit: { ...base, decision: 'blocked' } };
    }
    if (observed && observed.status !== 'completed') {
      return { ok: false, handoffAllowed: false, code: 'human_gate_observation_failed', gatePolicy, audit: { ...base, decision: 'blocked' } };
    }
  } else {
    if (request.status !== 'failed' || !observed || observed.status !== 'failed') {
      return { ok: false, handoffAllowed: false, code: 'failed_attempt_evidence_required', gatePolicy, audit: { ...base, decision: 'blocked' } };
    }
  }
  return { ok: true, handoffAllowed: true, code: 'verified_handoff_allowed', gatePolicy, audit: { ...base, decision: 'handoff_allowed' } };
}

export function automationAuditPath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  return join(home, AUTOMATION_AUDIT_REL);
}

export function appendAutomationAudit(path, audit, now = new Date()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const row = { ...audit, timestamp: now.toISOString() };
  appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return row;
}
