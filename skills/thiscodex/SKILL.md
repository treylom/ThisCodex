---
name: thiscodex
description: Use when setting up an OpenAI Codex CLI agent as a persistent Discord bot with Claude-Code-equivalent persona/vault discipline, when porting Claude Code skills or rules to Codex, or when wiring multi-agent conventions (cross-bot addressing, meeting threads, SessionStart roster, progressive-disclosure rules) so Claude Code and Codex agents share one Discord + Obsidian-vault workspace. Covers headless app-server + Python bridge, yolo execution, multi-client same-thread, and the rules system.
---

# ThisCodex — make Codex behave like a Claude Code Discord bot

Invocable skill. Install paths:
- **user-tier**: copy this folder to `~/.agents/skills/thiscodex/` (codex 4-layer scan picks it up; deep docs are referenced by URL below so a loose copy still works).
- **marketplace/plugin**: the repo ships `.codex-plugin/plugin.json` (`skills: "./skills/"`) — install via the Codex plugin path, then invoke `/skills thiscodex` or by description match.

Deep reference lives in the repo (load only when a step needs it — progressive disclosure).

## When to use
- "Make my Codex CLI a Discord bot like the Claude Code ones"
- "Port these Claude Code skills/rules to Codex"
- "Set up multi-agent (Claude + Codex) in one Discord + vault"

## Setup procedure (in order)

1. **Prereqs**: `codex` CLI, `tmux`, Python 3 + `websockets`, the Claude Code Discord plugin (reused as a codex MCP server), `gh auth login`. Platforms: macOS / Linux / WSL2.
2. **`~/.codex/config.toml`** — auto-load persona/rules + wire the Discord MCP:
   ```toml
   project_doc_fallback_filenames = ["SOUL.md", "AGENTS.md"]
   project_doc_max_bytes = 65536
   [mcp_servers.discord]
   command = "bun"
   args = ["run", "--cwd", "<path to discord plugin>", "start"]
   [mcp_servers.discord.env]
   DISCORD_STATE_DIR = "~/.claude/channels/discord-<botname>"
   ```
3. **Bot working directory**: put `SOUL.md` (persona) + `AGENTS.md` (rules) there. `AGENTS.md` carries the static Discord-reply rule and points at `rules/INDEX.md` only (not inline rules).
4. **Bridge + launcher**: use the shipped **`scripts/launch.sh`** (hardened 2-window tmux launcher: `infra` runs app-server + `bot.py` bridge; `codex` resumes the SAME bridge thread). It enforces the invariants — command-as-window-process (never `send-keys` into a bare shell), and the codex window **always `codex resume <bridge-thread-id> --remote`, never a bare fresh `codex --remote`**. Set `BOT_WD`, `SESSION`, `LAUNCH_CMD`. Do not hand-roll this (see Troubleshooting for why).
5. **YOLO**: `bot.py` sends `sandbox:"danger-full-access"` + `approvalPolicy:"never"` on **both** `thread/start` AND `thread/resume` (resume silently degrades otherwise — the nastiest bug).
6. **Skills/rules portability**: your own skills → `~/.agents/skills/<name>/SKILL.md`. Plugin/framework skills (e.g. superpowers) → install via the framework's own codex path, never hand-symlink.
7. **Multi-agent conventions**: cross-bot `<@user_id>` addressing, meeting = dedicated thread, SessionStart roster injection — all from one `bot-roster.yaml`.
8. **Rules without context bloat**: ship a `rules/INDEX.md` router + on-demand topical files; `CLAUDE.md`/`AGENTS.md` point only at the router.

## Verify (don't claim done without this)
- `codex features list | grep skill_` on both targets
- one clean `dangerFullAccess` turn → tool list has `web.run, exec_command, image_gen` (no browser/computer tool — `computer_use` is parked upstream)
- bridge log shows `[READY]` + a `thread/resume` with `{"type":"dangerFullAccess"}`

## Smoke test (expected trigger)
> Prompt: "set up codex as a discord bot like claude code" → this skill should activate and produce the 8-step procedure above with the verify gate. If it does not trigger on that phrasing, the `description` frontmatter needs widening.

## Troubleshooting

**Symptom**: Discord messages reach the bot (the `infra` window logs turns, replies get sent) but the **codex TUI window shows nothing / a fresh empty prompt** — "infra catches it, the codex TUI doesn't".

**Cause**: the codex window ran `codex --remote ws://…` (a FRESH session/thread) instead of `codex resume "$(cat .codex-thread-id)" --remote ws://…`. `bot.py` drives the bridge thread; the TUI is on a different empty thread, so it never shows the bridge's turns. Common when the launcher is hand-rolled, or a stale launcher definition is used on manual recovery.

**Fix**: the codex window MUST `codex resume <bridge-thread-id> --remote` the SAME thread `bot.py` uses (`.codex-thread-id`) — never bare `codex --remote`. `scripts/launch.sh` invariant 2 enforces this; use it instead of hand-rolling. Fix a live session without a full restart (bot.py/infra untouched):
```
tmux respawn-window -k -t <session>:codex -c <BOT_WD> \
  "codex resume $(cat <BOT_WD>/.codex-thread-id) --remote ws://127.0.0.1:4222"
```

## Reference map (load on demand — GitHub URLs, robust for loose-copy or marketplace install)
| Need | Source |
|---|---|
| Architecture, protocol, evidence | [README.md](https://github.com/treylom/ThisCodex/blob/master/README.md) · [README.ko.md](https://github.com/treylom/ThisCodex/blob/master/README.ko.md) |
| CC↔Codex skill porting, superpowers path | [docs/skill-portability.md](https://github.com/treylom/ThisCodex/blob/master/docs/skill-portability.md) |
| Progressive-disclosure rules convention | [docs/rules-system.md](https://github.com/treylom/ThisCodex/blob/master/docs/rules-system.md) |
| Session↔channel UX (borrowed) | [ThisCode/docs/connector-session-ux.md](https://github.com/treylom/ThisCode/blob/main/docs/connector-session-ux.md) |

Companion runtime (Claude Code side): [ThisCode](https://github.com/treylom/ThisCode). This repo = the Codex side + cross-runtime conventions.
