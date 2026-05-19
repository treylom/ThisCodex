#!/usr/bin/env bash
#
# Sync this ThisCodex checkout into an openai/plugins-style repository.
# Based on the public obra/superpowers sync workflow, but scoped to
# plugins/thiscodex and kept dry-run friendly.
#
# Usage:
#   ./scripts/sync-to-codex-plugin.sh --local /path/to/openai-plugins -n
#   ./scripts/sync-to-codex-plugin.sh --local /path/to/openai-plugins -y
#
# Requires: bash, rsync, git, python3. gh is only needed when you push/PR from
# the destination checkout yourself.

set -euo pipefail

DEST_REL="plugins/thiscodex"
DRY_RUN=0
YES=0
LOCAL_CHECKOUT=""

usage() {
  sed -n '/^# Usage:/,/^# Requires:/s/^# \{0,1\}//p' "$0"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    -y|--yes) YES=1; shift ;;
    --local) LOCAL_CHECKOUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

command -v rsync >/dev/null || die "rsync not found in PATH"
command -v git >/dev/null || die "git not found in PATH"
command -v python3 >/dev/null || die "python3 not found in PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="$(cd "$SCRIPT_DIR/.." && pwd)"

[[ -f "$UPSTREAM/.codex-plugin/plugin.json" ]] || die "missing .codex-plugin/plugin.json"
[[ -f "$UPSTREAM/plugin.lock.json" ]] || die "missing plugin.lock.json"
[[ -n "$LOCAL_CHECKOUT" ]] || die "--local /path/to/openai-plugins is required"

DEST_REPO="$(cd "$LOCAL_CHECKOUT" && pwd)"
[[ -d "$DEST_REPO/.git" ]] || die "--local path is not a git checkout: $DEST_REPO"

DEST="$DEST_REPO/$DEST_REL"
mkdir -p "$DEST"

if [[ $YES -ne 1 ]]; then
  echo "About to sync ThisCodex into: $DEST"
  echo "Use -y to confirm writes, or -n for dry-run."
  [[ $DRY_RUN -eq 1 ]] || exit 1
fi

RSYNC_ARGS=(
  -a
  --delete
  --exclude="/.git/"
  --exclude="/.github/"
  --exclude="/node_modules/"
  --exclude="/tests/"
  --exclude="__pycache__/"
  --exclude="*.pyc"
  --exclude="/.DS_Store"
  --include="/.codex-plugin/***"
  --include="/agents/***"
  --include="/assets/***"
  --include="/docs/***"
  --include="/rules/***"
  --include="/scripts/***"
  --include="/skills/***"
  --include="/README.md"
  --include="/README.ko.md"
  --include="/LICENSE"
  --include="/plugin.lock.json"
  --exclude="*"
)

if [[ $DRY_RUN -eq 1 ]]; then
  RSYNC_ARGS+=(--dry-run --itemize-changes)
fi

rsync "${RSYNC_ARGS[@]}" "$UPSTREAM/" "$DEST/"

if [[ $DRY_RUN -eq 1 ]]; then
  MANIFEST="$UPSTREAM/.codex-plugin/plugin.json"
else
  MANIFEST="$DEST/.codex-plugin/plugin.json"
fi

python3 - "$MANIFEST" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
for key in ("name", "version", "description", "skills", "interface"):
    if key not in data:
        raise SystemExit(f"missing plugin.json key: {key}")
if data["skills"] != "./skills/":
    raise SystemExit("plugin.json skills must be ./skills/")
print(f"validated {path}")
PY
