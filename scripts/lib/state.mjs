import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_FILE = '.thiscodex-init-state.json';

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
