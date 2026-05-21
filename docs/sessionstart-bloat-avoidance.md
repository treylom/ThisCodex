# SessionStart bloat avoidance

SessionStart context is startup fuel, not a knowledge dump. A bot should receive
the minimum routing context needed to decide what to read next.

## Rule

Keep eager SessionStart memory entries to one line:

```text
<title> - <priority marker> - <one-line reason to read this on demand>
```

Put the full incident, source quotes, and long checklists in normal vault notes
or repo docs, then link to them. The bot can read those files when the active
task actually needs them.

## Why

Large SessionStart payloads create four problems:

- every turn starts with stale or irrelevant detail;
- the model spends context on old incidents instead of the current task;
- important short rules are harder to notice;
- cross-bot behavior drifts because each bot receives a different oversized
  slice of memory.

## What to put in eager memory

Use this shape for `MEMORY.md` descriptions and similar startup indexes:

```markdown
- ThisCodex rollout materialization - high - read when debugging codex TUI attach or missing rollout JSONL.
- Meeting Stop hook - high - read when a bot is ending a turn during an active meeting.
- Discord split-message retag - high - read before sending long cross-bot messages.
```

Each line names the topic, priority, and trigger. It does not retell the whole
case.

## Applying this to other bots

The same compression pattern applies to Conan, Strange, GJK, AK-Tofu, and any
other bot that receives SessionStart memory or roster context. The bot-specific
details can differ, but the eager payload should stay small:

- one-line description in the startup index;
- path to the source note or repo doc;
- no embedded long transcripts;
- no copied full incident reports;
- no broad rule bodies when a router file can point to them.

This mirrors the ThisCodex rules system: `rules/INDEX.md` is always loaded, and
the topical rule files are read only when their trigger matches.
