import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const AUTOMATION_POLICY_REL = 'install/automation-policy.yaml';
export const AUTOMATION_AUDIT_REL = '.config/thiscodex/automation-attempts.jsonl';
const MODES = new Set(['auto', 'manual']);
const STATUSES = new Set(['succeeded', 'failed', 'human_required']);

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

/**
 * Parse only the shipped automation-policy.yaml shape. This is deliberately not
 * advertised as a general YAML parser: rejecting unknown syntax is safer than
 * silently accepting a policy the installer did not understand.
 */
export function parseAutomationPolicyYaml(text) {
  const policy = {
    schemaVersion: null,
    defaultMode: null,
    browserToolsRequired: null,
    manualAllowedWithoutAttempt: new Map(),
  };
  const seen = new Set();
  let inInstall = false;
  let inManual = false;
  let pending = null;

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
      inManual = false;
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
    if (line === '  manual_allowed_without_attempt:') {
      unique(seen, 'install.manual_allowed_without_attempt');
      inManual = true;
      continue;
    }
    if (inManual && (match = line.match(/^    - name:\s*([A-Za-z0-9_-]+)$/))) {
      if (pending && !pending.reason) throw new Error(`manual gate ${pending.name} missing reason`);
      pending = { name: match[1], reason: '' };
      if (policy.manualAllowedWithoutAttempt.has(pending.name)) throw new Error(`duplicate manual gate: ${pending.name}`);
      policy.manualAllowedWithoutAttempt.set(pending.name, '');
      continue;
    }
    if (inManual && (match = line.match(/^      reason:\s*(.+)$/))) {
      if (!pending) throw new Error(`manual gate reason without name at line ${lineNumber}`);
      if (pending.reason) throw new Error(`duplicate YAML key: manual gate ${pending.name}.reason`);
      pending.reason = scalar(match[1]);
      policy.manualAllowedWithoutAttempt.set(pending.name, pending.reason);
      continue;
    }
    throw new Error(`unknown or unsupported YAML field at line ${lineNumber}: ${line}`);
  }

  if (pending && !pending.reason) throw new Error(`manual gate ${pending.name} missing reason`);
  if (policy.schemaVersion !== 1) throw new Error(`automation policy schema_version must be 1`);
  if (!MODES.has(policy.defaultMode)) throw new Error('automation policy default_mode must be auto or manual');
  if (typeof policy.browserToolsRequired !== 'boolean') throw new Error('automation policy browser_tools_required missing');
  if (!seen.has('install.manual_allowed_without_attempt')) throw new Error('automation policy manual_allowed_without_attempt missing');
  return policy;
}

export function loadAutomationPolicy(path = AUTOMATION_POLICY_REL) {
  return parseAutomationPolicyYaml(readFileSync(path, 'utf8'));
}

function clean(value, max = 500) {
  return String(value || '')
    .replace(/[A-Za-z0-9_.-]{50,}/g, '[REDACTED_LONG_VALUE]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max);
}

export function resolveAutomationMode({ explicit, state, policy }) {
  const value = explicit || state?.answers?.automation_mode || policy.defaultMode;
  if (!MODES.has(value)) throw new Error('automation mode must be auto or manual');
  return value;
}

export function decideManualHandoff({ gate, mode, policy, attempt = {} }) {
  if (!gate || !/^[A-Za-z0-9_-]+$/.test(gate)) throw new Error('gate must be a stable ASCII identifier');
  if (!MODES.has(mode)) throw new Error('mode must be auto or manual');
  const listedReason = policy.manualAllowedWithoutAttempt.get(gate) || '';
  const base = {
    schema_version: 1,
    gate,
    mode,
    attempted: attempt.attempted === true,
    status: clean(attempt.status),
    provider: clean(attempt.provider),
    operation: clean(attempt.operation),
    reason: clean(attempt.reason),
    surface: clean(attempt.surface),
    browser_terminal_reason: clean(attempt.browserTerminalReason),
  };

  if (mode === 'manual') {
    return { ok: true, handoffAllowed: true, code: 'manual_mode', audit: { ...base, decision: 'handoff_allowed' } };
  }

  if (attempt.surface === 'browser' && policy.browserToolsRequired) {
    if (!attempt.provider) {
      return { ok: false, handoffAllowed: false, code: 'browser_provider_required', audit: { ...base, decision: 'blocked' } };
    }
    if (!attempt.browserTerminalReason) {
      return { ok: false, handoffAllowed: false, code: 'browser_terminal_reason_required', audit: { ...base, decision: 'blocked' } };
    }
  }

  if (listedReason) {
    if (!attempt.operation) {
      return { ok: false, handoffAllowed: false, code: 'attempt_operation_required', audit: { ...base, decision: 'blocked' } };
    }
    if (attempt.status !== 'human_required' || !attempt.reason) {
      return { ok: false, handoffAllowed: false, code: 'human_gate_evidence_required', audit: { ...base, decision: 'blocked' } };
    }
    return {
      ok: true,
      handoffAllowed: true,
      code: 'declared_human_security_gate',
      audit: { ...base, declared_reason: listedReason, decision: 'handoff_allowed' },
    };
  }

  if (attempt.attempted !== true) {
    return { ok: false, handoffAllowed: false, code: 'attempt_required', audit: { ...base, decision: 'blocked' } };
  }
  if (!STATUSES.has(attempt.status) || attempt.status === 'human_required') {
    return { ok: false, handoffAllowed: false, code: 'invalid_attempt_status', audit: { ...base, decision: 'blocked' } };
  }
  if (!attempt.operation) {
    return { ok: false, handoffAllowed: false, code: 'attempt_operation_required', audit: { ...base, decision: 'blocked' } };
  }
  if (attempt.status === 'failed' && !attempt.reason) {
    return { ok: false, handoffAllowed: false, code: 'failure_reason_required', audit: { ...base, decision: 'blocked' } };
  }
  if (attempt.status === 'succeeded') {
    return { ok: true, handoffAllowed: false, code: 'attempt_succeeded_continue', audit: { ...base, decision: 'continue_automatic' } };
  }
  return { ok: true, handoffAllowed: true, code: 'attempt_failed_handoff_allowed', audit: { ...base, decision: 'handoff_allowed' } };
}

export function automationAuditPath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  return join(home, AUTOMATION_AUDIT_REL);
}

export function appendAutomationAudit(path, audit, now = new Date()) {
  mkdirSync(dirname(path), { recursive: true });
  const row = { ...audit, timestamp: now.toISOString() };
  appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return row;
}
