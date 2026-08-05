# Example AGENTS.md — source-backed plain reporting pattern

> **Loading note (convention)**: a bot-WD `AGENTS.md` like this one is the *end* of the Codex 3-chain (`~/.codex/AGENTS.md` → git-root `AGENTS.md` → this file). Shared operational rules arrive via the earlier links — state that in your WD file's opening lines like this, and never paste the shared rules body in (a copy forks the SSOT). See `docs/rules-system.md` §Root-instruction unification, caveat 3.

Use this pattern when a Codex bot writes user-facing reports.

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
