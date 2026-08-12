---
name: setup
description: Use when the user asks for /thiscodex setup, step-by-step ThisCodex onboarding, tmux-only Discord bot launch guidance, YOLO/safe-mode selection, or progress reporting cadence setup.
---

# ThisCodex Setup Skill

Generated through the mandatory `/prompt` workflow:

```text
/prompt --batch GPT-5.6 상세 ThisCodex setup skill: create a step-by-step installer-facing skill that invokes thiscodex init, keeps guided onboarding distinct from placement, uses tmux only, explains YOLO safely, and asks progress_report_cadence.
```

## Goal

Guide `thiscodex setup` / `thiscodex init` without inventing paths or silently
skipping decisions.

## Required Flow

1. Run `thiscodex init` for guided onboarding.
2. Confirm repo root, workspace, BOT_WD, and Discord state dir before generating
   aliases. Then create `SOUL.md` (persona) + `AGENTS.md` (rules pointer) in
   BOT_WD — **REQUIRED, never skip silently** (2026-08-12 regression fix: real
   setups were observed ending without them). `AGENTS.md` carries the static
   reply rule and points only at `rules/INDEX.md` (see `/thiscodex` §3).
   Explicit user decline only, recorded in the completion contract below.
3. Use tmux for the daemon/TUI split. Do not use cmux for this flow.
4. Present safe mode first. Offer YOLO only as an explicit opt-in using the
   bridge contract and operator-controlled sentinel.
5. Ask `progress_report_cadence`: `per_task`, `1m`, `3m`, `5m`, `off`, or
   `custom`. `per_task` means a meaningful subtask or milestone completion,
   not every raw model turn boundary.
6. Wire **and trust** the Codex hooks. Ensure `~/.codex/hooks.json` has the
   SessionStart helper (`hooks/bot-session-init.sh` — injects roster +
   active-meeting state + `rules/INDEX.md`) and the active-meeting Stop reread
   (`hooks/meeting-stop-reread.sh` — no flag; it auto-detects a bot session
   from the environment). Then run `/hooks` in the Codex TUI
   and approve them: a wired Codex hook does NOT run until trusted (a
   `trusted_hash` is written to `~/.codex/config.toml`). Verify a Stop
   `trusted_hash` is present in `~/.codex/config.toml` — if absent, the meeting
   reread is silently inactive. (See README §3.6.) This trust step is
   Codex-specific; do not skip it or report the bot ready without it.
   Notation caveat: `hooks.json` uses CamelCase event keys (`PreToolUse`,
   `SessionStart`, `Stop`) while the `config.toml` trust state keys use
   snake_case (`pre_tool_use:…`) — same event, two notations; never "unify"
   them when transcribing. If you add / remove / reorder hook array entries,
   re-check `/hooks` approval: the trust keys are index-based.
   For multi-bot workspaces, additionally wire the dispatch-room gate
   (`hooks/dispatch-room-gate.py`, PreToolUse, matcher
   `mcp__discord__reply|mcp__discord__edit_message`), write
   `<state>/dispatch-gate.json` (`top_channels` + `roster_path` +
   `workspace_roots`; state = `$MEETING_WATCHDOG_STATE_DIR` or
   `~/.claude-state`), then run
   `python3 REPO_DIR/hooks/dispatch-room-gate.py --probe` (REPO_DIR = this
   ThisCodex checkout) — installation is complete only on `PROBE PASS 6/6`
   (wiring · trust · config · deny · non-top pass · out-cwd pass). A wired
   but untrusted gate probes FAIL — that is the silent-inactive case the
   probe exists to catch. Single-bot installs may skip with
   `dispatch_gate: skipped(single-bot)`.
7. Read `docs/RECENT-CHANGES.md` and apply anything not yet reflected — it is
   the newest-first digest of contract/behavior changes a fresh install must
   adopt (e.g. the Stop-hook output contract + the trust requirement above).
8. Generate the shell aliases via `/setup aliases` — **REQUIRED, never skip
   silently** (2026-08-12 regression fix: real setups were observed ending
   without aliases; a setup with no alias is incomplete unless the user
   explicitly declined, and the decline must be recorded in the completion
   contract below). Then tell the user to `source` the generated alias
   script/block; only add it to a shell rc file if they explicitly want it
   permanent.
9. Finish with `thiscodex doctor`, and echo the completion contract below in
   the final report.

## Completion Contract (yaml 규약 — 2026-08-12)

The final setup report MUST echo this block with real values. `aliases` may
never be empty or omitted — a silent skip reads as an incomplete setup:

```yaml
setup_completion:
  aliases: generated | declined(<reason>)   # step 8 — REQUIRED
  wd_docs: created | declined(<reason>)     # step 2 — SOUL.md + AGENTS.md in BOT_WD (REQUIRED)
  hooks_trusted: true                       # step 6 — trusted_hash present
  dispatch_gate: probe 6/6 | skipped(<reason>)  # step 6 — multi-bot gate probe
  doctor: pass                              # step 9
```

## Subcommands

| When to use | Call |
|---|---|
| Start guided ThisCodex setup | `/setup` or `/setup init` — launches the interactive onboarding wizard. Covers repo root, workspace, BOT_WD, Discord state directory, safe/YOLO mode selection, progress reporting cadence, and Codex hook setup. |
| View setup progress summary | `/setup status` — shows what's been configured so far (repo, workspace, aliases generated, hooks wired, doctor check done). |
| Run setup verification | `/setup doctor` — verifies all paths exist, Discord MCP is wired, `~/.codex/config.toml` is readable, hook trust hashes are present, and tmux/Python dependencies are installed. |
| Re-wire Codex hooks | `/setup hooks` — re-runs the SessionStart + meeting-Stop hook wiring and trust approval in the Codex TUI. Use this if hooks were unwired or the trust hash was removed. |
| Generate shell aliases | `/setup aliases` — generates convenience shell aliases (`thiscodex_run`, `thiscodex_tui`, `thiscodex_connect`, etc.) and shows you how to `source` or permanently add them. |
| View guide documents | `/setup guide` — prints paths to SETUP.md, SETUP-BEGINNER.md, and RECENT-CHANGES.md for reference during setup. |

## Guardrails

- Placement is not onboarding.
- Non-interactive mode is for CI or diagnosis only.
- Missing decisions stop with the next command instead of using guessed values.
