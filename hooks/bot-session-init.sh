#!/usr/bin/env bash
# bot-session-init.sh — Codex bot SessionStart context hook (optional)
#
# Injects active-meeting state and the progressive rules INDEX when present.
# This file is safe for distribution: paths are derived from env/BOT_WD/PWD,
# and missing files are a graceful no-op.
set -uo pipefail

bot_session=0
if [ -n "${DISCORD_STATE_DIR:-}" ] || [ -n "${BOT_WD:-}" ]; then
  bot_session=1
fi

if [ "$bot_session" -ne 1 ]; then
  exit 0
fi

SECTIONS=""

# Active meeting state.
MEETING_DIR="${MEETING_PROTOCOL_DIR:-}"
if [ -z "$MEETING_DIR" ] && [ -n "${BOT_WD:-}" ]; then
  MEETING_DIR="${BOT_WD}/meetings"
fi
if [ -z "$MEETING_DIR" ]; then
  MEETING_DIR="${PWD}/meetings"
fi
ACTIVE_MEETING="${MEETING_ACTIVE_FILE:-${MEETING_DIR}/ACTIVE.md}"
if [ -f "$ACTIVE_MEETING" ]; then
  MEETING_CONTENT=$(cat "$ACTIVE_MEETING" 2>/dev/null || true)
  SECTIONS+="=== active meeting protocol (${ACTIVE_MEETING}) ===

${MEETING_CONTENT}

Use meeting-protocol.md for dispatch verification, KST timestamps, and progress-file updates.

"
fi

# Progressive rule router.
RULES_DIR="${RULES_DIR:-}"
if [ -z "$RULES_DIR" ] && [ -n "${BOT_WD:-}" ]; then
  RULES_DIR="${BOT_WD}/rules"
fi
if [ -z "$RULES_DIR" ]; then
  RULES_DIR="${PWD}/rules"
fi
RULES_INDEX="${RULES_DIR}/INDEX.md"
if [ -f "$RULES_INDEX" ]; then
  RULES_CONTENT=$(cat "$RULES_INDEX" 2>/dev/null || true)
  SECTIONS+="=== progressive rules INDEX (${RULES_INDEX}) ===

${RULES_CONTENT}

Load rules/meeting-protocol.md when coordinating meetings or dispatch verification.

"
fi

if [ -z "$SECTIONS" ]; then
  exit 0
fi

export SECTIONS
python3 - <<'PY' 2>/dev/null || true
import json
import os

content = os.environ.get("SECTIONS", "")
if content:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": content,
        }
    }, ensure_ascii=False))
PY

exit 0
