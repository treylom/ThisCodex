import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rejectProvisionalPath } from './state.mjs';

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function planBotFiles(state) {
  const repo = rejectProvisionalPath(state.confirmed_repo_root);
  const bot = rejectProvisionalPath(state.confirmed_bot_wd);
  const stateDir = rejectProvisionalPath(state.confirmed_state_dir);
  return {
    run: join(bot, 'run.sh'),
    infra: join(bot, 'infra-launch.sh'),
    repo,
    bot,
    stateDir,
  };
}

export function runScript(state) {
  const plan = planBotFiles(state);
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD="${plan.bot}"
export DISCORD_STATE_DIR="${plan.stateDir}"
export SESSION="${state.session || 'thiscodex'}"
export LAUNCH_CMD="${plan.infra}"
cd "${plan.repo}"
exec "${plan.repo}/scripts/launch.sh"
`;
}

export function infraScript(state) {
  const plan = planBotFiles(state);
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD="${plan.bot}"
export DISCORD_STATE_DIR="${plan.stateDir}"
cd "${plan.bot}"
echo "[thiscodex] start app-server + bridge here"
echo "[thiscodex] replace this guide command with your bridge daemon command"
`;
}

export function aliasBlock(state) {
  const repo = rejectProvisionalPath(state.confirmed_repo_root);
  const bot = rejectProvisionalPath(state.confirmed_bot_wd);
  const stateDir = state.confirmed_state_dir ? rejectProvisionalPath(state.confirmed_state_dir) : '';
  const session = state.session || 'thiscodex';
  const yoloFile = stateDir ? `${stateDir}/.thiscodex-yolo` : `${bot}/.thiscodex-yolo`;
  return [
    `alias thiscodex-start="cd ${shQuote(repo)} && BOT_WD=${shQuote(bot)} SESSION=${shQuote(session)} ./scripts/launch.sh"`,
    `alias thiscodex-attach="tmux attach -t ${session}"`,
    `alias thiscodex-tui="cd ${shQuote(repo)} && BOT_WD=${shQuote(bot)} tmux select-window -t ${session}:codex"`,
    `alias thiscodex-doctor="cd ${shQuote(repo)} && node bin/thiscodex.mjs doctor"`,
    `alias thiscodex-discord="cd ${shQuote(repo)} && BOT_WD=${shQuote(bot)} DISCORD_STATE_DIR=${shQuote(stateDir || bot)} SESSION=${shQuote(session)} ./scripts/launch.sh"`,
    `alias thiscodex-yolo-on="mkdir -p ${shQuote(stateDir || bot)} && touch ${shQuote(yoloFile)}"`,
    `alias thiscodex-yolo-off="rm -f ${shQuote(yoloFile)}"`,
  ].join('\n') + '\n';
}

export function materializeBotFiles(state) {
  const plan = planBotFiles(state);
  mkdirSync(plan.bot, { recursive: true });
  mkdirSync(plan.stateDir, { recursive: true });
  writeFileSync(plan.run, runScript(state));
  writeFileSync(plan.infra, infraScript(state));
  chmodSync(plan.run, 0o755);
  chmodSync(plan.infra, 0o755);
  return plan;
}
