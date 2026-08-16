import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rejectProvisionalPath } from './state.mjs';
import { progressConfigForState, progressEnvForState } from './progress.mjs';

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runtimeName(state) {
  const value = state.session || state.answers?.session || 'thiscodex';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error('session must use 1-64 ASCII letters, numbers, dash, or underscore');
  }
  return value;
}

const IDENTITY_SOURCE_REL = ['examples', 'AGENTS.md'];
const IDENTITY_TARGET = 'AGENTS.md';
const IDENTITY_LEGACY_TARGET = 'SOUL.md';
const IDENTITY_CANDIDATE = 'AGENTS.md.v2';
const IDENTITY_BACKUP = 'AGENTS.md.thiscodex.pre-v2.bak';
const IDENTITY_LEGACY_BACKUP = 'SOUL.md.thiscodex.pre-v2.bak';
const IDENTITY_RECEIPT = 'AGENTS.md.thiscodex.migration.json';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyNew(source, target) {
  copyFileSync(source, target, constants.COPYFILE_EXCL);
}

// Codex discovers only one project instruction file at a directory level.
// AGENTS.md is therefore the single v2 identity source for a newly created
// ThisCodex bot. An existing AGENTS.md is never replaced: the explicit
// migration path stages a separately named candidate for operator review.
export function planIdentityMigration({ repo, bot }) {
  const source = join(repo, ...IDENTITY_SOURCE_REL);
  const target = join(bot, IDENTITY_TARGET);
  const legacy = join(bot, IDENTITY_LEGACY_TARGET);
  const candidate = join(bot, IDENTITY_CANDIDATE);
  const receipt = join(bot, IDENTITY_RECEIPT);
  const targetExists = existsSync(target);
  const legacyExists = existsSync(legacy);
  const current = targetExists ? target : legacyExists ? legacy : null;
  const currentKind = targetExists ? 'agents' : legacyExists ? 'legacy_soul' : 'none';
  const backup = join(bot, currentKind === 'legacy_soul' ? IDENTITY_LEGACY_BACKUP : IDENTITY_BACKUP);
  return {
    source,
    target,
    legacy,
    current,
    current_kind: currentKind,
    candidate,
    backup,
    receipt,
    source_exists: existsSync(source),
    target_exists: targetExists,
    legacy_exists: legacyExists,
    current_exists: current !== null,
    candidate_exists: existsSync(candidate),
    backup_exists: existsSync(backup),
    receipt_exists: existsSync(receipt),
  };
}

export function migrateIdentity({ repo, bot, apply = false, rollback = false }) {
  const cleanRepo = rejectProvisionalPath(repo);
  const cleanBot = rejectProvisionalPath(bot);
  const plan = planIdentityMigration({
    repo: cleanRepo,
    bot: cleanBot,
  });
  if (rollback) {
    if (!plan.receipt_exists) {
      return { ok: false, code: 'identity_rollback_receipt_missing', action: 'none', ...plan };
    }
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(plan.receipt, 'utf8'));
    } catch {
      return { ok: false, code: 'identity_rollback_receipt_invalid', action: 'none', ...plan };
    }
    if (!plan.candidate_exists || receipt.candidate !== plan.candidate || receipt.candidate_sha256 !== sha256(plan.candidate)) {
      return { ok: false, code: 'identity_rollback_refused_candidate_changed', action: 'none', ...plan };
    }
    if (!apply) {
      return { ok: true, mode: 'preview', action: 'would_remove_unchanged_candidate', ...plan };
    }
    // The original AGENTS.md was never touched. Removing only the receipt-bound
    // candidate is the rollback; preserve the original backup for audit/retry.
    unlinkSync(plan.candidate);
    unlinkSync(plan.receipt);
    return {
      ok: true,
      mode: 'apply',
      action: 'removed_unchanged_candidate',
      ...planIdentityMigration({ repo: cleanRepo, bot: cleanBot }),
    };
  }

  if (!plan.source_exists) {
    return { ok: false, code: 'identity_source_missing', action: 'none', ...plan };
  }

  if (!plan.current_exists) {
    if (!apply) return { ok: true, mode: 'preview', action: 'would_seed_canonical_identity', ...plan };
    mkdirSync(cleanBot, { recursive: true });
    const current = planIdentityMigration({ repo: cleanRepo, bot: cleanBot });
    if (current.current_exists) return { ok: false, code: 'identity_target_appeared', action: 'none', ...current };
    copyNew(plan.source, plan.target);
    return { ok: true, mode: 'apply', action: 'seeded_canonical_identity', ...planIdentityMigration({ repo: cleanRepo, bot: cleanBot }) };
  }

  if (plan.candidate_exists) {
    return { ok: false, code: 'identity_candidate_exists_no_overwrite', action: 'none', ...plan };
  }
  if (plan.receipt_exists) {
    return { ok: false, code: 'identity_receipt_exists_no_overwrite', action: 'none', ...plan };
  }
  if (plan.backup_exists && sha256(plan.backup) !== sha256(plan.current)) {
    return { ok: false, code: 'identity_backup_conflicts_no_overwrite', action: 'none', ...plan };
  }
  if (!apply) {
    return {
      ok: true,
      mode: 'preview',
      action: plan.backup_exists
        ? 'would_stage_v2_candidate_with_existing_backup'
        : plan.current_kind === 'legacy_soul'
          ? 'would_backup_legacy_soul_then_stage_v2_candidate'
          : 'would_backup_then_stage_v2_candidate',
      ...plan,
    };
  }

  mkdirSync(cleanBot, { recursive: true });
  // Re-plan at the write boundary: none of the three files may be overwritten.
  const current = planIdentityMigration({ repo: cleanRepo, bot: cleanBot });
  if (current.current !== plan.current || current.candidate_exists || current.receipt_exists
      || (current.backup_exists && sha256(current.backup) !== sha256(current.current))) {
    return { ok: false, code: 'identity_migration_target_changed_no_overwrite', action: 'none', ...current };
  }
  if (!current.backup_exists) copyNew(current.current, current.backup);
  try {
    copyNew(current.source, current.candidate);
    writeFileSync(current.receipt, JSON.stringify({
      schema_version: 1,
      source: current.source,
      source_sha256: sha256(current.source),
      original: current.current,
      backup: current.backup,
      backup_sha256: sha256(current.backup),
      candidate: current.candidate,
      candidate_sha256: sha256(current.candidate),
    }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    return { ok: false, code: 'identity_migration_write_failed', action: 'backup_preserved_candidate_may_require_review', error: error.message, ...planIdentityMigration({ repo: cleanRepo, bot: cleanBot }) };
  }
  return { ok: true, mode: 'apply', action: 'backed_up_then_staged_v2_candidate_no_overwrite', ...planIdentityMigration({ repo: cleanRepo, bot: cleanBot }) };
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
  const session = runtimeName(state);
  // Only present when a wiki (vault) path was actually connected — an unset
  // var (not an empty string) is what "wiki not provided" looks like downstream.
  // Every confirmed path crosses from JSON/Node into generated shell source,
  // so shQuote (not bare double-quoted interpolation) is mandatory. wiki_path
  // is the widest input because it is optional free text, but repo/BOT_WD/state
  // paths have the same shell-code boundary: `$`, backticks, quotes, or spaces
  // must land as data, never be re-interpreted at boot.
  const wikiExport = plan.wikiPath ? `export THISCODEX_WIKI_PATH=${shQuote(plan.wikiPath)}\n` : '';
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD=${shQuote(plan.bot)}
export DISCORD_STATE_DIR=${shQuote(plan.stateDir)}
export SESSION=${shQuote(session)}
export THISCODEX_PROGRESS_CADENCE=${shQuote(env.THISCODEX_PROGRESS_CADENCE)}
export THISCODEX_HEARTBEAT_SEC=${shQuote(env.THISCODEX_HEARTBEAT_SEC)}
${wikiExport}export LAUNCH_CMD=${shQuote(`${plan.bot}/infra-launch.sh`)}
ACTION="\${1:-start}"
STOP_FILE="\${STOP_FILE:-$BOT_WD/.thiscodex-stop}"

case "$ACTION" in
  start) ;;
  stop)
    touch "$STOP_FILE"
    if command -v tmux >/dev/null 2>&1 && tmux has-session -t "=$SESSION" 2>/dev/null; then
      tmux kill-session -t "=$SESSION"
      echo "[thiscodex] stopped exact session '$SESSION'"
    else
      echo "[thiscodex] exact session '$SESSION' is not running"
    fi
    exit 0
    ;;
  attach)
    exec tmux attach-session -t "=$SESSION"
    ;;
  tui)
    tmux select-window -t "=$SESSION:codex"
    if [ -n "\${TMUX:-}" ]; then exec tmux switch-client -t "=$SESSION"; fi
    exec tmux attach-session -t "=$SESSION"
    ;;
  *)
    echo "usage: $0 <start|stop|attach|tui>" >&2
    exit 2
    ;;
esac

cd ${shQuote(plan.repo)}
exec ${shQuote(`${plan.repo}/scripts/launch.sh`)}
`;
}

export function infraScript(state) {
  const plan = planBotFiles(state);
  const session = runtimeName(state);
  // Same shQuote requirement as runScript above — wiki_path is ungated free
  // text and must land as a value, never be re-interpreted by the shell.
  const wikiExport = plan.wikiPath ? `export THISCODEX_WIKI_PATH=${shQuote(plan.wikiPath)}\n` : '';
  return `#!/usr/bin/env bash
set -euo pipefail
export BOT_WD=${shQuote(plan.bot)}
export DISCORD_STATE_DIR=${shQuote(plan.stateDir)}
BOT_NAME="\${BOT_NAME:-}"
[ -n "$BOT_NAME" ] || BOT_NAME=${shQuote(session)}
export BOT_NAME
export THISCODEX_ROOT=${shQuote(plan.repo)}
REQUIREMENTS_FILE=${shQuote(`${plan.repo}/requirements.txt`)}
RULES_SEED_FILE=${shQuote(`${plan.repo}/examples/rules-seed.md`)}
BOT_SCRIPT=${shQuote(`${plan.repo}/examples/bot.py`)}
${wikiExport}export CODEX_WS="\${CODEX_WS:-ws://127.0.0.1:4222}"
SESSION_FOR_LOG="\${SESSION:-}"
[ -n "$SESSION_FOR_LOG" ] || SESSION_FOR_LOG=${shQuote(session)}
READY_LOG="\${READY_LOG:-/tmp/\${SESSION_FOR_LOG}-bridge.log}"
# PY: the ONE python this script both probes and runs. A venv install only
# counts if THISCODEX_PYTHON points at that venv's python — shell activation
# does not cross into tmux windows (launch.sh bakes this var through).
PY="\${THISCODEX_PYTHON:-python3}"
cd "$BOT_WD"

# Reference wiring (supervised by launch.sh window 'infra' — restarts on exit):
#   1) codex app-server — headless runtime. Its output feeds READY_LOG, which
#      launch.sh greps ("app-server ready|Listening") before attaching the TUI.
#   2) examples/bot.py — reference bridge; the process that actually talks to
#      Discord and owns the sandbox per docs/yolo-bridge-contract.md.
"\$PY" -c 'import sys, discord, websockets; sys.exit(0 if tuple(map(int, discord.__version__.split(".")[:2])) >= (2, 3) else 1)' 2>/dev/null || {
  echo "[thiscodex] bridge deps missing or too old for \$PY (need discord.py>=2.3 + websockets)"
  echo "[thiscodex]   install: \$PY -m pip install -r \$REQUIREMENTS_FILE"
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
if [ -f "\$BOT_WD/rules-seed.md" ] && [ -f "\$RULES_SEED_FILE" ]; then
  BOT_RULES_VER=\$(command grep -oE 'rules-seed v[0-9.]+' "\$BOT_WD/rules-seed.md" | head -1 | awk '{print \$2}')
  PRODUCT_RULES_VER=\$(command grep -oE 'rules-seed v[0-9.]+' "\$RULES_SEED_FILE" | head -1 | awk '{print \$2}')
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
"\$PY" "\$BOT_SCRIPT" &
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
  const session = runtimeName(state);
  // Shell artifact: alias block is sourced by bash/zsh, so the path must keep
  // POSIX separators even when materialized on a win32 host (platform join would
  // inject backslashes into the rc block). Filesystem writes keep platform join.
  const runner = `${bot}/run.sh`;
  const yoloFile = stateDir ? `${stateDir}/.thiscodex-yolo` : `${bot}/.thiscodex-yolo`;
  const env = progressEnvForState(state);
  const progressEnv = `THISCODEX_PROGRESS_CADENCE=${shQuote(env.THISCODEX_PROGRESS_CADENCE)} THISCODEX_HEARTBEAT_SEC=${shQuote(env.THISCODEX_HEARTBEAT_SEC)}`;
  return [
    '# Source this block from your shell, or paste it into your own rc file if you want it permanent.',
    `alias ${session}=${shQuote(`${progressEnv} ${shQuote(runner)} start`)}`,
    `alias ${session}-stop=${shQuote(`${shQuote(runner)} stop`)}`,
    `alias ${session}-attach=${shQuote(`${shQuote(runner)} attach`)}`,
    `alias ${session}-tui=${shQuote(`${shQuote(runner)} tui`)}`,
    `alias thiscodex-start=${shQuote(`${progressEnv} ${shQuote(runner)} start`)}`,
    `alias thiscodex-stop=${shQuote(`${shQuote(runner)} stop`)}`,
    `alias thiscodex-attach=${shQuote(`${shQuote(runner)} attach`)}`,
    `alias thiscodex-tui=${shQuote(`${shQuote(runner)} tui`)}`,
    `alias thiscodex-doctor=${shQuote(`cd ${shQuote(repo)} && node bin/thiscodex.mjs doctor`)}`,
    `alias thiscodex-discord=${shQuote(`${progressEnv} ${shQuote(runner)} start`)}`,
    `alias thiscodex-yolo-on=${shQuote(`mkdir -p ${shQuote(stateDir || bot)} && touch ${shQuote(yoloFile)}`)}`,
    `alias thiscodex-yolo-off=${shQuote(`rm -f ${shQuote(yoloFile)}`)}`,
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
  // before an instruction file existed, 7 after): materialize the canonical
  // v2 identity AGENTS.md into the bot WD. Codex discovers at most one
  // project-document filename in this directory, so this is intentionally not
  // paired with a same-level SOUL.md. Preserve the copy-once contract.
  const agentsDoc = join(plan.bot, 'AGENTS.md');
  const legacySoulDoc = join(plan.bot, 'SOUL.md');
  const agentsSrc = join(plan.repo, 'examples', 'AGENTS.md');
  if (!existsSync(agentsDoc) && !existsSync(legacySoulDoc) && existsSync(agentsSrc)) {
    copyNew(agentsSrc, agentsDoc);
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
