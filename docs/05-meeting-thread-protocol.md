# Meeting Thread & Channel Governance Protocol

> **Policy SoT**: vault `.claude/rules/channel-governance.md`  
> **Domain**: Dr. Strange (schedule / channel governance)  
> **Status**: Active — 2026-05-19

---

## 1. Conversation Log Archiving

Archive **final deliverables only** — never raw chat logs.

| Preserve | Discard |
|---|---|
| Proposals, deliverables, docs, code outputs | Raw Discord message history |
| Meeting outcomes (progress files, decisions, handoffs) | In-progress iteration logs |
| Repo commits | Intermediate conversation threads |

Store each output where it belongs:
- **Meeting** -> the active meeting folder or progress file named by the local meeting protocol
- **Code** -> repo commit
- **Document** -> the relevant repo or vault folder

Only archive outputs that have passed the completion gate. Process logs are ephemeral by design.

---

## 2. New Work Topic = New Thread

Open a **new thread** in the main team channel for every new work topic.

```
Main channel body  ->  redirect notice only
Thread             ->  all discussion, decisions, outputs
```

This applies to meetings, task reviews, design sessions, and any bounded unit of work. Keeping topics in threads preserves searchability and prevents channel noise.

---

## 3. Cross-Machine Coordination = Dedicated Channel

Use a **separate cross-machine channel** when work crosses device or environment boundaries, such as macOS, WSL, CI, or an external machine.

| Scope | Channel |
|---|---|
| Internal (same team, same environment) | Main team channel + threads |
| Cross-machine (different devices/envs) | Cross-machine coordination channel |

---

## Quick Reference

| Question | Answer |
|---|---|
| Save this chat log? | No — save the final output, not the conversation |
| Starting a new task or meeting? | Open a new thread in the main channel |
| Coordinating across machines? | Use the cross-machine channel |
| Where does the output go? | Follows output type (meeting/code/doc rules above) |

---

## Relationship to Other Docs

- `docs/rules-system.md` — progressive-disclosure rules pattern and ThisCodex meeting hook contract
- `rules/INDEX.md` — trigger router for on-demand rule loading
- `rules/meeting-protocol.md` — active-meeting execution rule: dispatch verification, KST progress rows, and Stop-hook reread discipline
- `hooks/bot-session-init.sh` — optional SessionStart helper for generic active-meeting context injection
- `hooks/meeting-stop-reread.sh` — optional Stop helper for one-turn meeting reread enforcement
- vault `.claude/rules/channel-governance.md` — policy SoT (authoritative)

---

*Maintained by: Dr. Strange · Last updated: 2026-05-19*
