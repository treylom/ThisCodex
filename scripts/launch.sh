#!/usr/bin/env bash
#
# ThisCodex hardened 2-window tmux launcher.
#
# Prevents the #1 multi-client failure: the codex TUI window starting a FRESH
# session (`codex --remote`) instead of resuming the bridge's thread
# (`codex resume <thread-id> --remote`). When that happens, bot.py (infra)
# drives the real thread but the operator's codex TUI is blind — "infra
# catches it, the codex TUI doesn't". See README Troubleshooting.
#
# Invariants this script guarantees (do NOT hand-roll around them):
#   1. Each tmux window's process IS the command (command-as-window-process).
#      Never `tmux new-window` (bare $SHELL) + `send-keys` — a bare interactive
#      shell then surfaces on ANY exit (stray-bash bug).
#   2. The codex window runs `codex resume "$(cat $TID_FILE)" --remote $WS`
#      ONLY after $TID_FILE is non-empty AND the rollout file exists. It NEVER
#      falls back to a bare `codex --remote` (that is the fresh-session bug).
#   3. Both windows are supervised (auto-restart) and tail `exec "$THISCODEX_SHELL"` so a
#      deliberate stop yields one clean shell, never an accidental stray one.
#
# Usage:
#   BOT_WD=/path/to/bot SESSION=mybot LAUNCH_CMD="./infra-launch.sh" ./scripts/launch.sh
#
# Env:
#   BOT_WD      (required) bot working dir (holds SOUL.md/AGENTS.md, .codex-thread-id)
#   SESSION     (default: thiscodex) tmux session name
#   WS          (default: ws://127.0.0.1:4222) app-server listen URL
#   TID_FILE    (default: $BOT_WD/.codex-thread-id) bridge writes the thread id here
#   LAUNCH_CMD  (required) the infra command: starts `codex app-server` + the
#               bridge daemon. THIS SCRIPT ONLY SUPERVISES — the bridge is what
#               actually sends the sandbox. The bridge MUST honor
#               docs/yolo-bridge-contract.md: send sandbox+approvalPolicy on
#               BOTH thread/start AND thread/resume (omitting on resume =
#               silent fallback to the safe default), and treat YOLO
#               (danger-full-access) as opt-in, not the default. Reference
#               implementation: examples/bot.py
#   STOP_FILE   (default: $BOT_WD/.thiscodex-stop) touch to break supervised restart
#   READY_LOG   (default: /tmp/$SESSION-bridge.log) grep'd for "app-server ready"
#   THISCODEX_SHELL (default: ${SHELL:-/bin/sh}) fallback shell after deliberate stop
#   CODEX_RESUME_FLAGS (default: empty) extra flags for operator TUI resume only.
#               Safe default = no extra flags. If the operator explicitly chooses
#               YOLO, a runner may set:
#                 --sandbox danger-full-access --ask-for-approval never
#               The bridge still owns thread/start and thread/resume sandbox per
#               docs/yolo-bridge-contract.md.

set -euo pipefail

: "${BOT_WD:?set BOT_WD to the bot working directory}"
: "${LAUNCH_CMD:?set LAUNCH_CMD to the infra command (app-server + bot.py)}"
SESSION="${SESSION:-thiscodex}"
WS="${WS:-ws://127.0.0.1:4222}"
TID_FILE="${TID_FILE:-$BOT_WD/.codex-thread-id}"
STOP_FILE="${STOP_FILE:-$BOT_WD/.thiscodex-stop}"
READY_LOG="${READY_LOG:-/tmp/$SESSION-bridge.log}"
THISCODEX_SHELL="${THISCODEX_SHELL:-${SHELL:-/bin/sh}}"
CODEX_RESUME_FLAGS="${CODEX_RESUME_FLAGS:-}"

command -v tmux  >/dev/null || { echo "[FATAL] tmux not found"; exit 1; }
command -v codex >/dev/null || { echo "[FATAL] codex CLI not found"; exit 1; }
[ -d "$BOT_WD" ] || { echo "[FATAL] BOT_WD not a dir: $BOT_WD"; exit 1; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[thiscodex] tearing down existing '$SESSION' ..."
  touch "$STOP_FILE" 2>/dev/null || true   # break old supervised loops cleanly
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  sleep 0.5
fi
rm -f "$STOP_FILE" 2>/dev/null || true

# window 0 'infra' — app-server + bot.py bridge. Command IS the window process,
# wrapped in a supervised restart loop. (invariant 1, 3)
tmux new-session -d -s "$SESSION" -n infra -c "$BOT_WD" \
  "while true; do $LAUNCH_CMD; if [ -f '$STOP_FILE' ]; then echo '[thiscodex] manual stop — no restart'; break; fi; echo '[thiscodex] infra exited — restart in 5s (stop: touch $STOP_FILE)'; sleep 5; done; exec \"$THISCODEX_SHELL\""

# window 1 'codex' — operator TUI joined to the SAME thread as the bridge.
# Hard guarded: wait for app-server, wait for a NON-EMPTY thread id, wait for
# the rollout file, THEN `codex resume "$TID" --remote`. Never bare
# `codex --remote`. If TID never appears, it loops waiting (loud) rather than
# silently starting a fresh divergent session. (invariant 2)
tmux new-window -t "$SESSION" -n codex -c "$BOT_WD" \
  "until grep -q 'app-server ready\\|Listening' '$READY_LOG' 2>/dev/null || curl -s ${WS/ws:\/\//http:\/\/}/readyz >/dev/null 2>&1; do sleep 1; done; \
   until [ -s '$TID_FILE' ]; do echo '[thiscodex] waiting for bridge to write $TID_FILE (NOT starting a fresh codex session)'; sleep 2; done; \
   TID=\$(cat '$TID_FILE'); \
   if ! printf '%s' \"\$TID\" | grep -qE '^[0-9a-fA-F]{8}-?[0-9a-fA-F-]{20,32}\$'; then echo \"[thiscodex][FATAL] .codex-thread-id not UUID-like: '\$TID' — refusing to attach (a bare codex --remote here would fork a fresh divergent thread). Fix the bridge, do not work around.\"; exec \"$THISCODEX_SHELL\"; fi; \
   echo \"[thiscodex] bridge thread=\$TID — waiting rollout\"; \
   until find \"\$HOME/.codex/sessions\" -name \"*\$TID*.jsonl\" 2>/dev/null | grep -q .; do sleep 1; done; \
   fails=0; while true; do echo \"[thiscodex] same-thread attach: codex resume \$TID --remote $WS\"; _s=\$(date +%s); codex resume \"\$TID\" --remote $WS $CODEX_RESUME_FLAGS; _e=\$(date +%s); if [ -f '$STOP_FILE' ]; then echo '[thiscodex] manual stop — no re-attach'; break; fi; if [ \$((_e-_s)) -lt 8 ]; then fails=\$((fails+1)); else fails=0; fi; if [ \$fails -ge 3 ]; then echo \"[thiscodex][FATAL] codex resume exited <8s x3 — NOT silent-restarting (check app-server/thread). Never falls back to a fresh session.\"; break; fi; echo \"[thiscodex] codex TUI exited — re-attach in 3s (stop: touch $STOP_FILE)\"; sleep 3; done; exec \"$THISCODEX_SHELL\""

tmux select-window -t "$SESSION:codex"
echo "[thiscodex] launched session '$SESSION' (infra + codex). Attach: tmux attach -t $SESSION"
