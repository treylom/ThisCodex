# Recent Changes — read this on install

> Purpose: a short digest of recent behavior/contract changes so a freshly
> installed Codex bot (and a human operator) auto-reflects them. This is a
> changelog of *what an installed bot must do differently now*, not a full
> design doc. Newest first. Plain language; first use of a jargon term is
> explained inline.

## How these reach a fresh install (Codex needs **wire + trust**)

Most items below only take effect once the hooks are both **wired** into
`~/.codex/hooks.json` and **trusted** by Codex:

- **SessionStart** → `hooks/bot-session-init.sh`: injects the bot roster, the
  active-meeting state, and the situational rules router `rules/INDEX.md`.
  ("SessionStart" = a hook Codex runs when a session starts.) This is *why*
  recent `rules/` changes auto-apply — a new session reads the current INDEX,
  never a frozen copy.
- **Stop** → `hooks/meeting-stop-reread.sh`: during an active meeting,
  asks the bot to re-read the meeting progress file before it ends a turn.
  ("Stop" = a hook that runs when the model is about to stop responding.) The
  shipped hook takes no flag — it auto-detects a bot session from the
  environment, so it is wired plainly in `~/.codex/hooks.json`.

**Trust is not optional on Codex.** A wired Codex hook does **not** run until
it is approved through the Codex `/hooks` flow, which writes a `trusted_hash`
for that hook into `~/.codex/config.toml`. If there is no Stop `trusted_hash`
there, the meeting reread is silently inactive even though `hooks.json` is
correct. After wiring: run `/hooks` in the Codex TUI, approve the Stop (and
SessionStart) hook, and verify a Stop `trusted_hash` exists in
`~/.codex/config.toml`. The `/thiscodex setup` skill drives wire + trust + verify.
(Claude Code / ThisCode has no equivalent trust step.)

---

## 2026-05-21 — README-first AI install prompt

README and setup docs now start with a copy-paste prompt for Claude Code or
Codex. The prompt tells the installing AI to read the repo docs first, run
guided `thiscodex init`, ask before credentials or system-package changes, and
finish with `thiscodex doctor` or the documented verification commands.

Why it matters: a new user can paste one clear instruction into an AI assistant
instead of guessing which script to run first. The guided onboarding rule still
holds: placement is not onboarding, and "copied = installed" is not a valid
completion report.

## 2026-05-21 — Fresh thread rollout materialization

Codex 0.132+ can return a fresh `thread/start` id before the rollout JSONL
exists on disk. A bridge must force materialization before writing
`.codex-thread-id`, otherwise the operator TUI can wait forever for a rollout
that will never appear. The reference bridge now calls `thread/inject_items`
with a harmless assistant marker immediately after `thread/start`.

See [codex-app-server-bridge-pattern.md](codex-app-server-bridge-pattern.md),
[bot-launch-pattern.md](bot-launch-pattern.md), and
[sessionstart-bloat-avoidance.md](sessionstart-bloat-avoidance.md).

## 2026-05-19 — Meeting Stop-hook output contract fixed (⑨b)

**What changed.** `hooks/meeting-stop-reread.sh` emits the correct Stop
primitive: `{"decision":"block","reason":"<reread instruction>"}` on stdout to
extend one turn, or **empty stdout + `exit 0`** to allow the session to stop.
The shipped hook is runtime-agnostic — it auto-detects a bot session from the
environment (no flag), and uses the identical contract and the
`stop_hook_active` recursion guard on both Claude Code and Codex.

**Why it matters.** The Stop event has **no** `hookSpecificOutput` variant
(only `PreToolUse` / `UserPromptSubmit` / `Post*` events do). The earlier shape
was schema-rejected, so the meeting re-read was never actually injected. If you
carried an older copy, replace it. The shipped test asserts the schema
(`decision:block`, no `hookSpecificOutput`), so a regression fails CI.

**Verified on Codex 0.130.** The Codex Stop payload does include
`stop_hook_active` (observed `false → true` after one block), so the single-shot
guard works identically to Claude Code. The one Codex-only operational
requirement is the `/hooks` trust step above.

**Safety invariant.** It requests continuation only when *all* are true: bot
session, an active meeting file exists, and the Stop is not already recursive.
Any other case — non-bot, no meeting, recursion, parse failure, missing `jq` —
allows stop. The hook can never trap a session.

## 2026-05-19 — Meeting protocol rule + hooks shipped

- New `rules/meeting-protocol.md` (+ a trigger row in `rules/INDEX.md`):
  SessionStart injection contract, dispatch verification ("dispatched ≠
  working" — confirm with a concrete execution signal), append-only progress
  rows with **KST** timestamps, and the Stop-hook reread rule above.
- `hooks/bot-session-init.sh` injects generic active-meeting state and the
  rules INDEX (path-derived, graceful no-op when absent).

## 2026-05-1x — tmux-only setup, safe/YOLO, progress cadence (④⑥⑧)

- One-flow onboarding for tmux-only environments (no cmux required): aliases,
  safe-vs-YOLO selection, Discord wiring. "YOLO" = full-host-access; it is
  always an explicit per-bot opt-in via the bridge contract + an
  operator-controlled sentinel, never the zero-config default.
- `/thiscodex setup` is a step-by-step installer-facing skill (generated via
  the mandatory `/prompt` workflow). Placement ≠ onboarding.
- Setup asks `progress_report_cadence`: `per_task` / `1m` / `3m` / `5m` /
  `off` / `custom`. `per_task` = a meaningful subtask/milestone, not every raw
  model turn boundary.

## Codex plugin packaging

This repo carries a canonical Codex plugin surface (`.codex-plugin/plugin.json`,
root `skills/SKILL.md`, plugin-level `agents/`, `plugin.lock.json`,
`scripts/sync-to-codex-plugin.sh`) following current OpenAI plugin conventions.
Plugin packaging makes ThisCodex discoverable; guided `thiscodex init` is still
the separate onboarding step (placement is not onboarding).

## Progressive-disclosure rules system (convention)

Operating rules live in `rules/` as a tiny always-loaded router (`INDEX.md`) +
on-demand topical files. `AGENTS.md` points only at the router, never the rule
bodies — this prevents context bloat and recall decay. See
[rules-system.md](rules-system.md).
