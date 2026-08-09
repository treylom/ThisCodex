#!/usr/bin/env node
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
  withDetectedDefaults,
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
  if (found) return found.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return '';
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
const CONFIRMED_PATH_KEYS = [
  'confirmed_repo_root',
  'confirmed_workspace_root',
  'confirmed_bot_wd',
  'confirmed_state_dir',
  'confirmed_windows_profile',
  'confirmed_windows_skill_dir',
];

function applyConfirmedPath(state, key, value) {
  if (!value) return state;
  const abs = resolve(value);
  // repo_root must already exist (a real checkout); the other confirmed dirs may be
  // freshly chosen by the user, so apply mode creates them before path verification.
  if (mode === 'apply' && key !== 'confirmed_repo_root' && !existsSync(abs)) {
    mkdirSync(abs, { recursive: true });
    console.log(`Created: ${abs}`);
  }
  return confirmPath(state, key, abs);
}

function applyAnswers(state, answers) {
  let next = { ...state, answers: { ...(state.answers || {}), ...answers } };
  for (const key of CONFIRMED_PATH_KEYS) {
    if (answers[key]) {
      next = applyConfirmedPath(next, key, answers[key]);
      delete next.answers[key];
    }
  }
  return next;
}

function missingGuidedDecision(state) {
  if (mode !== 'apply' || !nonInteractive || !yes) return '';
  if (answersFile) return '';
  if (state.answers?.install_surface !== 'guided') return '';
  for (const key of ['confirmed_repo_root', 'confirmed_workspace_root', 'confirmed_bot_wd', 'confirmed_state_dir']) {
    if (!state[key]) return key;
  }
  return '';
}

function hasConfirmedInstallState(state) {
  return [
    'confirmed_repo_root',
    'confirmed_workspace_root',
    'confirmed_bot_wd',
    'confirmed_state_dir',
    'confirmed_windows_profile',
    'confirmed_windows_skill_dir',
    'confirmed_superpowers_checked',
  ].some(key => Boolean(state[key])) || state.placement_only === true;
}

if (mode === 'apply' && nonInteractive && !yes && !answersFile) {
  console.log('ThisCodex apply is running without a TTY.');
  console.log('Next command: thiscodex init --apply --yes --answers <answers.json>');
  process.exit(2);
}

let state = withDetectedDefaults(loadInstallState(), {
  repo_root: repoRoot,
  workspace_root: cwd,
  cwd,
  // Token and bridge state must default OUTSIDE the bot working directory —
  // the confirm_state_dir step promises exactly that, so Enter must not break it.
  state_dir: join(homedir(), '.thiscodex', 'state'),
  install_surface: 'guided',
  codex_skill_layer: 'user',
  codex_marketplace: 'no',
  codex_yolo: 'safe',
  progress_report_cadence: 'per_task',
  alias_consent: 'yes',
  daemon_guide: 'yes',
});
state.answers ||= {};
state.completed_steps ||= [];
state = applyConfirmedPath(state, 'confirmed_repo_root', arg('--repo-root'));
state = applyConfirmedPath(state, 'confirmed_workspace_root', arg('--workspace-root'));
state = applyConfirmedPath(state, 'confirmed_bot_wd', arg('--bot-wd'));
state = applyConfirmedPath(state, 'confirmed_state_dir', arg('--state-dir'));
if (arg('--codex-skill-layer')) state.answers.codex_skill_layer = arg('--codex-skill-layer');
if (arg('--codex-marketplace')) state.answers.codex_marketplace = arg('--codex-marketplace');
if (arg('--codex-yolo')) state.answers.codex_yolo = arg('--codex-yolo');
if (arg('--progress-report-cadence')) state.answers.progress_report_cadence = arg('--progress-report-cadence');
if (arg('--alias-consent')) state.answers.alias_consent = arg('--alias-consent');
if (arg('--daemon-guide')) state.answers.daemon_guide = arg('--daemon-guide');
if (arg('--install-surface')) state.answers.install_surface = arg('--install-surface');

if (answersFile) {
  state = applyAnswers(state, JSON.parse(readFileSync(answersFile, 'utf8')));
}

const missingDecision = missingGuidedDecision(state);
if (missingDecision) {
  console.log(`ThisCodex guided onboarding needs ${missingDecision}.`);
  console.log('Next command: thiscodex init --apply --answers <answers.json>');
  process.exit(2);
}
// doctor/smoke on a fresh (un-installed) machine run as 'check': confirmed-path steps stay
// non-fatal so the flow proves its own integrity end-to-end. rollout-materialized only verifies
// when there IS a codex thread (impossible pre-install), so check-mode loses no real coverage;
// an installed machine keeps the strict 'smoke'/'doctor' mode.
const flowMode = (command === 'doctor' || command === 'smoke') && !hasConfirmedInstallState(state) ? 'check' : mode;

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
        const prompt = promptForStep(step, state);
        if (!key.startsWith('confirmed_')) {
          // non-interactive (doctor/smoke): an answer-one-of prompt needs a valid choice;
          // 'check_only' fails its verify (e.g. install_surface ∈ {placement,guided}).
          // Fall back to the first declared choice so point checks can proceed.
          // wiki-path-optional is free text, not an enum — 'check_only' would land
          // as a literal (bogus) wiki path, so its silent default is '' (not
          // connected), matching the PRD: absence never blocks bot creation.
          const enumFallback = step.verify?.type === 'answer-one-of'
            ? String(step.verify.choices || '').split(',')[0].trim()
            : step.verify?.type === 'wiki-path-optional'
              ? ''
              : 'check_only';
          state.answers[key] ??= prompt.defaultValue || enumFallback;
        }
        return;
      }
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const prompt = promptForStep(step, state);
      const suffix = prompt.defaultValue ? ` [default: ${prompt.defaultValue}]` : '';
      const answer = (await rl.question(`${prompt.question}${suffix}: `)).trim();
      rl.close();
      const value = answer || prompt.defaultValue;
      if (!value) return;
      if (key.startsWith('confirmed_')) {
        state = applyConfirmedPath(state, key, value);
      } else {
        state.answers[key] = value;
      }
      return;
    }
    if (step.action === 'apply' && step.id === 'config_ceiling_patch') {
      if (ctx.mode !== 'apply') return;
      patchCodexConfig(homedir(), false, { yoloCeiling: true });
      return;
    }
    if (step.action === 'generate') {
      if (ctx.mode !== 'apply') return;
      if (step.id === 'alias_consent') console.log(aliasBlock(state));
      if (step.id === 'materialize_runner') materializeBotFiles(state);
    }
  },
  async verify(step) {
    const result = await verifyStep(step, state, process.env);
    // wiki-path-optional never fails (PRD: absence must never block bot
    // creation) — its advisory (missing path / not provided) surfaces here
    // instead of through the pass/fail event stream.
    if (step.verify?.type === 'wiki-path-optional' && result.message) {
      console.log(`[thiscodex] ${result.message}`);
    }
    return result;
  },
};

const result = await runFlow({
  steps: manifest.steps,
  ctx: { mode: flowMode, os: env.os, tools: env.tools, answers: state.answers, tty, nonInteractive, yes },
  handlers,
});

if (mode === 'apply' && result.ok) {
  const home = process.env.HOME || homedir();
  const install = applySkillInstall(repoRoot, home, state.answers.codex_skill_layer || 'user');
  console.log(`Installed skills (${install.installed.join(', ')}): ${join(repoRoot, 'skills')} -> ${dirname(install.dest)}`);
  const hint = marketplaceHint(repoRoot, state.answers.codex_marketplace === 'yes');
  if (hint) console.log(`Marketplace hint: ${hint}`);
  // PRD success criterion 8: no wiki path is a supported, non-blocking outcome —
  // point the operator at the sample-vault path instead of leaving it unsaid.
  if (state.answers.install_surface === 'guided' && !state.answers.wiki_path) {
    console.log('No Obsidian wiki (vault) connected. Start from a sample wiki: create an empty folder, then reconnect this bot to it (thiscodex init --apply --answers <answers.json> with wiki_path set).');
  }
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
