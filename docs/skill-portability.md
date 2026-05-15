# Skill Portability — Claude Code skills ↔ Codex (cross-platform)

> Co-drafted: Karpathy (Mac, session-verified) × 루돌프/Rudolph (WSL, `treylom/codex-bots` owner, SOURCE FACT). 1-pass, 4-way labeled.
> Goal: one `SKILL.md` invokable by **both** codex CLI and a Discord bot, on macOS / WSL / Linux.

## 1. How Codex discovers skills — 4-layer scan `[SOURCE FACT — 루돌프, WSL `codex-cli 0.130.0`, verified 2026-05-08 against developers.openai.com/codex/skills]`

Scan order (first match wins, then chained):
```
$CWD/.agents/skills  →  $REPO_ROOT/.agents/skills  →  $HOME/.agents/skills  →  /etc/codex/skills  →  SYSTEM
```
- `SKILL.md` frontmatter: `name` + `description` **required**, `metadata` optional (openai/skills-compatible — same shape as Claude Code skills).
- Invoke paths (2): **explicit** `/skills <name>` or `$skill-name`; **implicit** description-match (Codex auto-invokes, chained depth 3).

`[Mac cross-check — Karpathy]` Mac `codex-cli 0.130.0`: the `.agents/skills` 4-layer paths exist (empty on this Mac = not yet populated for codex; CC uses `~/.claude/skills`). `/etc/codex/skills` intentionally empty on both. → mechanism is structurally identical Mac & WSL.

`[SOURCE FACT — both sides, 0.130 feature gate identical]`
```
codex features list | grep skill_
skill_env_var_dependency_prompt   under development   false
skill_mcp_dependency_install      stable              true
```
WSL (루돌프) and Mac (Karpathy) report the **same** flags. `skill_mcp_dependency_install=stable` is the enabler for `SKILL.md` `metadata` MCP-dependency auto-install — the foundation of portable skills.

## 2. The CC ↔ Codex mapping

`[SOURCE FACT — 루돌프]` Claude Code `~/.claude/skills/` ↔ Codex **user-tier** `~/.agents/skills/` are **1:1 mappable** (same `SKILL.md` frontmatter contract). 루돌프's WSL fleet runs **46 user-tier skills** (codex-rescue/review/setup/status, brainstorm, pumasi/pumasi-image, ralph-loop, modernize-*×7, hookify-*×4, feature-dev, write/execute-plan, prompt-sync, using-superpowers, skills-upgrade). Full list: `rtk ls ~/.agents/skills/`.

Portability rule: place the shared `SKILL.md` at `~/.agents/skills/<name>/SKILL.md`; it is then invokable by **codex CLI and the Codex Discord bot identically** (the winning pattern, §4). For Claude-Code parity, symlink or sync from `~/.claude/skills/`.

## 3. The SDK 0.130 trap & workaround `[SOURCE FACT — 루돌프, codified in commit 5e90004]`

`@openai/codex-sdk` 0.130 has **no dedicated system slot**. Persona/rules can't be injected as a true system message. Workaround in production: inject `SOUL + AGENTS + TOOLS` as an inline `[system]\n…\n\n[user]\n…` prefix. The native path (per-persona `AGENTS.md` in `workingDirectory`, codex auto-load) is deferred to a follow-up turn — so first-turn persona is the inline prefix.

`[session-verified — Karpathy]` Same symptom on the Mac bridge: codex `app-server` exposes only a generic tool/turn protocol, so `bot.py` injects the dynamic `<channel …>` block per turn while **static** persona/rules ride on `project_doc_fallback_filenames = ["SOUL.md","AGENTS.md"]` auto-load (per-turn re-injection removed — P1.5 trim). Net: identical mitigation, two runtimes.

## 4. Winning pattern — one SKILL.md, dual invoke `[SOURCE FACT — 루돌프; openclaw/hermes-agent pattern absorbed]`

| Concern | CC bot | codex-bots | Lesson |
|---|---|---|---|
| Auth | per-channel pairing | reuse `~/.codex/auth.json` | 0 keys issued |
| Daemon | tmux + alias | systemd template `codex-bot@<n>` | systemd > tmux for stability |
| Persona | single `soul.md` | SOUL+AGENTS+TOOLS+ROUTES.yaml | split = clean handoff |
| Skill location | `~/.claude/skills/` | `.agents/skills/` 4-layer | **same SKILL.md invoked by CLI *and* bot** |
| Memory | per-WD memory | `personas/<bot>/state/` (gitignored) | cross-bot contamination blocked |

`[session-verified — Karpathy]` Mac side adds: c-2 multi-client (TUI `codex resume <tid> --remote` watches/steers the bot's live thread), resume-sandbox yolo fix (re-send `danger-full-access` on `thread/resume` or it silently degrades), roster/SessionStart injection (cross-bot addressing + meeting-thread rules), `computer_use` parked on [openai/codex#20851](https://github.com/openai/codex/issues/20851).

**Persona-coupled skill example** `[SOURCE FACT — 루돌프]`: repo-tier `.agents/skills/` skills like `samaltman-greet`, `peer-handoff` are bound to a persona pair — when porting, keep them repo-tier (not user-tier) so they travel with the persona, not the machine.

## 5. Porting checklist (Codex side)

1. `~/.agents/skills/<name>/SKILL.md` — `name` + `description` frontmatter (CC-compatible).
2. MCP deps → `metadata` (auto-installed via stable `skill_mcp_dependency_install`).
3. Persona/rules → `AGENTS.md`+`SOUL.md` in bot WD + `project_doc_fallback_filenames`; first-turn = inline `[system]` prefix workaround (SDK 0.130).
4. Dynamic per-message state → bridge prompt only (`<channel …>`); everything static → `AGENTS.md` (auto-loaded, don't re-inject).
5. Verify: `codex features list | grep skill_` both targets; `/skills <name>` explicit invoke; implicit description-match.

## 6. Open / deferred

- 46-skill set: full enumeration pending `rtk ls ~/.agents/skills/` capture (루돌프 to attach).
- Native `AGENTS.md` auto-load timing (deferred-to-follow-up-turn) — track upstream SDK > 0.130.
- 루돌프 verification axes: (a) 4-layer path empirics, (b) 46-count, (c) SDK-slot wording parity, (d) winning-pattern phrasing align.
