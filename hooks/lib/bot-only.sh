#!/usr/bin/env bash
# Run bundled bot hooks only when the Discord bridge state boundary is present.
set -u

_drain_stdin() { [ -t 0 ] || cat >/dev/null 2>&1 || true; }

if [ -z "${DISCORD_STATE_DIR:-}" ]; then
  _drain_stdin
  exit 0
fi

hook_id="${1:-unknown}"
target="${2:-}"
if [ -z "$target" ] || [ ! -f "$target" ]; then
  _drain_stdin
  echo "bot-only: missing target for ${hook_id}" >&2
  exit 0
fi
shift 2

case "$target" in
  *.py|*.PY)
    if ! command -v python3 >/dev/null 2>&1; then
      _drain_stdin
      echo "bot-only: python3 unavailable; skipped ${hook_id}" >&2
      exit 0
    fi
    exec python3 "$target" "$@"
    ;;
  *) exec bash "$target" "$@" ;;
esac
