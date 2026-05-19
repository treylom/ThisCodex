---
name: setup
description: Use when the user asks for /thiscodex setup, step-by-step ThisCodex onboarding, tmux-only Discord bot launch guidance, YOLO/safe-mode selection, or progress reporting cadence setup.
---

# ThisCodex Setup Skill

Generated through the mandatory `/prompt` workflow:

```text
/prompt --batch GPT-5.5 상세 ThisCodex setup skill: create a step-by-step installer-facing skill that invokes thiscodex init, keeps guided onboarding distinct from placement, uses tmux only, explains YOLO safely, and asks progress_report_cadence.
```

## Goal

Guide `thiscodex setup` / `thiscodex init` without inventing paths or silently
skipping decisions.

## Required Flow

1. Run `thiscodex init` for guided onboarding.
2. Confirm repo root, workspace, BOT_WD, and Discord state dir before generating
   aliases.
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
7. Read `docs/RECENT-CHANGES.md` and apply anything not yet reflected — it is
   the newest-first digest of contract/behavior changes a fresh install must
   adopt (e.g. the Stop-hook output contract + the trust requirement above).
8. When aliases are generated, tell the user to `source` the generated alias
   script/block; only add it to a shell rc file if they explicitly want it
   permanent.
9. Finish with `thiscodex doctor`.

## Guardrails

- Placement is not onboarding.
- Non-interactive mode is for CI or diagnosis only.
- Missing decisions stop with the next command instead of using guessed values.
