---
name: thiscodex
description: Use when setting up an OpenAI Codex CLI agent as a persistent Discord bot with Claude-Code-equivalent persona/vault discipline, when porting Claude Code skills or rules to Codex, or when wiring multi-agent conventions (cross-bot addressing, meeting threads, SessionStart roster, progressive-disclosure rules) so Claude Code and Codex agents share one Discord + Obsidian-vault workspace. Covers headless app-server + Python bridge, yolo execution, multi-client same-thread, and the rules system.
---

# ThisCodex — make Codex behave like a Claude Code Discord bot

This skill is invocable: drop it at `~/.agents/skills/thiscodex/SKILL.md` (codex user-tier, 4-layer scan) or install via the Codex plugin marketplace. It walks you through a **verified** setup. Deep reference lives in the repo docs — load them only when the step needs it (progressive disclosure).

## When to use
- "Make my Codex CLI a Discord bot like the Claude Code ones"
- "Port these Claude Code skills/rules to Codex"
- "Set up multi-agent (Claude + Codex) in one Discord + vault"

## Setup procedure (do these in order)

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
3. **Bot working directory**: put `SOUL.md` (persona) + `AGENTS.md` (rules) there. `AGENTS.md` must carry the static Discord-reply rule and point at `rules/INDEX.md` only (not inline rules) — see `docs/rules-system.md`.
4. **Bridge + launcher**: a 2-window tmux launcher — window `infra` runs the app-server + `bot.py` bridge; window `codex` attaches a TUI to the SAME app-server (`codex resume <thread-id> --remote ws://…`) for live observe/steer. Command-as-window-process + supervised restart (never `send-keys` into a bare shell). Full architecture + protocol facts: **`README.md` §2**.
5. **YOLO**: `bot.py` must send `sandbox:"danger-full-access"` + `approvalPolicy:"never"` on **both** `thread/start` AND `thread/resume` (resume silently degrades otherwise — the nastiest bug; `README.md` §6).
6. **Skills/rules portability**: your own skills → `~/.agents/skills/<name>/SKILL.md`. Plugin/framework skills (e.g. superpowers) → install via the framework's own codex path, never hand-symlink. Decision rule + the `claude-discode↔codex` mapping: **`docs/skill-portability.md`** (esp. §2.5).
7. **Multi-agent conventions**: cross-bot `<@user_id>` addressing, meeting = dedicated thread, SessionStart roster injection — all from one `bot-roster.yaml`. **`README.md` §4**.
8. **Rules without context bloat**: ship a `rules/INDEX.md` router + on-demand topical files; `CLAUDE.md`/`AGENTS.md` point only at the router. **`docs/rules-system.md`**.

## Verify (don't claim done without this)
- `codex features list | grep skill_` on both targets
- one clean `dangerFullAccess` turn → tool list has `web.run, exec_command, image_gen` (no browser/computer tool — `computer_use` is parked, see `README.md` §1/§7)
- bridge log shows `[READY]` + a `thread/resume` with `{"type":"dangerFullAccess"}`

## Reference map (load on demand)
| Need | File |
|---|---|
| Architecture, protocol, evidence | `README.md` (EN) / `README.ko.md` (KO) |
| CC↔Codex skill porting, superpowers path | `docs/skill-portability.md` |
| Progressive-disclosure rules convention | `docs/rules-system.md` |
| Session↔channel UX (borrowed) | companion `ThisCode/docs/connector-session-ux.md` |

Companion runtime (Claude Code side): [ThisCode](https://github.com/treylom/ThisCode). This repo = the Codex side + cross-runtime conventions.
