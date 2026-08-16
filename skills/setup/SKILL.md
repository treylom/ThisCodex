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

## Automatic handoff inventory (runtime source of truth)

`install/automation-policy.yaml` owns the machine-readable names below. In
automatic mode, every user-facing manual instruction must first pass
`thiscodex automation-gate`; copy its `receipt_marker` unchanged into the
Discord message together with `<!-- thiscodex-manual-handoff -->`. The bridge
and the PreToolUse hook reject a handoff without a current-turn receipt.

| Gate | Automatic action before handoff | Human-only / terminal reason |
|---|---|---|
| <!-- thiscodex-handoff-gate:host_wsl_install_consent --> `host_wsl_install_consent` | inspect host/WSL state | host install consent |
| <!-- thiscodex-handoff-gate:host_tmux_install_consent --> `host_tmux_install_consent` | inspect tmux state | host install consent |
| <!-- thiscodex-handoff-gate:codex_privilege_config_consent --> `codex_privilege_config_consent` | inspect safe/YOLO config | privilege-boundary consent |
| <!-- thiscodex-handoff-gate:codex_hook_trust_approval --> `codex_hook_trust_approval` | wire and probe the hook | Codex `/hooks` trust approval |
| <!-- thiscodex-handoff-gate:shell_profile_persistence --> `shell_profile_persistence` | generate a sourceable block | persistent profile edit consent |
| <!-- thiscodex-handoff-gate:daemon_start_consent --> `daemon_start_consent` | materialize and verify runner | daemon start consent |
| <!-- thiscodex-handoff-gate:superpowers_install_consent --> `superpowers_install_consent` | detect the skill/plugin | install consent |
| <!-- thiscodex-handoff-gate:github_auth_login --> `github_auth_login` | run secret-safe auth detection | account login |
| <!-- thiscodex-handoff-gate:codex_discord_mcp_config_consent --> `codex_discord_mcp_config_consent` | inspect current MCP config | config edit consent |
| <!-- thiscodex-handoff-gate:browser_provider_install_declined --> `browser_provider_install_declined` | offer provider registration | explicit operator decline |
| <!-- thiscodex-handoff-gate:browser_provider_setup --> `browser_provider_setup` | register, restart, and re-detect | observed provider failure |
| <!-- thiscodex-handoff-gate:browser_provider_ready --> `browser_provider_ready` | inspect a callable browser tool | successful provider-flow terminal |
| <!-- thiscodex-handoff-gate:discord_portal_login --> `discord_portal_login` | inspect with the bound provider | credentials/MFA |
| <!-- thiscodex-handoff-gate:discord_hcaptcha --> `discord_hcaptcha` | inspect with the bound provider | CAPTCHA |
| <!-- thiscodex-handoff-gate:discord_reset_token_modal --> `discord_reset_token_modal` | inspect with the bound provider | password/MFA modal |
| <!-- thiscodex-handoff-gate:discord_desktop_approval --> `discord_desktop_approval` | attempt with the bound provider | observed uncontrollable-window failure |
| <!-- thiscodex-handoff-gate:discord_portal_complete --> `discord_portal_complete` | inspect the final portal state | successful portal-flow terminal |
| <!-- thiscodex-handoff-gate:token_direct_entry --> `token_direct_entry` | attempt model-blind clipboard receipt | observed clipboard failure, then user-only secret entry |
| <!-- thiscodex-handoff-gate:slack_browser_login --> `slack_browser_login` | inspect with the bound provider | credentials/MFA |
| <!-- thiscodex-handoff-gate:slack_browser_auth --> `slack_browser_auth` | ticket → confirm → challenge with the bound provider | observed browser failure |
| <!-- thiscodex-handoff-gate:slack_browser_auth_complete --> `slack_browser_auth_complete` | inspect signed-in Slack state | successful auth-flow terminal |
| <!-- thiscodex-handoff-gate:slack_workspace_admin_approval --> `slack_workspace_admin_approval` | inspect workspace requirement | admin approval |
| <!-- thiscodex-handoff-gate:slack_app_reinstall_approval --> `slack_app_reinstall_approval` | inspect requested scopes | OAuth reinstall approval |
| <!-- thiscodex-handoff-gate:slack_native_host_install_consent --> `slack_native_host_install_consent` | detect native-host path | native install consent |

## Required Flow

1. Run `thiscodex init` for guided onboarding. Its **first interaction** is the
   Automatic (`auto` / 자동) versus Manual (`manual` / 수동) choice; do not run
   environment checks or ask another setup question first. In automatic mode,
   before relaying any command or telling the user to perform an action, call
   `thiscodex automation-gate` with a policy-listed stable gate name. Unlisted
   gates fail closed. Attempt-required gates consume a current-turn completion
   envelope written by the bridge; named security boundaries use
   `human_required`. Missing/blocked output means the handoff must not be shown.
   When WSL or tmux is missing, inspect first and invoke the matching consent
   gate immediately before asking to change the host:

   ```bash
   thiscodex automation-gate --gate host_wsl_install_consent \
     --status human_required --surface host --flow init \
     --operation review-wsl-install --terminal human_security_gate \
     --reason-code host_permission_required
   thiscodex automation-gate --gate host_tmux_install_consent \
     --status human_required --surface host --flow init \
     --operation review-tmux-install --terminal human_security_gate \
     --reason-code host_permission_required
   ```
2. Confirm repo root, workspace, BOT_WD, and Discord state dir before generating
   aliases. If both `AGENTS.md` and `SOUL.md` are absent, create one canonical
   `AGENTS.md` in BOT_WD — **REQUIRED, never skip silently** (2026-08-12
   regression fix: real setups were observed ending without it). It contains
   the SOUL v2 capsule, static reply rule, and `rules/INDEX.md` pointer (see
   `/thiscodex` §3). Do not create a same-level
   `SOUL.md`: it is only a legacy fallback when `AGENTS.md` is absent, or an
   external bridge-capsule source. Explicit user decline only, recorded in the
   completion contract below.
   A `SOUL.md`-only BOT_WD is an existing install, not an empty directory: use
   `thiscodex migrate-identity --preview` before any change. Its `--apply`
   stages `AGENTS.md.v2`, leaves legacy SOUL.md active, and saves
   `SOUL.md.thiscodex.pre-v2.bak` plus a receipt. The operator performs manual
   cutover; `--rollback --apply` removes only an unchanged candidate and its
   receipt.
   During the persona interview, ask for the **exact operator address** (for
   example, `고객님`) and write it as a hard rule in the `AGENTS.md` SOUL v2
   capsule: **Always address the operator as `<exact address>`; do not reconfirm
   it or offer alternatives unless the operator explicitly changes
   it.** A descriptive sentence such as “the bot calls the operator X” is not
   strong enough. Before declaring setup complete, run the behavior probe
   `너는 나를 뭐라고 불러야 해?`; the bot must answer with the exact address
   without a follow-up question.
3. Use tmux for the daemon/TUI split. Do not use cmux for this flow.
4. Present safe mode first. Offer YOLO only as an explicit opt-in using the
   bridge contract and operator-controlled sentinel. Before asking the operator
   to approve the privilege change, run:

   ```bash
   thiscodex automation-gate --gate codex_privilege_config_consent \
     --status human_required --surface consent --flow setup \
     --operation review-codex-privilege-boundary --terminal human_security_gate \
     --reason-code security_boundary_review
   ```
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
   Automatic mode additionally requires `hooks/automation-handoff-gate.py`
   under `PreToolUse` with matcher
   `mcp__discord__reply|mcp__discord__edit_message`. Run `/hooks`, approve that
   exact hook, and rerun `thiscodex doctor`; doctor fails until both wiring and
   its matching `pre_tool_use:<group>:<hook>` `trusted_hash` are present.
   Immediately before the trust prompt, run:

   ```bash
   thiscodex automation-gate --gate codex_hook_trust_approval \
     --status human_required --surface consent --flow setup \
     --operation review-codex-hook-trust --terminal human_security_gate \
     --reason-code security_boundary_review
   ```
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
   permanent. Before asking for that persistent edit, run:

   ```bash
   thiscodex automation-gate --gate shell_profile_persistence \
     --status human_required --surface consent --flow setup \
     --operation review-shell-profile-edit --terminal human_security_gate \
     --reason-code security_boundary_review
   ```
9. Finish with `thiscodex doctor`, and echo the completion contract below in
   the final report.
10. Offer the **optional, non-blocking** Slack onboarding handoff. If the
    operator wants Slack, invoke `/slack-bridge` and start at its Step 0; do not
    send them to the Slack developer portal or invent a token-copy flow. If
    they defer it, record the reason without failing the Discord setup.

## Completion Contract (yaml 규약 — 2026-08-12)

The final setup report MUST echo this block with real values. `aliases` may
never be empty or omitted — a silent skip reads as an incomplete setup:

```yaml
setup_completion:
  aliases: generated | declined(<reason>)   # step 8 — REQUIRED
  wd_docs: created | declined(<reason>)     # step 2 — canonical AGENTS.md with SOUL v2 capsule (REQUIRED)
  operator_address: <exact address>         # step 2 — exact capsule rule + behavior probe
  hooks_trusted: true                       # step 6 — trusted_hash present
  dispatch_gate: probe 6/6 | skipped(<reason>)  # step 6 — multi-bot gate probe
  doctor: pass                              # step 9
  slack_bridge: configured | deferred(<reason>) # step 10 — optional, never blocks Discord
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
