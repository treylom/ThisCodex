<!-- rules-seed v1.0.0 -->
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
