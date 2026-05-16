# ThisCodex

> A reproducible setup for running **Claude Code + Codex CLI multi-agent bots** over **Discord**, wired into an **Obsidian vault** with shared folder/memory rules.
>
> 🇰🇷 [한국어 README](./README.ko.md) · 📦 Companion runtime: [ThisCode](https://github.com/treylom/ThisCode) (Claude Code side) · This repo = the **Codex side** + cross-runtime conventions.

![ThisCodex core idea — a structured Obsidian vault, the right bot per working directory, driven from Discord, bots collaborating](assets/core-mental-model.png)

> **New here?** This one picture is the whole idea: a **structured Obsidian vault**, the **right bot in each working directory** (Claude Code *and* Codex), all driven from **Discord**, with the bots collaborating. ThisCodex is the Codex side — install it as a skill (`skills/thiscodex/`) and follow §3.

![ThisCode + ThisCodex detailed wiring (tmux · app-server · Discord · vault)](assets/architecture.png)
>
> **Before you start (recommended):** lay out your Obsidian **folder structure** first and **install Obsidian** for full memory + internal-search. Without Obsidian you can still wire a plain Discord bot, but memory / internal-search quality is **not guaranteed**.

ThisCodex packages the hard-won, **verified** pattern for making a Codex CLI agent (`codex` by OpenAI) behave like the Claude Code Discord bots — same persona discipline, same Discord I/O, same vault rules — plus the multi-agent conventions (cross-bot addressing, meeting threads, SessionStart context injection) that let Claude Code and Codex agents collaborate in one Discord workspace.

It is **not** a framework. It is a documented set of building blocks you assemble yourself, with every claim traced to a source.

---

## 1. What you get

| Capability | Status | Mechanism |
|---|---|---|
| Codex CLI as a persistent Discord bot | ✅ working | `codex app-server` (headless) + Python bridge daemon (`bot.py`) + discord.py |
| Multi-client same-thread (watch/steer the bot's conversation from a TUI) | ✅ working | `codex resume <thread-id> --remote ws://…` against the same app-server |
| Persona / vault rules auto-loaded | ✅ working | `~/.codex/config.toml` → `project_doc_fallback_filenames = ["SOUL.md","AGENTS.md"]` |
| Cross-bot addressing + meeting discipline | ✅ working | `bot-roster.yaml` SoT injected at SessionStart |
| YOLO (full-access) execution | ✅ working | `thread/start` **and** `thread/resume` both send `sandbox:"danger-full-access"`, `approvalPolicy:"never"` |
| Image generation | ✅ working | codex built-in `image_gen.imagegen` tool |
| Web fetch/search | ✅ working | codex built-in `web.run` tool |
| `computer_use` / `browser_use` (desktop/browser control) | ⏸️ **parked** | `codex features list` shows `stable,true`, **but no official `codex` command/subcommand exposes it**, so it is **not a callable tool** on the CLI/app-server surface (ships only as a Desktop-app-bundled MCP). Tracked upstream: [openai/codex#20851](https://github.com/openai/codex/issues/20851). Documented, not hacked. |

Everything marked ✅ is empirically verified (see §6 Evidence). Everything ⏸️ is documented honestly with the upstream issue, not worked around.

---

## 2. Architecture

```
tmux session "sshee"
├── window: infra
│     codex app-server --listen ws://127.0.0.1:4222   (headless LLM runtime)
│        ▲ │  JSON-RPC over WebSocket
│        │ ▼
│     bot.py  ── discord.py on_message ──► Discord
│        - thread/start  (sandbox=danger-full-access, approvalPolicy=never)
│        - thread/resume (.codex-thread-id → SAME params re-applied)  ← critical
│        - per-turn: <channel chat_id message_id …> + "→ reply"
│        - codex calls mcp__discord__reply → Discord plugin REST POST
│
└── window: codex
      codex resume "$(cat .codex-thread-id)" --remote ws://127.0.0.1:4222
      → operator watches & can join the SAME conversation thread
```

Claude Code bots use the same shape, except the inbound-event injection is built into `claude` itself; for Codex a ~small Python bridge does `turn/start`. Outbound is identical (both call the `mcp__discord__reply` tool).

### Key protocol facts (codex app-server JSON-RPC v2)

- Handshake: `initialize` → `initialized` → `thread/start` (or `thread/resume`) → `turn/start` → notification stream.
- Server-initiated requests the client **must** answer: `mcpServer/elicitation/request` (respond `{"action":"accept","_meta":{"persist":"session"}}` to allow the discord MCP), `item/*/requestApproval`, `item/tool/call`, `item/tool/requestUserInput`. Ignoring them hangs the turn forever.
- `thread/resume` loads from the on-disk rollout (`~/.codex/sessions/YYYY/MM/DD/rollout-*-<tid>.jsonl`); it accepts `sandbox` + `approvalPolicy` — **you must re-send them or the resumed thread silently falls back to `workspaceWrite` / `networkAccess:false`** (this was the single nastiest bug; see §6).

---

## 3. Setup

### 3.1 Prerequisites
- `codex` CLI (OpenAI), `tmux`, Python 3 with `websockets`, the Claude Code Discord plugin (reused as a codex MCP server).
- Platforms: macOS / Linux / **WSL2 (Ubuntu 22.04+)**. Native Windows → use WSL. `computer_use` is macOS-Apple-Events-bound and N/A on WSL/Linux regardless of upstream.

### 3.2 `~/.codex/config.toml`
```toml
project_doc_fallback_filenames = ["SOUL.md", "AGENTS.md"]
project_doc_max_bytes = 65536

[mcp_servers.discord]
command = "bun"
args = ["run", "--cwd", "<path to discord plugin>", "start"]
[mcp_servers.discord.env]
DISCORD_STATE_DIR = "~/.claude/channels/discord-<botname>"
```

### 3.3 Bot working directory
Put `SOUL.md` (persona) and `AGENTS.md` (rules — including the static Discord-reply rule, see §4) in the bot WD. They are auto-loaded every thread; **do not** re-inject persona text per turn.

### 3.4 Run it (yolo by design)
A 2-window tmux launcher (`sshee` alias): window `infra` runs `launch.sh` (app-server + `bot.py`); window `codex` attaches an interactive TUI to the same app-server for live observation/steering. `launch.sh` is itself the yolo boundary: `approvalPolicy:"never"` + `sandbox:"danger-full-access"` + bridge auto-accepts the discord MCP elicitation with `persist:"session"`.

### 3.5 GitHub auth & superpowers
- GitHub: `gh auth login` (or a PAT in the environment) before launch so codex `exec` can push/PR.
- Superpowers / skills: codex reads `AGENTS.md`; point it at your skills directory and the migration rules (§5) so skill invocations resolve.

---

## 4. The multi-agent conventions (why this is more than one bot)

These are the rules that make Claude Code + Codex agents coexist. They live in `bot-roster.yaml` (single source of truth, injected at SessionStart):

- **Cross-bot addressing**: in shared channels, a message aimed at another bot **must** use its `<@user_id>` mention or a `reply_to`. Otherwise the receiving bot silently drops it. Bot `user_id`s are derived deterministically from the bot token's first base64 segment — never guessed.
- **Direct channels are exempt** from the mention rule (`require_mention: false`).
- **Meetings = dedicated threads**: any task with ≥2 bots, ≥10 min, or an agenda (2-of-3) gets its own thread; the main channel only gets a redirect. One-shot relays/ACKs stay inline.
- **SessionStart injection**: a single renderer (`roster-inject.py`) feeds the same coordinates + rules into both Claude Code bots (via the session-init hook) and Codex bots (via `~/.codex/hooks.json`).
- **Discord-reply rule (static, in AGENTS.md — not per turn)**: each turn arrives as `<channel chat_id="…" message_id="…" …>`; reply with `mcp__discord__reply(chat_id, reply_to=message_id)`. Persona/vault discipline is always on because `SOUL.md`/`AGENTS.md` are project-doc auto-loaded.

---

## 5. Claude Code ↔ Codex migration rules

Bringing a Claude Code agent's behavior to Codex (and back):

| Concern | Claude Code | Codex equivalent |
|---|---|---|
| Persona/rules load | `CLAUDE.md` + SessionStart hook | `AGENTS.md`/`SOUL.md` via `project_doc_fallback_filenames` |
| Inbound Discord event | built into `claude --channels` | `bot.py` bridge → `turn/start` |
| Outbound | `mcp__discord__reply` tool | identical (discord plugin as codex MCP) |
| Tool approvals | permission modes | `approvalPolicy` + bridge auto-accept elicitation |
| Skills | Skill tool | `AGENTS.md`-declared skill dir; invoke via shell/`exec` until first-class |
| Persistence | session memory | `thread/resume` from rollout + `.codex-thread-id` |
| Sandbox | permission prompts | `sandbox` enum; **re-send on resume** |

Rule of thumb: **state that's dynamic per message stays in the bridge prompt; everything static moves to `AGENTS.md`** (it is auto-loaded, so per-turn re-injection is pure noise).

---

## 6. Evidence (every ✅ is traced)

- Codex bot equivalence + 9 debug cycles: `ThisCode` / vault meeting `2026-05-15-codex-discord-bot-poc`.
- Multi-client same-thread: verified by attaching a 2nd WS client and reading the bridge's live history.
- `computer_use`/`browser_use`: flag `stable,true` in `codex features list` **but no official `codex` command/subcommand exposes it** → not a callable tool. Triangulated: features list (flags true) **vs** GitHub #20851 (Desktop-app-bundled MCP only) **vs** clean app-server×`dangerFullAccess` turn → tool list = `web.run, exec_command, image_gen, …` (no browser/computer tool). 6 converging signals, confound-free.
- resume-sandbox bug: `thread/resume` without re-sending `sandbox` → effective `workspaceWrite`/`networkAccess:false`; fixed by re-sending `danger-full-access` → verified `{"type":"dangerFullAccess"}`.

---

## 7. Security note (read before enabling computer-use when #20851 lands)

When upstream exposes `computer_use` to the CLI, **do not** pipe untrusted Discord text into it via an LLM-enforced "treat as data" instruction — that has zero enforcement. Required: code-level default-deny, URL allowlist (block `file:`/`javascript:`/RFC-1918/metadata IPs), ephemeral browser profile, block sensitive-field `type`/`click`, full audit log of allow/deny, nonce/expiry/HMAC on any delegation. (Source: GPT-5.5 adversarial review, 2026-05-16.)

---

## 8. Status

- ✅ Codex Discord bot, multi-client, roster/SessionStart, yolo, image_gen/web.run/exec — working & verified.
- ⏸️ computer_use/browser_use — parked on [openai/codex#20851](https://github.com/openai/codex/issues/20851).
- 🔁 Skill portability (Codex using Claude Code skills) + WSL/Windows codex skill absorption — in progress (collaborative). Superpowers: install via its own upstream codex path, see [docs/skill-portability.md](docs/skill-portability.md) §2.5.
- ✅ Progressive-disclosure **rules system** (no context bloat — situational rule routing) — convention shipped, see [docs/rules-system.md](docs/rules-system.md).
- ⚙️ **Config guide** (AGENTS.md · soul.md · rules · Skills 2.0 checklist) — [docs/SETUP-CONFIG-GUIDE.md](docs/SETUP-CONFIG-GUIDE.md).

License: see repo. Use on machines you control, with trusted private Discord servers only.
