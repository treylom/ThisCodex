# Recent Changes — read this on install

> Purpose: a short digest of recent behavior/contract changes so a freshly
> installed Codex bot (and a human operator) auto-reflects them. This is a
> changelog of *what an installed bot must do differently now*, not a full
> design doc. Newest first. Plain language; first use of a jargon term is
> explained inline.

## 2026-09-05 — bundled vault helpers retired (1.1.2)

- Vault search and storage belong to the separate Knowledge Manager plugin
  (`km-search` and `km-storage-abstraction`).
- Removed the bundled vault CLI wrapper, KM worker orchestrator, their adapter
  contract, and the archived search-order illustration. These helpers were
  removed, not moved or replaced by a compatible ThisCodex API.
- `/test` now checks only the six harness features: memory, tmux, meetings,
  rules, hooks, and installer behavior. The vault syntax-smoke and benchmark
  entries are retired; `/test all` runs the same six checks.
- The Discord bridge, interactive questions, installer, and shared-memory
  behavior are unchanged. Existing local copies of the retired helpers are
  not automatically deleted; review any direct calls before upgrading.

---

## 2026-09-05 — vault product boundary clarified (1.1.1)

- ThisCodex's Node installer owns ThisCodex skill placement and guided bot
  files only. It does not install the separate Knowledge Manager plugin,
  `/km:search`, `/km:setup`, `km-config.json`, MCP entries, or search tiers.
- The optional wiki path connects a save destination; it is not a second vault
  search provider. In 1.1.1, the bundled vault helpers were preserved and their
  compatibility design received matching English/Korean status notes.
  Those helpers and that design were subsequently retired in 1.1.2 above.
- Package, Codex/Claude manifests, lock metadata, and marketplace metadata now
  agree on `1.1.1`.

---

## 2026-09-03 — plugin hooks bundle + one aggregate verifier (1.1.0)

- The package, Codex/Claude manifests, lock metadata, and marketplace surface
  now agree on `1.1.0`; this resolves the prior `1.0.0` / `1.0.1` mismatch.
- Codex discovers the guarded 11-handler bundle from `hooks/hooks.json`; users
  no longer copy those handlers into `~/.codex/hooks.json`. Start a new session,
  review the current definitions in `/hooks`, then run
  `thiscodex hooks --verify` before calling them active.
- `thiscodex hooks --apply` backs up and removes only required-name legacy JSON
  entries owned by the bot wrapper, a ThisCodex path, a sibling ThisCodex
  manifest, or a missing target (never the missing-target rule for unresolved
  `$` paths). Matching the current bundle hash alone is not ownership proof.
  Unknown same-name JSON or inline entries are preserved and warned without
  failing verification. A proven ThisCodex inline entry remains an exit-1
  conflict for human `/hooks` review.

---

## How these reach a fresh install (Codex needs **register + trust**)

Most items below only take effect once the plugin hooks are both **registered**
from `hooks/hooks.json` and **trusted** by Codex:

- **SessionStart** → `hooks/bot-session-init.sh`: injects the bot roster, the
  active-meeting state, and the situational rules router `rules/INDEX.md`.
  ("SessionStart" = a hook Codex runs when a session starts.) This is *why*
  recent `rules/` changes auto-apply — a new session reads the current INDEX,
  never a frozen copy.
- **Stop** → `hooks/meeting-stop-reread.sh`: during an active meeting,
  asks the bot to re-read the meeting progress file before it ends a turn.
  ("Stop" = a hook that runs when the model is about to stop responding.) The
  shipped hook takes no flag — it auto-detects a bot session from the
  environment, so the plugin bundle can register it without per-user JSON.

**Trust is not optional on Codex.** A registered Codex hook does **not** run until
it is approved through the Codex `/hooks` flow, which writes a `trusted_hash`
for that hook into `~/.codex/config.toml`. Missing current hashes mean
`registered_pending_trust`, not active. After enabling the plugin and starting
a new session, run `/hooks`, review all 11 definitions, then run
`thiscodex hooks --verify`. The `/thiscodex setup` skill drives registration,
trust, and verification.
(Claude Code / ThisCode has no equivalent trust step.)

---

## 2026-08-13 — Slack bot-to-bot meeting gate restored

- The Slack bridge guide no longer tells every new bot to discard every
  bot-authored message. Optional bot interop now matches the verified live
  bridge: configure other bots by Slack user ID (`U…`) in
  `ALLOWED_SLACK_BOT_USER_IDS`; an allowed bot still passes only in a channel
  and only when it explicitly mentions this bot. DMs remain human-only.
- Unset or empty allowlists preserve the old fail-closed behavior. There is no
  message-count cap: both directions must be allowlisted, and each bot turn
  must explicitly address its recipient.

---

## 2026-08-12 — Discord thread creation adapter

- **rules-seed v1.1.2 — public/private thread creation without a fictitious MCP tool**:
  public/private thread creation is an official Discord feature, and
  `thiscodex discord-thread` calls the official Discord REST API directly. The
  currently shipped official Discord MCP lacks only the matching creation
  command, so the CLI emits a non-network request plan by default and creates
  공개 스레드 (public threads) or 비공개 스레드 (private threads) only with
  explicit `--apply`. The `reply_to` non-creation rule remains explicit.
- The adapter pins Discord REST API v10, sends private thread type `12`
  explicitly, requires the DiscordBot User-Agent, keeps the bot token out of
  dry-run/model-visible output, and reports access, permission, duplicate,
  capacity, unsupported-surface, and ambiguous-transport failures separately.

---

## 2026-08-12 — Meeting-room dispatch gate + solo-work ledger (P2 port)

- **rules-seed v1.1.1 — honest Discord thread-creation fallback**:
  Discord already provided public/private thread creation, while the official
  Discord MCP exposed reaction and existing-thread history but no matching
  creation command. Rule 3 still requires a dedicated thread; in that older
  ThisCodex version the bot asked an operator to create it and return the ID.
  `reply_to` must never be labeled as thread creation.
- **rules-seed v1.1.0 — new Rule 3 (no bot dispatch in top-level channels)**:
  bot-to-bot work orders go to a dedicated thread with the 4-file meeting
  folder; one-shot notices need an explicit `[공지]`/`[단발]`/`[핑]` tag.
  Existing bots keep their v1.0.0 copy (copy-once) — the boot-time staleness
  WARN in `infra-launch.sh` will announce v1.1.0; apply by explicit command
  only, as before.
- **New PreToolUse hook `hooks/dispatch-room-gate.py`** enforces Rule 3
  mechanically in multi-bot workspaces (matcher
  `mcp__discord__reply|mcp__discord__edit_message`, config
  `<state>/dispatch-gate.json`, state dir = `$MEETING_WATCHDOG_STATE_DIR` or
  `~/.claude-state` — the same directory the meeting watchdog reads).
  Install check = `--probe` must print `PROBE PASS 6/6`; the trust slot
  fails on a wired-but-untrusted hook (the Codex silent-inactive case).
  Same-event notation caveat: `PreToolUse` (hooks.json, CamelCase) vs
  `pre_tool_use:…` (config.toml trust keys, snake_case) — never unify when
  transcribing; hook-array reorders shift the index-based trust keys, so
  re-check `/hooks` approval after any change.
- **New `scripts/solo_ledger.py` (S2 solo-work ledger core)**: crash-safe
  per-task ledger (fence + flock + fail-closed blank-input gates) with
  SessionStart recovery primitives. Consumers (SessionStart/PreCompact/Stop
  wiring) land in a later phase; the core + fixture suites
  (`tests/solo-ledger/`, `tests/dispatch-gate/`) ship now.

---

## 2026-06-10 — Bridge fail-fast on app-server loss + portability fixes

- **bot.py now exits (code 17) the moment the codex app-server websocket
  dies** — including graceful server-side closes. Before, the bridge became a
  zombie: the reader died silently, every later turn failed with
  ConnectionClosed, and nothing restarted because the process never exited.
  With the supervised launcher (`scripts/launch.sh` window 0) the infra pair
  now self-heals in ~5s; thread continuity survives via `.codex-thread-id` +
  `thread/resume`. If a turn was active, the bridge posts a short "restarting,
  resend if needed" notice to that turn's Discord channel first.
- **Mid-turn crash recovery (in-flight turn reconcile)**: while a turn runs,
  the bridge persists `{origin chat, thread, turn_id}` to
  `.thiscodex-inflight-turn.json` (operator state dir, env
  `THISCODEX_INFLIGHT_FILE`) and clears it when the turn settles in-process.
  On the next boot, if the marker survived (exit-17 restart or hard crash
  mid-turn), the bridge calls `thread/read`: if the codex turn actually
  finished, the recovered agent reply is posted to the originating Discord
  channel; otherwise an explicit "turn lost, please re-send" notice goes out.
  Either way the originating request is never a silent drop. Marker is
  consumed up front, so recovery can never loop a crash cycle (fail-open).
- **Vault paths are parameterized**: `VAULT_ROOT` env is honored by
  `examples/bot.py` (memory script discovery), `scripts/memory_s5.py`,
  `scripts/memory_dreaming.py` (also `MEMORY_SHARED_ROOT`), and the
  `memory-s5-*` hooks. Defaults keep the reference deployment working.
- **SKILL.md subcommand table clarified**: only `init` / `doctor` / `smoke`
  are real CLI commands; `run`, `logs`, `features`, `troubleshoot`,
  `port-skills`, `multi-agent` are AI-guided intents executed by the
  assistant following the linked docs.
- **SETUP-BEGINNER.md** now includes the Discord bot creation step —
  including the **Message Content Intent** toggle, without which the bridge
  crashes at startup (`PrivilegedIntentsRequired`).
- **Generalized personal defaults**: `ORCHESTRATOR_BOT` default is now
  `orchestrator` (set it to your orchestrator bot's name);
  `HK_AUTOMATION_BOTS` replaces a hardcoded automation bot name; `/prompt`
  gained the `Bot-Persona-Generator.md` route for soul.md / AGENTS.md.

## 2026-05-26 — soft→hard hard hooks ported to ThisCodex

ThisCodex now ships the Codex-side soft→hard enforcement hooks under
`hooks/`:

- Stop gates: `reply-gate.sh`, `completion-gate.sh`,
  `dispatch-verify.sh`, `kst-timestamp.sh`.
- PreToolUse gates: `automation-no-interactive.sh`,
  `verify-before-push.sh`.
- Shared library and liveness utility: `hooks/lib/hookkit.sh` and
  `meeting-liveness.py`.

The Stop hooks emit only `{"decision":"block","reason":"..."}`. The
PreToolUse hooks emit Codex-compatible JSON deny output with
`hookSpecificOutput.permissionDecision="deny"` and `exit 0`; the legacy
exit-2 behavior is not used for newly shipped hooks. Runtime-specific values
such as completion thread, owner user ID, orchestrator bot name, and watchdog
state directory are supplied by environment variables rather than hardcoded in
the public repo.

At that release, operators ran `node --test tests/init/hard-hooks.test.mjs`,
`bash hooks/tests/run-hook-tests.sh`, manually wired the hooks into
`~/.codex/hooks.json`, and approved them through `/hooks`. Version 1.1.0 above
supersedes only that manual-wiring step with the plugin bundle.

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
