import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STATE_FILE = '.thiscodex-init-state.json';
export const INSTALL_STATE_REL = '.config/thiscodex/install-state.json';

export function loadState(repoRoot) {
  const path = join(repoRoot, STATE_FILE);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {}
  }
  return { version: 1, answers: {}, completed_steps: [], planned_bots: [], updated_iso: null };
}

export function mergeAnswer(state, stepId, value) {
  const next = structuredClone(state);
  next.answers[stepId] = value;
  if (!next.completed_steps.includes(stepId)) next.completed_steps.push(stepId);
  next.updated_iso = new Date().toISOString();
  return next;
}

export function saveState(repoRoot, state) {
  writeFileSync(join(repoRoot, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

export function resumeSummary(state) {
  if (!state.completed_steps.length) return '이전 진행 기록 없음 — 처음부터 시작합니다.';
  return `지난 진행 (${state.completed_steps.length}단계 완료):\n` +
    state.completed_steps.map(id => `  · ${id}: ${JSON.stringify(state.answers[id])}`).join('\n') +
    '\n남은 단계만 이어서 진행합니다.';
}

export function statePath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  return join(home, INSTALL_STATE_REL);
}

const PROVISIONAL_BOT_RE = new RegExp(['thiscodex', 'current', 'bot'].join('-'));

export function rejectProvisionalPath(value) {
  if (PROVISIONAL_BOT_RE.test(value || '')) {
    throw new Error(`provisional path cannot be persisted: ${value}`);
  }
  return value;
}

export function loadInstallState(env = process.env) {
  const path = statePath(env);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { version: 2, answers: {}, completed_steps: [], updated_iso: null };
    }
  }
  return {
    version: 2,
    answers: {},
    completed_steps: [],
    confirmed_repo_root: null,
    confirmed_bot_wd: null,
    confirmed_state_dir: null,
    updated_iso: null,
  };
}

export function confirmPath(state, key, value) {
  if (!['confirmed_repo_root', 'confirmed_bot_wd', 'confirmed_state_dir'].includes(key)) {
    throw new Error(`unknown confirmed path key: ${key}`);
  }
  return { ...state, [key]: rejectProvisionalPath(value), updated_iso: new Date().toISOString() };
}

export function saveInstallState(state, env = process.env) {
  const path = statePath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
  return path;
}
