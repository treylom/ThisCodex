import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rejectProvisionalPath } from './state.mjs';
import { progressConfigForState, progressEnvForState } from './progress.mjs';

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
  const env = progressEnvForState(state);
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD="${plan.bot}"
export DISCORD_STATE_DIR="${plan.stateDir}"
export SESSION="${state.session || 'thiscodex'}"
export THISCODEX_PROGRESS_CADENCE="${env.THISCODEX_PROGRESS_CADENCE}"
export THISCODEX_HEARTBEAT_SEC="${env.THISCODEX_HEARTBEAT_SEC}"
export LAUNCH_CMD="${plan.infra}"
cd "${plan.repo}"
exec "${plan.repo}/scripts/launch.sh"
`;
}

export function infraScript(state) {
  const plan = planBotFiles(state);
  const session = state.session || 'thiscodex';
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD="${plan.bot}"
export DISCORD_STATE_DIR="${plan.stateDir}"
export BOT_NAME="\${BOT_NAME:-${session}}"
export THISCODEX_ROOT="${plan.repo}"
export CODEX_WS="\${CODEX_WS:-ws://127.0.0.1:4222}"
READY_LOG="\${READY_LOG:-/tmp/\${SESSION:-${session}}-bridge.log}"
cd "${plan.bot}"

# Reference wiring (supervised by launch.sh window 'infra' — restarts on exit):
#   1) codex app-server — headless runtime. Its output feeds READY_LOG, which
#      launch.sh greps ("app-server ready|Listening") before attaching the TUI.
#   2) examples/bot.py — reference bridge; the process that actually talks to
#      Discord and owns the sandbox per docs/yolo-bridge-contract.md.
python3 -c 'import sys, discord, websockets; sys.exit(0 if tuple(map(int, discord.__version__.split(".")[:2])) >= (2, 3) else 1)' 2>/dev/null || {
  echo "[thiscodex] bridge deps missing or too old (need discord.py>=2.3 + websockets) — run: python3 -m pip install -r ${plan.repo}/requirements.txt"
  exit 1
}
# READY_LOG is truncated (>) BY DESIGN: launch.sh's readiness gate greps it, and
# appending (>>) would let a PREVIOUS boot's "ready" line pass the gate before
# this app-server is actually up. One prior boot is kept in READY_LOG.prev so a
# crash loop (5s supervisor restarts) cannot erase its own evidence.
[ -f "\$READY_LOG" ] && mv -f "\$READY_LOG" "\$READY_LOG.prev"
codex app-server --listen "\$CODEX_WS" >"\$READY_LOG" 2>&1 &
APP_PID=\$!
trap 'kill \${APP_PID:-} \${BOT_PID:-} 2>/dev/null || true' EXIT
python3 "${plan.repo}/examples/bot.py" &
BOT_PID=\$!
# Exit when EITHER side dies so launch.sh's supervisor restarts the PAIR —
# a foreground-only bot.py left a half-dead infra when app-server died first.
# Portable poll: macOS ships bash 3.2 (no \`wait -n\`).
while kill -0 "\$APP_PID" 2>/dev/null && kill -0 "\$BOT_PID" 2>/dev/null; do
  sleep 5
done
exit 1
`;
}

export function aliasBlock(state) {
  const repo = rejectProvisionalPath(state.confirmed_repo_root);
  const bot = rejectProvisionalPath(state.confirmed_bot_wd);
  const stateDir = state.confirmed_state_dir ? rejectProvisionalPath(state.confirmed_state_dir) : '';
  const session = state.session || 'thiscodex';
  const yoloFile = stateDir ? `${stateDir}/.thiscodex-yolo` : `${bot}/.thiscodex-yolo`;
  const env = progressEnvForState(state);
  const progressEnv = `THISCODEX_PROGRESS_CADENCE=${shQuote(env.THISCODEX_PROGRESS_CADENCE)} THISCODEX_HEARTBEAT_SEC=${shQuote(env.THISCODEX_HEARTBEAT_SEC)}`;
  return [
    '# Source this block from your shell, or paste it into your own rc file if you want it permanent.',
    `alias thiscodex-start="cd ${shQuote(repo)} && BOT_WD=${shQuote(bot)} SESSION=${shQuote(session)} ${progressEnv} ./scripts/launch.sh"`,
    `alias thiscodex-attach="tmux attach -t ${session}"`,
    `alias thiscodex-tui="cd ${shQuote(repo)} && BOT_WD=${shQuote(bot)} tmux select-window -t ${session}:codex"`,
    `alias thiscodex-doctor="cd ${shQuote(repo)} && node bin/thiscodex.mjs doctor"`,
    `alias thiscodex-discord="cd ${shQuote(repo)} && BOT_WD=${shQuote(bot)} DISCORD_STATE_DIR=${shQuote(stateDir || bot)} SESSION=${shQuote(session)} ${progressEnv} ./scripts/launch.sh"`,
    `alias thiscodex-yolo-on="mkdir -p ${shQuote(stateDir || bot)} && touch ${shQuote(yoloFile)}"`,
    `alias thiscodex-yolo-off="rm -f ${shQuote(yoloFile)}"`,
  ].join('\n') + '\n';
}

export function materializeBotFiles(state) {
  const plan = planBotFiles(state);
  mkdirSync(plan.bot, { recursive: true });
  mkdirSync(plan.stateDir, { recursive: true });
  writeFileSync(join(plan.stateDir, 'progress-reporting.json'), JSON.stringify(progressConfigForState(state), null, 2) + '\n');
  writeFileSync(plan.run, runScript(state));
  writeFileSync(plan.infra, infraScript(state));
  chmodSync(plan.run, 0o755);
  chmodSync(plan.infra, 0o755);
  return plan;
}
