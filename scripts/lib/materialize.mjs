import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rejectProvisionalPath } from './state.mjs';
import { progressConfigForState, progressEnvForState } from './progress.mjs';

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function planBotFiles(state) {
  // A missing field otherwise surfaces later as mkdirSync(undefined)
  // TypeError / a literal "undefined" in generated shell — name the actual
  // problem at the door instead.
  for (const key of ['confirmed_repo_root', 'confirmed_bot_wd', 'confirmed_state_dir']) {
    if (!state[key]) throw new Error(`${key} missing — guided init incomplete`);
  }
  const repo = rejectProvisionalPath(state.confirmed_repo_root);
  const bot = rejectProvisionalPath(state.confirmed_bot_wd);
  const stateDir = rejectProvisionalPath(state.confirmed_state_dir);
  return {
    run: join(bot, 'run.sh'),
    infra: join(bot, 'infra-launch.sh'),
    repo,
    bot,
    stateDir,
    // Wiki (Obsidian vault) path is OPTIONAL (PRD: its absence never blocks bot
    // creation) — '' when not connected, never a provisional-path check target.
    wikiPath: state.answers?.wiki_path || '',
  };
}

export function runScript(state) {
  const plan = planBotFiles(state);
  const env = progressEnvForState(state);
  // Only present when a wiki (vault) path was actually connected — an unset
  // var (not an empty string) is what "wiki not provided" looks like downstream.
  // shQuote (not a bare double-quoted interpolation): wiki_path is FREE TEXT
  // that never fails verify (wiki-path-optional design), so it is the one
  // guided-init answer with no path-exists/enum gate upstream. A double-quoted
  // "${value}" lets the shell re-interpret it at boot ($HOME expansion, a
  // stray " breaking the quoting, or a trailing "; ...; " running as a
  // command). Single-quoted shQuote lands the answer as a value, never code
  // (2026-08-10 review finding — confirmed by scratchpad/invariant_wiki_seed.mjs).
  const wikiExport = plan.wikiPath ? `export THISCODEX_WIKI_PATH=${shQuote(plan.wikiPath)}\n` : '';
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD="${plan.bot}"
export DISCORD_STATE_DIR="${plan.stateDir}"
export SESSION="${state.session || 'thiscodex'}"
export THISCODEX_PROGRESS_CADENCE="${env.THISCODEX_PROGRESS_CADENCE}"
export THISCODEX_HEARTBEAT_SEC="${env.THISCODEX_HEARTBEAT_SEC}"
${wikiExport}export LAUNCH_CMD="${plan.infra}"
cd "${plan.repo}"
exec "${plan.repo}/scripts/launch.sh"
`;
}

export function infraScript(state) {
  const plan = planBotFiles(state);
  const session = state.session || 'thiscodex';
  // Same shQuote requirement as runScript above — wiki_path is ungated free
  // text and must land as a value, never be re-interpreted by the shell.
  const wikiExport = plan.wikiPath ? `export THISCODEX_WIKI_PATH=${shQuote(plan.wikiPath)}\n` : '';
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD="${plan.bot}"
export DISCORD_STATE_DIR="${plan.stateDir}"
export BOT_NAME="\${BOT_NAME:-${session}}"
export THISCODEX_ROOT="${plan.repo}"
${wikiExport}export CODEX_WS="\${CODEX_WS:-ws://127.0.0.1:4222}"
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
# rules-seed.md is copied into BOT_WD once, at guided init, and never
# overwritten by a later run (same never-overwrite contract as AGENTS.md
# above). This boot-time check only WARNS when the bot's copy-once stamp
# differs from the product-bundled examples/rules-seed.md — it
# never auto-merges or auto-updates the bot's file; that stays an explicit
# operator/bot command (B3). Wording is direction-neutral on purpose: a plain
# string != comparison cannot tell "older" from "newer" (semver order is not
# checked), so it must not claim one (2026-08-10 review finding).
if [ -f "\$BOT_WD/rules-seed.md" ] && [ -f "${plan.repo}/examples/rules-seed.md" ]; then
  BOT_RULES_VER=\$(command grep -oE 'rules-seed v[0-9.]+' "\$BOT_WD/rules-seed.md" | head -1 | awk '{print \$2}')
  PRODUCT_RULES_VER=\$(command grep -oE 'rules-seed v[0-9.]+' "${plan.repo}/examples/rules-seed.md" | head -1 | awk '{print \$2}')
  if [ -n "\$BOT_RULES_VER" ] && [ -n "\$PRODUCT_RULES_VER" ] && [ "\$BOT_RULES_VER" != "\$PRODUCT_RULES_VER" ]; then
    echo "[thiscodex][WARN] rules-seed \$BOT_RULES_VER differs from product \$PRODUCT_RULES_VER — update by explicit command only"
  fi
fi
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
  // B3 (2026-08-09/10 night batch, PRD success criteria 3-5): copy-once rules
  // seed — DM reply-thread echo policy + wiki save policy. Same never-overwrite
  // contract as AGENTS.md above: copied only if the bot's own copy is absent.
  // infra-launch.sh (infraScript, above) carries the staleness WARN at boot;
  // nothing here ever auto-merges or auto-updates an existing bot copy.
  const rulesSeedDoc = join(plan.bot, 'rules-seed.md');
  const rulesSeedSrc = join(plan.repo, 'examples', 'rules-seed.md');
  if (!existsSync(rulesSeedDoc) && existsSync(rulesSeedSrc)) {
    copyFileSync(rulesSeedSrc, rulesSeedDoc);
  }
  // 막힘 21 (2026-08-09 WSL, controlled pair 19:53/20:01): without access.json
  // the discord MCP starts in static allowlist mode and REFUSES every send —
  // the bot hears but never answers. The allowlist is a consent surface, so we
  // seed an EXAMPLE next to where the real file must live (real ids stay a
  // human decision — never a live file), and never overwrite. bot.py points at
  // it on boot while access.json is absent.
  const accessExample = join(plan.stateDir, 'access.json.example');
  const accessSrc = join(plan.repo, 'examples', 'access.json.example');
  if (!existsSync(accessExample) && existsSync(accessSrc)) {
    copyFileSync(accessSrc, accessExample);
  }
  return plan;
}
