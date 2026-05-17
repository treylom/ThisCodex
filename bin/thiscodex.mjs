#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectEnv } from '../scripts/lib/detect.mjs';
import { loadManifest } from '../scripts/lib/manifest.mjs';
import { runFlow } from '../scripts/lib/flow-runner.mjs';
import { msg } from '../scripts/lib/i18n.mjs';
import {
  confirmPath,
  loadInstallState,
  resumeSummary,
  saveInstallState,
} from '../scripts/lib/state.mjs';
import { verifyStep } from '../scripts/lib/doctor.mjs';
import { applySkillInstall, marketplaceHint, patchCodexConfig } from '../scripts/lib/apply.mjs';
import { aliasBlock, materializeBotFiles } from '../scripts/lib/materialize.mjs';
import { promptForStep } from '../scripts/lib/prompts.mjs';

const args = process.argv.slice(2);
const command = ['init', 'doctor', 'smoke'].includes(args[0]) ? args.shift() : 'init';
const has = flag => args.includes(flag);
const arg = name => {
  const found = args.find(a => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : '';
};

const mode = command === 'doctor' ? 'doctor' : command === 'smoke' ? 'smoke' : has('--apply') ? 'apply' : 'check';
const tty = process.stdin.isTTY === true;
const nonInteractive = has('--non-interactive') || !tty;
const yes = has('--yes');
const answersFile = arg('--answers');
const repoRoot = resolve(process.env.THISCODEX_REPO_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const cwd = process.cwd();
const env = detectEnv();
const tone = arg('--tone') || 'plain';

function missingGuidedDecision(state) {
  if (mode !== 'apply' || !nonInteractive || !yes) return '';
  if (answersFile) return '';
  if (state.answers?.install_surface !== 'guided') return '';
  for (const key of ['confirmed_repo_root', 'confirmed_workspace_root', 'confirmed_bot_wd', 'confirmed_state_dir']) {
    if (!state[key]) return key;
  }
  return '';
}

if (mode === 'apply' && nonInteractive && !yes && !answersFile) {
  console.log('ThisCodex apply is running without a TTY.');
  console.log('Next command: thiscodex init --apply --yes --answers <answers.json>');
  process.exit(2);
}

let state = loadInstallState();
state.answers ||= {};
state.completed_steps ||= [];
state.confirmed_repo_root ||= arg('--repo-root') || repoRoot;
state.confirmed_bot_wd ||= arg('--bot-wd') || cwd;
state.confirmed_state_dir ||= arg('--state-dir') || cwd;
if (arg('--repo-root')) state = confirmPath(state, 'confirmed_repo_root', resolve(arg('--repo-root')));
if (arg('--bot-wd')) state = confirmPath(state, 'confirmed_bot_wd', resolve(arg('--bot-wd')));
if (arg('--state-dir')) state = confirmPath(state, 'confirmed_state_dir', resolve(arg('--state-dir')));
state.answers.codex_skill_layer ||= arg('--codex-skill-layer') || 'user';
state.answers.codex_marketplace ||= arg('--codex-marketplace') || 'no';
state.answers.codex_yolo ||= arg('--codex-yolo') || 'safe';
state.answers.alias_consent ||= arg('--alias-consent') || 'no';
state.answers.daemon_guide ||= arg('--daemon-guide') || 'no';
state.answers.install_surface ||= arg('--install-surface') || 'guided';

if (answersFile) {
  const { readFileSync } = await import('node:fs');
  state.answers = { ...state.answers, ...JSON.parse(readFileSync(answersFile, 'utf8')) };
}
for (const key of ['confirmed_repo_root', 'confirmed_bot_wd', 'confirmed_state_dir']) {
  delete state.answers[key];
}

const missingDecision = missingGuidedDecision(state);
if (missingDecision) {
  console.log(`ThisCodex guided onboarding needs ${missingDecision}.`);
  console.log('Next command: thiscodex init --apply --answers <answers.json>');
  process.exit(2);
}

if (has('--resume')) {
  console.log(resumeSummary(state));
}

const manifest = loadManifest(new URL('../install/thiscodex.install.json', import.meta.url));
console.log(`ThisCodex ${command} (${mode})`);
console.log(`OS=${env.os} Node=${env.node} codex=${env.tools.codex} tmux=${env.tools.tmux}`);
console.log(msg('placement', tone));
console.log(`${msg('auth', tone)} ${env.codexAuth.present ? 'detected' : 'not detected'} (${env.codexAuth.path})`);
if (nonInteractive) {
  console.log(msg('non_tty_next_command', tone));
}

const handlers = {
  explain(step) {
    console.log(`\n[${step.id}] ${step.reason}`);
  },
  async action(step, ctx) {
    if (step.action === 'detect' || step.action === 'check' || step.action === 'guide') return;
    if (step.action === 'prompt') {
      const key = step.verify?.state_key || step.id;
      if (ctx.tty === false || ctx.nonInteractive) {
        if (!key.startsWith('confirmed_')) state.answers[key] ??= 'check_only';
        return;
      }
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const prompt = promptForStep(step, state);
      const suffix = prompt.defaultValue ? ` [default: ${prompt.defaultValue}]` : '';
      const answer = (await rl.question(`${prompt.question}${suffix}: `)).trim();
      rl.close();
      if (answer) state.answers[key] = answer;
      else if (prompt.defaultValue && !key.startsWith('confirmed_')) state.answers[key] = prompt.defaultValue;
      return;
    }
    if (step.action === 'apply' && step.id === 'config_ceiling_patch') {
      patchCodexConfig(homedir(), false, { yoloCeiling: true });
      return;
    }
    if (step.action === 'generate') {
      if (step.id === 'alias_consent') console.log(aliasBlock(state));
      if (step.id === 'materialize_runner') materializeBotFiles(state);
    }
  },
  async verify(step) {
    return verifyStep(step, state, process.env);
  },
};

const result = await runFlow({
  steps: manifest.steps,
  ctx: { mode, os: env.os, tools: env.tools, answers: state.answers, tty, nonInteractive, yes },
  handlers,
});

if (mode === 'apply' && result.ok) {
  const home = process.env.HOME || homedir();
  const install = applySkillInstall(repoRoot, home, state.answers.codex_skill_layer || 'user');
  console.log(`Installed skill: ${install.source} -> ${install.dest}`);
  const hint = marketplaceHint(repoRoot, state.answers.codex_marketplace === 'yes');
  if (hint) console.log(`Marketplace hint: ${hint}`);
  saveInstallState(state);
}

if (mode === 'doctor' && !existsSync(state.confirmed_bot_wd || '')) {
  console.log('Doctor note: BOT_WD is not confirmed yet.');
}

if (!result.ok) {
  console.error(`Stopped at ${result.failed_step}: ${result.reason}`);
  console.error(`Next command: ${result.next_command}`);
  process.exit(2);
}

console.log(`Next command: thiscodex ${command === 'init' ? 'doctor --non-interactive' : 'init --apply --yes'}`);
console.log(`${command} ${mode} completed.`);
