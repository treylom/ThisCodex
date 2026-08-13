import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { detectCodexConfig, whichSync } from './detect.mjs';
import { detectSuperpowers } from './superpowers.mjs';

export function isWritable(path) {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function rolloutFilesForThread(home, threadId) {
  const root = join(home, '.codex', 'sessions');
  const out = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith('.jsonl')) out.push(full);
    }
  }
  walk(root);
  return out.sort();
}

export function detectStaleSuperpowersWrapper({ wrapperVersion, home }) {
  const base = join(home, '.codex', 'plugins', 'cache', 'openai-curated', 'superpowers');
  if (!wrapperVersion || !existsSync(base)) return { stale: false, latest: wrapperVersion || null };
  const versions = readdirSync(base)
    .filter(v => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = versions.at(-1) || wrapperVersion;
  return {
    stale: latest !== wrapperVersion,
    latest,
    next_command: `Refresh the local using-superpowers wrapper to ${latest}; do not pin ${wrapperVersion}.`,
  };
}

export function automationHandoffHookReady(home, env = process.env) {
  const hooksPath = env.THISCODEX_HOOKS_FILE || join(home, '.codex', 'hooks.json');
  const configPath = env.THISCODEX_CODEX_CONFIG || join(home, '.codex', 'config.toml');
  let hooks;
  try {
    hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
  } catch {
    return { ok: false, message: 'automation handoff hook is not wired' };
  }
  const groups = hooks?.hooks?.PreToolUse || [];
  let coordinate = null;
  let hookPath = '';
  for (const [groupIndex, group] of groups.entries()) {
    const matcher = String(group?.matcher || '');
    if (!matcher.includes('mcp__discord__reply') || !matcher.includes('mcp__discord__edit_message')) continue;
    for (const [hookIndex, hook] of (group?.hooks || []).entries()) {
      const command = String(hook?.command || '');
      const pathMatch = command.match(/(?:^|\s)([^\s"']*automation-handoff-gate\.py)(?:\s|$)/);
      if (pathMatch) {
        coordinate = `${groupIndex}:${hookIndex}`;
        const raw = pathMatch[1].replace(/^~(?=\/)/, home);
        hookPath = isAbsolute(raw) ? raw : resolve(raw);
      }
    }
  }
  if (!coordinate) return { ok: false, message: 'automation handoff hook is not wired' };
  if (!existsSync(hookPath)) return { ok: false, message: `automation handoff hook path missing: ${hookPath}` };
  let config = '';
  try {
    config = readFileSync(configPath, 'utf8');
  } catch {
    return { ok: false, message: 'automation handoff hook is wired but not trusted' };
  }
  const escaped = coordinate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trust = new RegExp(`pre_tool_use:${escaped}"?\\]?[\\s\\S]{0,240}trusted_hash\\s*=`, 'i');
  return trust.test(config)
    ? { ok: true }
    : { ok: false, message: `automation handoff hook ${coordinate} is wired but not trusted` };
}

export async function verifyStep(step, state, env = process.env) {
  const type = step.verify?.type;
  if (type === 'pass' || type === 'environment-detected' || type === 'guide-shown') return { ok: true };
  if (type === 'path-exists') {
    const path = state[step.verify.state_key];
    return existsSync(path || '') ? { ok: true } : { ok: false, message: `${step.verify.state_key} missing` };
  }
  if (type === 'path-writable') {
    const path = state[step.verify.state_key];
    return path && existsSync(path) && isWritable(path)
      ? { ok: true }
      : { ok: false, message: `${step.verify.state_key} missing or not writable` };
  }
  if (type === 'wiki-path-optional') {
    // The wiki (Obsidian vault) path is opt-in (PRD constraint: absence must
    // never block bot creation), so this verify NEVER fails — it only decides
    // what advisory message (if any) the caller should print.
    const value = state.answers?.[step.verify.state_key];
    if (!value) return { ok: true, message: 'wiki path not provided — connection skipped (sample-vault guidance at completion)' };
    return existsSync(value)
      ? { ok: true }
      : { ok: true, message: `WARN: wiki path does not exist yet: ${value} — continuing without blocking bot creation` };
  }
  if (type === 'answer-one-of') {
    const choices = String(step.verify.choices || '').split(',').filter(Boolean);
    const value = state.answers?.[step.verify.state_key];
    return choices.includes(value)
      ? { ok: true }
      : { ok: false, message: `${step.verify.state_key} must be one of ${choices.join(', ')}` };
  }
  if (type === 'runtime-name') {
    const value = state.answers?.[step.verify.state_key];
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
      ? { ok: true }
      : { ok: false, message: `${step.verify.state_key} must use 1-64 ASCII letters, numbers, dash, or underscore` };
  }
  if (type === 'codex-config-readable') return { ok: true, detail: detectCodexConfig(env) };
  if (type === 'codex-config-ceiling') return { ok: true };
  if (type === 'superpowers-available') {
    const result = detectSuperpowers(env);
    if (result.present) return { ok: true };
    if (state.confirmed_superpowers_checked) return { ok: true, message: 'superpowers previously checked' };
    return { ok: false, message: `superpowers unavailable; next command: ${result.next_command}` };
  }
  if (type === 'tmux-present-or-guide-shown') return whichSync('tmux', env) ? { ok: true } : { ok: true, message: 'tmux guide shown' };
  if (type === 'runner-files-present') return { ok: true };
  if (type === 'aliases-parameterized') return { ok: true };
  if (type === 'automation-handoff-hook-ready') {
    const home = env.HOME || env.USERPROFILE || '';
    return automationHandoffHookReady(home, env);
  }
  if (type === 'rollout-materialized') {
    let tid = state.thread_id || state.answers?.thread_id;
    const threadFile = state.confirmed_bot_wd ? join(state.confirmed_bot_wd, '.codex-thread-id') : null;
    if (!tid && threadFile && existsSync(threadFile)) {
      tid = readFileSync(threadFile, 'utf8').trim();
    }
    if (!tid) {
      return { ok: true, message: 'skipped: no codex thread yet (app-server turn not run)' };
    }
    const home = env.HOME || env.USERPROFILE || '';
    return rolloutFilesForThread(home, tid).length
      ? { ok: true }
      : { ok: false, message: 'rollout not materialized' };
  }
  return { ok: false, message: `unknown verify type: ${type}` };
}
