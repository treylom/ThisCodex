#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectEnv } from '../scripts/lib/detect.mjs';
import { msg } from '../scripts/lib/i18n.mjs';
import { loadState, saveState, mergeAnswer } from '../scripts/lib/state.mjs';
import { nextQuestion } from '../scripts/lib/questions.mjs';
import { applySkillInstall, patchCodexConfig, marketplaceHint } from '../scripts/lib/apply.mjs';
import { runnerFile } from '../scripts/lib/runner.mjs';

const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const arg = name => {
  const found = args.find(a => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : '';
};

const mode = has('--apply') ? 'apply' : 'check';
const nonInteractive = has('--non-interactive');
const repoRoot = process.env.THISCODEX_REPO_ROOT || new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const cwd = process.cwd();
const env = detectEnv();
let state = loadState(cwd);
const tone = arg('--tone') || state.answers.tone || 'plain';

if (has('--resume')) {
  const { resumeSummary } = await import('../scripts/lib/state.mjs');
  console.log(resumeSummary(state));
}

console.log(`ThisCodex installer (${mode})`);
console.log(`OS=${env.os} Node=${env.node} codex=${env.tools.codex} tmux=${env.tools.tmux}`);
console.log(msg('placement', tone));
console.log(`${msg('auth', tone)} ${env.codexAuth.present ? 'detected' : 'not detected'} (${env.codexAuth.path})`);

if (nonInteractive) {
  let ctx = { os: env.os, answers: state.answers };
  let q;
  while ((q = nextQuestion(ctx, state.completed_steps))) {
    state = mergeAnswer(state, q.id, state.answers[q.id] ?? q.default);
    ctx = { os: env.os, answers: state.answers };
  }
} else {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let ctx = { os: env.os, answers: state.answers };
  let q;
  while ((q = nextQuestion(ctx, state.completed_steps))) {
    const answer = (await rl.question(`${q.ask} [${q.choices.join('/')}] (default ${q.default}): `)).trim() || q.default;
    state = mergeAnswer(state, q.id, answer);
    ctx = { os: env.os, answers: state.answers };
  }
  rl.close();
}

if (mode === 'check') {
  console.log(msg('checkOnly', tone));
  console.log(`Skill layer: ${state.answers.codex_skill_layer || 'user'} -> ${state.answers.codex_skill_layer === 'repo' ? '.agents/skills/thiscodex' : '~/.agents/skills/thiscodex'}`);
  const hint = marketplaceHint(repoRoot, state.answers.codex_marketplace === 'yes');
  if (hint) console.log(`Marketplace hint: ${hint}`);
  process.exit(0);
}

const home = process.env.HOME || homedir();
const layer = state.answers.codex_skill_layer || 'user';
const install = applySkillInstall(repoRoot, home, layer);
console.log(`Installed skill: ${install.source} -> ${install.dest}`);

if (state.answers.codex_config === 'patch') {
  const cfg = patchCodexConfig(home, false, {
    yoloCeiling: state.answers.codex_yolo === 'config_ceiling_patch',
  });
  console.log(`Codex config: ${cfg.changed ? 'patched' : 'unchanged'} ${cfg.path}`);
}

if (state.answers.daemon_guide === 'yes') {
  if (state.answers.codex_yolo === 'config_ceiling_patch') {
    console.log('WARNING: YOLO opt-in selected: ~/.codex/config.toml ceiling will allow danger-full-access/never. Use only on a host you control.');
  } else if (state.answers.codex_yolo !== 'safe') {
    console.log('WARNING: YOLO guide selected: bridge flags alone may be clamped by app-server defaults unless config.toml ceiling is also opted in.');
  }
  const runner = runnerFile(env.os, { label: 'thiscodex', command: join(repoRoot, 'scripts', 'launch.sh') });
  console.log(`Runner guide file suggested: ${runner.filename}`);
  console.log(runner.hint);
}

saveState(cwd, state);
console.log(msg('applyDone', tone));
