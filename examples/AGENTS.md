# Example AGENTS.md — source-backed plain reporting pattern

> **Loading note (convention)**: a bot-WD `AGENTS.md` like this one is the *end* of the Codex 3-chain (`~/.codex/AGENTS.md` → git-root `AGENTS.md` → this file). Shared operational rules arrive via the earlier links — state that in your WD file's opening lines like this, and never paste the shared rules body in (a copy forks the SSOT). See `docs/rules-system.md` §Root-instruction unification, caveat 3.
>
> **Rules seed**: this working directory also carries `rules-seed.md` (copied once at guided init, same never-overwrite contract as this file) — DM reply-thread echo policy and wiki save policy. Read it alongside this file.

Use this pattern when a Codex bot writes user-facing reports.

## Discord Reply Rule (CRITICAL — read first)

**Your assistant text does NOT reach the human.** This session is a headless
bridge: whatever you write ends up in the rollout log and the operator's
terminal, never in Discord. The user only sees what you send by **calling the
discord MCP `reply` tool** (pass back the `chat_id` from the inbound
`<channel source="discord" ...>` block; the message body parameter is `text`).

- Every user-facing answer = one `reply` tool call. No tool call = the user
  sees a mute bot, and nothing anywhere reports an error.
- Measured basis (2026-08-09 WSL): with no instruction file in the bot WD the
  model produced correct answers and called the reply tool **0 times**; after
  this file existed, **every** turn called it. The tool being available is not
  enough — this instruction is the trigger.
- If the reply tool is missing or fails, say so in your text (the bridge logs
  it) — do not silently continue.

## Discord Actions Beyond Reply

Check the tools actually exposed in the current session before claiming an
action is available.

- Add a reaction with `mcp__discord__react(chat_id, message_id, emoji)`.
- Read an existing Discord thread with
  `mcp__discord__fetch_messages(channel=<thread_id>)`; its parent channel must
  be allowlisted.
- The currently shipped official Discord MCP does **not** expose thread
  creation. ThisCodex provides a separate dry-run-first adapter: use
  `thiscodex discord-thread public ... --name "공개 스레드"` for a public thread
  or `thiscodex discord-thread private ... --name "비공개 스레드"` for a private
  thread, review the request plan, then repeat with `--apply`. `--channel-type`
  is an operator-declared value, not a lookup: verify the Discord channel
  object's `type` (0=text, 5=announcement) before applying; Discord decides any
  mismatch. Private mode defaults `invitable` to `false`; add `--invitable true`
  only when members may add others. `reply_to` only
  references an existing message and never creates a thread. If the CLI is not
  installed, ask an operator to create the thread and return its ID.

## Report Rule

Do not force fixed report labels. Write in plain prose while keeping these
obligations clear:

1. Confirmed facts include a checkable source such as a file path, command
   output, URL, or Discord message ID.
2. Interpretation is separated from checked facts in ordinary language.
3. Unknowns are stated directly instead of guessed.
4. Handoffs name the next owner or say that no handoff is needed.

Example:

```text
The bridge calls `thread/inject_items` (`thread/inject_items` = a Codex
app-server API that injects a message into the session log so the local
terminal view can attach cleanly). Source: examples/bot.py

Because the bridge writes that first log entry before the operator attaches,
the operator is less likely to open an empty terminal session.

This example does not prove behavior for future Codex versions. No handoff is
needed for this report.
```

## First-Use Gloss Rule

- `TUI` = terminal screen that lets the operator watch or join the same bot
  conversation.
- `rollout JSONL` = Codex's on-disk session log, written as one JSON record per
  line.
- `MCP` = Model Context Protocol, the tool-connection layer the bot uses to call
  external tools.

Add similar glosses for new terms instead of assuming the reader already knows
them.
