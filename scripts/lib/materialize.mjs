import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
# PY: the ONE python this script both probes and runs. A venv install only
# counts if THISCODEX_PYTHON points at that venv's python — shell activation
# does not cross into tmux windows (launch.sh bakes this var through).
PY="\${THISCODEX_PYTHON:-python3}"
cd "${plan.bot}"

# Reference wiring (supervised by launch.sh window 'infra' — restarts on exit):
#   1) codex app-server — headless runtime. Its output feeds READY_LOG, which
#      launch.sh greps ("app-server ready|Listening") before attaching the TUI.
#   2) examples/bot.py — reference bridge; the process that actually talks to
#      Discord and owns the sandbox per docs/yolo-bridge-contract.md.
"\$PY" -c 'import sys, discord, websockets; sys.exit(0 if tuple(map(int, discord.__version__.split(".")[:2])) >= (2, 3) else 1)' 2>/dev/null || {
  echo "[thiscodex] bridge deps missing or too old for \$PY (need discord.py>=2.3 + websockets)"
  echo "[thiscodex]   install: \$PY -m pip install -r ${plan.repo}/requirements.txt"
  echo "[thiscodex]   Ubuntu 24.04+/Debian (PEP 668 'externally-managed-environment'), either:"
  echo "[thiscodex]   - add --break-system-packages (installs into system python), or"
  echo "[thiscodex]   - uv venv && install there, then set THISCODEX_PYTHON to that venv's python before run.sh"
  exit 1
}
# READY_LOG is truncated (>) BY DESIGN: launch.sh's readiness gate greps it, and
# appending (>>) would let a PREVIOUS boot's "ready" line pass the gate before
# this app-server is actually up. One prior boot is kept in READY_LOG.prev so a
# crash loop (5s supervisor restarts) cannot erase its own evidence.
[ -f "\$READY_LOG" ] && mv -f "\$READY_LOG" "\$READY_LOG.prev"
# No instruction file = the model answers in text and calls NO tool (mute bot,
# zero errors — 2026-08-09 field). init materializes it; this is the backstop.
[ -f "\$BOT_WD/AGENTS.md" ] || \\
  echo "[thiscodex][WARN] \$BOT_WD/AGENTS.md missing — the model never learns the Discord Reply Rule. See README §3.3."
# The reply path needs the discord MCP server registered in ~/.codex/config.toml
# ([mcp_servers.discord] — see README "bot logs in but never replies"). Absent
# registration = codex has no reply tool at all; warn loudly, do not die (the
# bridge itself still runs and receives).
command grep -q '^\\[mcp_servers.discord\\]' "\$HOME/.codex/config.toml" 2>/dev/null || \\
  echo "[thiscodex][WARN] ~/.codex/config.toml has no [mcp_servers.discord] — codex cannot send Discord replies. See README troubleshooting."
# -c pins the discord tool to THIS bot's state dir (token + access.json) even
# when config.toml's default entry points at another bot — the 2026-08-09
# wrong-bot field failure. Same mechanism as the reference deployment.
codex app-server -c "mcp_servers.discord.env.DISCORD_STATE_DIR=\$DISCORD_STATE_DIR" --listen "\$CODEX_WS" >"\$READY_LOG" 2>&1 &
APP_PID=\$!
trap 'kill \${APP_PID:-} \${BOT_PID:-} 2>/dev/null || true' EXIT
"\$PY" "${plan.repo}/examples/bot.py" &
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
  // 막힘 20 (2026-08-09 WSL, root-cause confirmed by timing: 0 reply-tool calls
  // before an instruction file existed, 7 after): config points codex at
  // SOUL.md/AGENTS.md as project docs, but nothing ever CREATED one — so the
  // model never learns that its text does not reach Discord. Materialize the
  // reference AGENTS.md into the bot WD; never overwrite an existing one.
  const agentsDoc = join(plan.bot, 'AGENTS.md');
  const agentsSrc = join(plan.repo, 'examples', 'AGENTS.md');
  if (!existsSync(agentsDoc) && existsSync(agentsSrc)) {
    copyFileSync(agentsSrc, agentsDoc);
  }
  return plan;
}
