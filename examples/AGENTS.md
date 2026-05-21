# Example AGENTS.md — plain 4-way reporting pattern

Use this pattern when a Codex bot writes user-facing reports.

## 4-way Report Rule

Keep these four labels exactly:

1. **SOURCE FACT** — confirmed fact with a source.
2. **DERIVED INFERENCE** — conclusion drawn from the source fact.
3. **UNCERTAINTY** — what is still unknown or ambiguous.
4. **DELEGATED TASK** — work handed to another bot or the user.

Inside each label, write in plain language first. If a hard English term,
abbreviation, or API name is needed, explain it the first time it appears.

Example:

```text
SOURCE FACT: The bridge calls `thread/inject_items` (`thread/inject_items` =
a Codex app-server API that injects a message into the session log so the local
terminal view can attach cleanly). Source: examples/bot.py

DERIVED INFERENCE: Because the bridge forces that first log entry, the operator
is less likely to open an empty terminal session.

UNCERTAINTY: This example does not prove behavior for future Codex versions.

DELEGATED TASK: None.
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
