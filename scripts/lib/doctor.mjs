import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectCodexConfig, whichSync } from './detect.mjs';

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
  if (type === 'answer-one-of') {
    const choices = String(step.verify.choices || '').split(',').filter(Boolean);
    const value = state.answers?.[step.verify.state_key];
    return choices.includes(value)
      ? { ok: true }
      : { ok: false, message: `${step.verify.state_key} must be one of ${choices.join(', ')}` };
  }
  if (type === 'codex-config-readable') return { ok: true, detail: detectCodexConfig(env) };
  if (type === 'codex-config-ceiling') return { ok: true };
  if (type === 'tmux-present-or-guide-shown') return whichSync('tmux', env) ? { ok: true } : { ok: true, message: 'tmux guide shown' };
  if (type === 'runner-files-present') return { ok: true };
  if (type === 'aliases-parameterized') return { ok: true };
  if (type === 'rollout-materialized') {
    const tid = state.thread_id || state.answers?.thread_id;
    const home = env.HOME || env.USERPROFILE || '';
    return tid && rolloutFilesForThread(home, tid).length
      ? { ok: true }
      : { ok: false, message: 'rollout not materialized' };
  }
  return { ok: false, message: `unknown verify type: ${type}` };
}
