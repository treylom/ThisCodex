<!-- rules-seed v1.1.1 -->
# Rules Seed — copy-once bot defaults

> This file is copied into the bot working directory **once**, on first guided
> `thiscodex init` (see `AGENTS.md` in this same directory — the reference
> instruction chain points here). It is **never overwritten** by a later
> `thiscodex init` run: edit your bot's own copy directly once it exists. A
> newer product version may print a boot-time
> `WARN: rules-seed vX -> vY available — update by explicit command only`
> line (see `infra-launch.sh`) — that warning never auto-merges or
> auto-updates your copy. Apply changes only by an explicit operator or bot
> command.

## Rule 1 — No DM (1:1) reply-thread echo

In a direct message (1:1) conversation, do not echo the inbound message's
timestamp or thread identifier back as a reply-thread marker. Only do that
when the inbound message itself actually carries a thread marker. Default
channel (non-DM) reply-threading behavior is unchanged and stays owned by
the bridge, not this rule.

## Rule 2 — Wiki save policy

When a wiki (Obsidian vault) path is connected for this bot (see
`THISCODEX_WIKI_PATH` in `run.sh` / `infra-launch.sh`), Markdown output
produced from a chat instruction is saved into that wiki path. State the
saved path in the reply back to the user, alongside the normal answer — do
not save silently without naming where the file landed.

## Rule 3 — No bot dispatch in top-level channels (meeting-room gate)

When one bot delegates work to another bot (task orders, review requests,
implementation / test instructions), do **not** do it in the body of a
top-level shared channel. Create a dedicated thread, create the meeting
record folder first (4 files: 00-context / 01-spec / 02-progress /
03-outcome), and keep the whole exchange inside that thread. One-shot
notices and liveness pings may go to the channel body, but must carry an
explicit `[공지]` / `[단발]` / `[핑]` tag. Messages addressed to humans must
not mention bots.

The currently shipped official Discord MCP does not expose thread creation.
If no callable create-thread tool exists, ask an operator to create the thread
and return its ID before dispatching. `reply_to` is only a reply reference and
does not create a Discord thread; never label that fallback as creation.

Once installed and configured, this rule is also enforced mechanically by
`hooks/dispatch-room-gate.py` (a PreToolUse deny hook plus a
`<state>/dispatch-gate.json` config; on Codex the hook must additionally be
**trusted** via `/hooks` — see README §3.6). The rule text and the hook
share the same verdict criteria; in environments where the hook is not
configured, the rule itself still applies.
