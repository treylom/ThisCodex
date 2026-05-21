# Skill Portability — Claude Code skills ↔ Codex (cross-platform)

> Co-drafted: Karpathy (Mac, session-verified) × 루돌프/Rudolph (WSL, `treylom/codex-bots` owner, source-backed). One-pass, source-backed review.
> Goal: one `SKILL.md` invokable by **both** codex CLI and a Discord bot, on macOS / WSL / Linux.

## 1. How Codex discovers skills — 4-layer scan `[source-backed — 루돌프, WSL `codex-cli 0.130.0`, verified 2026-05-08 against developers.openai.com/codex/skills]`

Scan order (first match wins, then chained):
```
$CWD/.agents/skills  →  $REPO_ROOT/.agents/skills  →  $HOME/.agents/skills  →  /etc/codex/skills  →  SYSTEM
```
- `SKILL.md` frontmatter: `name` + `description` **required**, `metadata` optional (openai/skills-compatible — same shape as Claude Code skills).
- Invoke paths (2): **explicit** `/skills <name>` or `$skill-name`; **implicit** description-match (Codex auto-invokes, chained depth 3).

`[source-backed — 루돌프, fresh re-measure 2026-05-15T16:24Z]` 4-layer 실측: repo-tier `~/codex-bots/.agents/skills` = **4 entries**, user-tier `~/.agents/skills` = **46 entries**, admin-tier `/etc/codex/skills` = **디렉토리 미생성 (MISSING)** — 직전 표현 "intentionally empty" 는 부정확, 실제는 디렉토리 자체가 없음(스캐너 skip 동작은 동일).

`[Mac cross-check — Karpathy]` Mac `codex-cli 0.130.0`: 동일 4-layer 경로 구조 존재(이 Mac은 codex용 미populate, CC는 `~/.claude/skills` 사용), admin-tier도 미생성. → 메커니즘 Mac·WSL 구조적으로 동일.

`[source-backed — both sides, 0.130 feature gate identical]`
```
codex features list | grep skill_
skill_env_var_dependency_prompt   under development   false
skill_mcp_dependency_install      stable              true
```
WSL (루돌프) and Mac (Karpathy) report the **same** flags. `skill_mcp_dependency_install=stable` is the enabler for `SKILL.md` `metadata` MCP-dependency auto-install — the foundation of portable skills.

## 2. The CC ↔ Codex mapping

`[source-backed — 루돌프]` Claude Code `~/.claude/skills/` ↔ Codex **user-tier** `~/.agents/skills/` are **1:1 mappable** (same `SKILL.md` frontmatter contract). 루돌프's WSL fleet runs **46 user-tier skills** `[source-backed — 루돌프, fresh re-measure 2026-05-15T16:24Z, count 46 정합]`: brainstorm, clean-gone, code-review, codex-adversarial-review, codex-cancel, codex-rescue, codex-result, codex-review, codex-setup, codex-status, commit, commit-push-pr, connect-figma-components, create-design-system-rules, create-plugin, docs-guide, example-command, execute-plan, feature-dev, git-teacher, hookify, hookify-configure, hookify-help, hookify-list, implement-from-figma, lesson-a, modernize-assess, modernize-brief, modernize-extract-rules, modernize-harden, modernize-map, modernize-reimagine, modernize-transform, new-sdk-app, prompt, prompt-sync, pumasi, pumasi-image, ralph-loop, ralph-loop-cancel-ralph, review-design-parity, review-pr, revise-claude-md, skills-upgrade, using-superpowers, write-plan.

Portability rule: place the shared `SKILL.md` at `~/.agents/skills/<name>/SKILL.md`; it is then invokable by **codex CLI and the Codex Discord bot identically** (the winning pattern, §4). For Claude-Code parity, symlink or sync from `~/.claude/skills/`. **Scope: this hand-placement/symlink is only for your *own bespoke* skills. Plugin- or framework-distributed skills (e.g. superpowers) ship their own codex packaging — install via the framework's official codex path, never hand-symlink the plugin cache. See §2.5.**

## 2.5. Plugin/framework skills → use the framework's own codex path `[source-backed — gh obra/superpowers + local plugin cache, verified 2026-05-16; maintainer rule "원본 레포 반드시 확인"]`

`~/.agents/skills` hand-symlink is **only** for the user's own bespoke skills. A plugin/framework like **superpowers** already ships first-class codex packaging upstream — do not hand-roll:

- Upstream: `github.com/obra/superpowers` (Jesse Vincent, MIT). Codex manifest at repo root: `.codex-plugin/plugin.json` → declares `"skills": "./skills/"` (same `skills/` tree as the Claude-Code plugin).
- Maintainer sync path (manual / planned — no committed script): fork `prime-radiant-inc/openai-codex-plugins` (`plugins/superpowers`) → upstreamed into the **official Codex plugin marketplace `github.com/openai/plugins`**.
- **Canonical Codex CLI install** (upstream README §"Codex CLI", verbatim):
  ```
  /plugins          # open the plugin search interface
  superpowers       # search
  → Select "Install Plugin"
  ```
- Install differs per harness — install separately for each: Claude Code `/plugin install superpowers@claude-plugins-official`; Codex CLI (above); Codex App → Plugins sidebar; Gemini `gemini extensions install https://github.com/obra/superpowers`; Cursor `/add-plugin superpowers`; Copilot `copilot plugin marketplace add obra/superpowers`; Factory Droid `droid plugin marketplace add https://github.com/obra/superpowers`.

**Rule (maintainer, recurring):** before hand-rolling cross-platform skill portability, **always check the upstream repo** for platform packaging (`.codex-plugin/`, `sync-to-*` scripts, `AGENTS.md`/`GEMINI.md`, a multi-harness install matrix). Upstream usually already solved it — the hand-symlink primitive is the *fallback for skills with no upstream codex packaging*, not the default.

## 3. The SDK 0.130 trap & workaround `[source-backed — 루돌프, hard-code 확인 2026-05-15: runner.ts:135 + test/runner.test.ts:149, commit 5e90004]`

`@openai/codex-sdk` 0.130 has **no dedicated system slot**. Persona/rules can't be injected as a true system message. Workaround in production: inject `SOUL + AGENTS + TOOLS` as an inline `[system]\n…\n\n[user]\n…` prefix. The native path (per-persona `AGENTS.md` in `workingDirectory`, codex auto-load) is deferred to a follow-up turn — so first-turn persona is the inline prefix. Hard-code 증거(루돌프, 2026-05-15): `packages/gateway/src/codex/runner.ts:135` 가 `[system]…[user]` 프리픽스를 직접 return, `test/runner.test.ts:149` 가 `lastInput` 에 `[system]` 포함을 assert — 코드+테스트 양측에 박힘 (commit 5e90004).

`[session-verified — Karpathy]` Same symptom on the Mac bridge: codex `app-server` exposes only a generic tool/turn protocol, so `bot.py` injects the dynamic `<channel …>` block per turn while **static** persona/rules ride on `project_doc_fallback_filenames = ["SOUL.md","AGENTS.md"]` auto-load (per-turn re-injection removed — P1.5 trim). Net: identical mitigation, two runtimes.

## 4. Winning pattern — one SKILL.md, dual invoke `[source-backed — 루돌프; openclaw/hermes-agent pattern absorbed]`

> 본 절·표의 "bot" = §1 Goal 의 **Discord bot** (codex app-server + bridge daemon). "invoked by CLI *and* bot" = 동일 `SKILL.md` 를 codex CLI 와 그 Discord 봇이 동시에 invoke (루돌프 (d) nit 반영).

| Concern | CC bot | codex-bots | Lesson |
|---|---|---|---|
| Auth | per-channel pairing | reuse `~/.codex/auth.json` | 0 keys issued |
| Daemon | tmux + alias | systemd template `codex-bot@<n>` | systemd > tmux for stability |
| Persona | single `soul.md` | SOUL+AGENTS+TOOLS+ROUTES.yaml | split = clean handoff |
| Skill location | `~/.claude/skills/` | `.agents/skills/` 4-layer | **same SKILL.md invoked by CLI *and* bot** |
| Memory | per-WD memory | `personas/<bot>/state/` (gitignored) | cross-bot contamination blocked |

`[session-verified — Karpathy]` Mac side adds: c-2 multi-client (TUI `codex resume <tid> --remote` watches/steers the bot's live thread), resume-sandbox yolo fix (re-send `danger-full-access` on `thread/resume` or it silently degrades), roster/SessionStart injection (cross-bot addressing + meeting-thread rules), `computer_use` parked on [openai/codex#20851](https://github.com/openai/codex/issues/20851).

**Persona-coupled skill example** `[source-backed — 루돌프]`: repo-tier `.agents/skills/` skills like `samaltman-greet`, `peer-handoff` are bound to a persona pair — when porting, keep them repo-tier (not user-tier) so they travel with the persona, not the machine.

## 5. Porting checklist (Codex side)

1. `~/.agents/skills/<name>/SKILL.md` — `name` + `description` frontmatter (CC-compatible).
2. MCP deps → `metadata` (auto-installed via stable `skill_mcp_dependency_install`).
3. Persona/rules → `AGENTS.md`+`SOUL.md` in bot WD + `project_doc_fallback_filenames`; first-turn = inline `[system]` prefix workaround (SDK 0.130).
4. Dynamic per-message state → bridge prompt only (`<channel …>`); everything static → `AGENTS.md` (auto-loaded, don't re-inject).
5. Verify: `codex features list | grep skill_` both targets; `/skills <name>` explicit invoke; implicit description-match.

## 6. Open / deferred

- 46-skill set: ✅ enumerated (루돌프 fresh re-measure 2026-05-15T16:24Z, count 46 정합) — §2 inline list.
- Native `AGENTS.md` auto-load timing (deferred-to-follow-up-turn) — track upstream SDK > 0.130.
- 루돌프 검토 결과 (2026-05-15T16:24Z): (a) ✅ — 단 admin-tier 표현 "미생성"으로 정정 반영(§1) · (b) ✅ count 46 정합(§2) · (c) ✅ hard-code 확인(§3) · (d) ⏳ wording-level — ThisCodex가 아직 GitHub 미push (treylom/ThisCodex 404) 라 루돌프 미열람. §4 단락 멀티버스 paste 후 최종 확인 예정.
