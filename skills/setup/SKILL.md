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
   `custom`.
6. Finish with `thiscodex doctor`.

## Guardrails

- Placement is not onboarding.
- Non-interactive mode is for CI or diagnosis only.
- Missing decisions stop with the next command instead of using guessed values.
