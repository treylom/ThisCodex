# Repo-Handoff Interactive-Default Install — Design (ThisCodex + ThisCode)

Date: 2026-05-18
Status: design (brainstorming output) — awaiting maintainer spec review
Scope: ThisCodex **and** ThisCode (paired runtime; one shared contract)
Relation to prior specs: this does **not** replace `docs/guided-installer-design.md` /
`docs/guided-installer-requirements.md`. Those define the guided engine. This adds the
**entry-mode decision layer** that routes a bare repo handoff into that engine by default.

## 1. Problem

When the repo is handed to an AI agent (the trigger incident: 재경님's WSL Codex test),
the agent reads the entry skill, sees "copy + N-step setup", and performs a
**non-interactive placement** "to be safe". The requirements doc's Core Distinction
(copying `SKILL.md` is skill placement, not guided onboarding) is violated silently.

ThisCode does not yet exhibit this (its `skills/init/SKILL.md` is wizard-default), but
the rule lives only in code, not stated at the entry — so it can regress the same way.
Maintainer directive (2026-05-18): fix ThisCodex and harden ThisCode against recurrence
in one shared contract.

## 2. Confirmed Requirements (from brainstorming dialogue)

- **R1 (Q1=C)**: Whoever receives the repo (AI agent or human), the default is
  **interactive guided**. Non-interactive only when the user explicitly says
  auto/manual, or a CI/automation opt-out is explicitly present.
- **R2 (priority correction)**: Do **not** silently route around stops to keep CI
  green. Priority is **safe fail-stop**: if a required guided decision is missing,
  stop with **zero placeholder values and zero half-install**, show why + the next
  command, and let the user intervene. (Matches the existing requirements doc:
  no invented paths, no placeholder persistence, print next command, non-zero exit.)
- **R3 (Q3=나)**: On a safe stop, if input is possible, present **in-place recovery
  options** — ① continue interactively ② proceed `--non-interactive` ③ abort. If input
  is not possible (CI / non-TTY / piped), degrade to a clean stop + next command (R2).
- **R4**: Approach 1 — reuse the verified guided engine; change only the entry layer.
- **R5**: Apply as **one shared contract** bundled in both repos (paired-runtime /
  rules-system convention; drift-checked).

## 3. Audit Findings Folded Into the Design (maintainer asked "what else breaks")

Code-grounded (read `bin/thiscodex.mjs`, `install/thiscodex.install.json`,
`bin/thiscode.mjs`, `skills/init/SKILL.md`, both CI workflows,
`tests/init/test-non-interactive.sh`):

- **A1 (load-bearing): the agent faithfully followed a guidance chain that was
  entirely non-interactive — fix the chain, not the agent.** Transcript evidence
  (WSL, codex TUI, 2026-05-18, 36KB log): the user explicitly asked for
  "단계별로 설치" (step-by-step). The agent followed README → ran
  `init --check --non-interactive` → `doctor --non-interactive` →
  `init --apply --yes`; that stopped correctly; its printed `next command` was
  `init --apply --answers <answers.json>`; the agent read that as "fabricate an
  answers file" (not "ask the user"), self-decided every value, and completed
  non-interactively. It even self-reported "방금 흐름은 안전 기본값 비대화형
  설치였다". So the center of the fix is **the entry docs and the safe-stop's
  `next_command`**, not agent blame and not `isTTY` detection. Two layers:
  (a) the entry `SKILL.md` instructs: *do not auto-run non-interactively; you can
  talk to the user via your TUI, so run guided `init --apply`, relay each prompt,
  go non-interactive only on explicit user opt-out*; and
  (b) second line: the safe-stop's `next_command` must offer the R3 interactive
  recovery, not only `--answers <json>` (see A2). No new flag (A6); no `isTTY`
  reliance for the agent path.
- **A2 (load-bearing): the safe-stop works, but its `next_command` points only to
  the non-interactive escape.** Transcript: `init --apply --yes` did **not** silently
  degrade — it correctly stopped at `choose_install_surface` ("must be one of
  placement, guided"). The defect is that the printed `next command` was
  `init --apply --answers <answers.json>` — a non-interactive path only. A safe-stop
  that recovers exclusively via a fabricated answers file invites exactly the
  self-answer bypass observed. Fix: on a missing required decision the stop must
  present the **R3 in-place recovery** (① continue interactively ② `--non-interactive`
  ③ abort) when input is possible; the non-interactive `--answers` command is shown
  only as the explicit-opt-out branch, never as the sole next step. Also default
  resolved `install_surface = 'guided'` when interactive/unspecified; `placement`
  only on explicit choice; never degrade silently to placement.
- **A3: ThisCode has two entry surfaces** — `bin/thiscode.mjs` (manifest runner) and
  `scripts/claude-discode-init.sh` (wizard that `skills/init/SKILL.md` drives). Fixing
  one leaves the other as a recurrence path. Design names the **canonical
  repo-handoff entry per repo** and the other must route to / agree with it.
- **A4: output-string-pinned tests.** `tests/init/test-non-interactive.sh` asserts
  literal Korean strings. Any wording change ships with the test change in the same
  commit (TDD).
- **A5: CI is safe (good news, but guard it).** ThisCodex CI calls
  `init --check --non-interactive` / `doctor --non-interactive` explicitly; ThisCode
  CI uses sub-installers + `claude-discode-init.sh --non-interactive` + non-TTY pipe
  smoke. The default flip will **not** hang CI. Add an explicit guard test:
  "no flag + non-TTY = safe-stop, never hang" so a future forgetful CI/script is
  caught (R2 priority).
- **A6: no new flag.** Reuse existing `--non-interactive` (CI/diagnostic) and
  `--yes` / `--answers` (automated apply). Do **not** add `--auto` (flag sprawl;
  YAGNI). The design's "explicit opt-out" = these existing flags.
- **A7 (topmost cause, was missing): the entry docs themselves recommend the
  non-interactive command first.** Transcript: the agent followed README, whose
  recommended first commands were `npx … init --check --non-interactive` then
  `… init --apply --yes`. The agent was on a non-interactive rail from line one — it
  obeyed the docs. Earlier scope only covered `SKILL.md`; the transcript proves the
  **README/entry docs are the real handoff entry point**. Fix: the first recommended
  command in README / README.ko / SKILL.md must be the **interactive guided** one
  (`thiscodex init` → guided); `--non-interactive` / `--yes` / `--answers` appear
  only under an explicit "CI / automation opt-out" subsection, never as step 1.
- **A8 (verified, codex-cli 0.130 — 손석희 raw, 2026-05-18): the plugin-install
  path is non-functional on Codex; it MUST NOT be an entry step.** Raw findings:
  no `codex plugin install` subcommand (only `marketplace add/upgrade/remove`);
  `codex plugin marketplace add treylom/ThisCodex` fails with
  `marketplace root does not contain a supported manifest` — the repo ships
  `.codex-plugin/plugin.json`, but codex marketplace requires
  `.agents/plugins/marketplace.json`; cwd auto-load of `.codex-plugin/plugin.json`
  fails; `thiscodex` skill / `tool_search` recognition = 0. Maintainer decision
  2026-05-18 = **Option A**: do not raise plugin to entry step 1; keep loose-skill
  / `thiscodex init` first; **document the plugin path honestly as "incomplete on
  Codex 0.130 — future `.agents/plugins/marketplace.json` packaging required"**.
  ThisCode (Claude Code) plugin path — **RE-VERIFIED 2026-05-19 (Karpathy):
  VERIFIED WORKING**, the earlier "unverified" label was over-cautious and is
  retracted. Evidence: ThisCode ships a valid `.claude-plugin/marketplace.json`
  + `plugin.json`; `claude plugin marketplace add` is a real Claude Code CLI
  subcommand (claude 2.1.143, unlike codex 0.130 which lacks the equivalent);
  user WSL run `/plugin marketplace add treylom/ThisCode` →
  `/plugin install thiscode@thiscode-marketplace` → `/reload-plugins` loaded
  *5 plugins · 23 skills · 8 agents · 4 hooks* end-to-end. So the honest label
  for ThisCode flips to "plugin-marketplace path verified working; git clone +
  wizard is an equally supported alternative". Codex/ThisCodex side stays
  broken (above, 손석희) — different harness. GUI `/plugins` auto-recognition
  still unverified from CLI → separate GUI check before any GUI-first guidance.

## 4. Design (Approach 1, both repos)

### 4.1 Shared contract (bundled in both repos)

A single contract file (canonical copy in ThisCodex `docs/`, bundled/mirrored into
ThisCode, drift-checked by the existing `km-version.sh`-style mechanism):

> **Repo-handoff install contract.** Default = interactive guided. Non-interactive
> only on explicit `--non-interactive` / `--yes` / `--answers`. AI agents handed the
> repo MUST run the guided flow and relay each question to the user; reporting
> "copied = installed" is forbidden (that is placement, not onboarding). Missing
> required guided decision ⇒ safe-stop: no placeholder, no half-install, print why +
> next command, non-zero exit. If input is possible, offer in-place recovery
> (① interactive ② --non-interactive ③ abort); if not, clean stop + next command.

### 4.2 ThisCodex (core fix)

- **README / README.ko first command (A7, topmost cause)**: the first recommended
  command becomes `npx github:treylom/ThisCodex init` (interactive guided). A clearly
  separate "CI / automation (non-interactive)" subsection holds
  `--check --non-interactive` / `--apply --yes` / `--answers`. No non-interactive
  flag appears as step 1.
- **Entry skill `skills/thiscodex/SKILL.md`**: top-of-file instruction = run
  `thiscodex init` guided; relay questions to the user via the TUI;
  `--non-interactive`/`--yes`/`--answers` only on explicit user opt-out; never report
  "copied = installed". Existing 8-step / Verify / Troubleshooting demoted to
  "reference (guided performs these)".
- **Plugin path honest-labeling (A8)**: SKILL.md / README plugin lines must state
  the verified status — on codex 0.130 the plugin path is **incomplete**
  (`codex plugin install` absent; `marketplace add` needs
  `.agents/plugins/marketplace.json`, repo ships only `.codex-plugin/plugin.json`;
  no cwd auto-load). It is **not** an entry step; loose-skill / `thiscodex init`
  stays first. Phrase plugin as "future marketplace packaging required", not as a
  usable install today.
- **`bin/thiscodex.mjs`**: `init` default = guided apply unless explicitly opted out.
  `install_surface` resolves to `guided` by default (A2); `placement` only explicit;
  guided-implied + missing required answer ⇒ safe-stop.
- **Safe-stop `next_command` (A2 core)**: on a missing required decision, when input
  is possible the stop presents the R3 menu (① continue interactively
  ② `--non-interactive` ③ abort). The `--answers <json>` / `--yes` command appears
  only as the explicit-opt-out branch — **never as the sole `next command`** (that
  is the exact line the transcript agent followed into self-answering). When input is
  impossible (CI/non-TTY): clean stop + `next_command` + non-zero, no hang.

### 4.3 ThisCode (harden + align — already wizard-default)

- **Entry skill `skills/init/SKILL.md`**: add the shared-contract block at the top
  (explicit "default interactive; non-interactive only on explicit opt-out; agent
  relays questions"), so an AI agent cannot re-misread it into non-interactive (A1).
- **Canonical entry (A3)**: declare `thiscode init` (via `bin/thiscode.mjs`) the
  canonical repo-handoff entry that SKILL.md routes to;
  `scripts/claude-discode-init.sh` wizard must agree with the same contract
  (default interactive, same safe-stop/recovery semantics) or route to it.
- **`bin/thiscode.mjs`**: the **`init` handoff path** defaults to guided when not
  explicitly opted out; align safe-stop + in-place recovery (R3) with ThisCodex.
  Bare `thiscode` with no subcommand keeps its existing `check` semantics — the
  handoff entry is `thiscode init`, not bare `thiscode`, so existing direct-CLI
  `check` users are not surprised (no blast radius beyond the handoff path).
- **Tests**: update output-pinned assertions in lockstep (A4).

### 4.4 Data flow (both)

entry (AI reads SKILL.md / human runs CLI) → mode decision: explicit
`--non-interactive`/`--yes`/`--answers`? → yes: non-interactive; no: **guided default**
→ guided runner (existing engine) → per step: input possible? yes → ask (agent
relays); no → required? safe-stop + recovery/next-command : skip optional → verify
(doctor replay, existing) → persist confirmed-state only (existing; no placeholder).

## 5. Error Handling & Recovery

Existing 4-part failure output (what / why / next command / blocks-vs-optional) is
kept and extended with the R3 in-place recovery menu when input is possible. Never
hang in non-interactive (existing invariant; A5 guard test enforces it).

## 6. Test Strategy (TDD; existing regression must stay green)

Existing green to preserve: ThisCodex non-interactive CI (`init --check
--non-interactive`, `doctor --non-interactive`), rollout-proof skip/pass/fail triad,
placement-only state non-contamination, 3-OS CI; ThisCode manifest non-TTY pipe
smoke, doctor=verify replay, `test-non-interactive.sh` (updated wording in lockstep).

New tests:

1. No-arg / no-flag + **TTY** ⇒ guided interactive (both repos).
2. Explicit `--non-interactive`/`--yes`/`--answers` ⇒ non-interactive (unchanged).
3. Guided-implied + missing required answer + input-possible ⇒ 3-option recovery,
   zero placeholder persisted.
4. Same + **non-TTY** ⇒ clean safe-stop, `next_command` printed, non-zero, **no hang**
   (A5 guard — "flag forgotten stays safe").
5. ThisCodex `install_surface` defaults to `guided`; never silent placement-degrade
   (A2 regression lock).
6. Repo-handoff smoke: simulated agent reading SKILL.md does **not** end in
   non-interactive placement (A1 regression lock) — both repos.
7. ThisCode: both entry surfaces obey the same contract (A3).
8. **Safe-stop `next_command` offers interactive recovery, not only `--answers`**
   (A2 regression lock): on a missing required decision with input possible, the
   printed next-step text contains the interactive option and does not present
   `--answers <json>` / `--yes` as the sole continuation.
9. **Entry-doc first command is the interactive one** (A7 regression lock):
   README / README.ko / SKILL.md step 1 is `init` (guided); non-interactive flags
   live only under the explicit CI/automation subsection. Doc-lint test, both repos.
10. **Plugin path is honestly labeled** (A8 regression lock — re-verified
    2026-05-19): ThisCodex README/SKILL.md plugin mentions carry the
    "incomplete / future marketplace packaging" caveat and do not appear before
    the `init` / loose-skill step (Codex broken). ThisCode README must NOT
    carry the (false) "unverified" caveat — it is framed **verified working**
    while keeping the Codex-side "verified broken" note and the git-clone
    alternative. Doc-lint test, both repos
    (`tests/init/repo-handoff.test.mjs` A8 group).

## 7. Out of Scope (YAGNI)

Daemon auto-start/supervision; automatic system-package install beyond consented
one-liner; Windows-sync behavior changes; new `--auto` flag (A6); rewriting the
guided engine (Approach 1 reuses it).

## 8. Cross-Repo Sync & Drift (porting-infra §2)

Canonical contract lives in ThisCodex `docs/`; bundled into ThisCode under its
`contracts/` convention; drift detected by the existing `km-version.sh`-style check.
Both repos' entry skills reference the same contract text. Changes ship to both
repos in lockstep.

## 9. Review Gates

1. Brainstorming dialogue + transcript-grounded precision pass: complete.
2. Maintainer directive 2026-05-18: "고치고 바로 실행까지 진행" — spec-review /
   writing-plans gate explicitly overridden (autonomy: explicit user instruction >
   skill gate). Proceed directly to TDD implementation.
3. Implementation in small commits, **failing test first**, both repos in lockstep.
   Order: ThisCodex A7 (README/SKILL first command) → A2 (safe-stop next_command =
   R3 recovery) → A1 (SKILL.md agent instruction) → ThisCode harden/align → shared
   contract + drift. Each step: red test → green → keep existing regression green.

## 10. WSL Repo-Handoff Debug Follow-up (2026-05-19, autonomous)

Maintainer ran a real WSL handoff (publishing-house 3-bot setup) and returned
install/debug logs ("이거도 포함해서 디버깅 계획"). Each claim was re-verified
against current local code (logs were from a different env / pre-push clone =
subordinate report → no phantom fix). All findings confirmed real; fixed TDD
(red→green), zero regression. Codex side included per maintainer ("중간중간
코덱스 디버깅 포함!").

| # | Finding (verified location) | Resolution | Lock |
|---|---|---|---|
| A | `commands/install-hooks.md` PLUGIN_DIR detect = only 2 candidates; `self-update.md` same; `create-bot.md` consumed `$PLUGIN_DIR` with **no assignment at all** | ordered probe over all 5 real install locations (marketplace / manual clone / cache/local / dev clone / versioned cache), select by needed-file presence | `tests/init/plugin-dir-detect.test.mjs` (4) |
| B | `hooks/bot-session-init.sh:47` WD→memory `sed 's\|/\|-\|g; s\|_\|-\|g'` mis-handles spaces/`.`/Hangul → diverges from Claude Code native `~/.claude/projects` encoding | `sed 's\|[^a-zA-Z0-9]\|-\|g'` (empirically confirmed against this machine's real project dirs incl. an underscore sample) | `tests/init/bot-session-init.test.mjs` (B) |
| C | same hook L37 bare `discord` state dir → `BOT=discord` → `discord-discord/soul.md` MISSING mis-inject | `case` guard: bare `discord` → silent exit 0 (matches no-bot philosophy) | …test.mjs (C) |
| D | same hook L54-59 shared-memory detect missed workspace-local `shared-memory/SHARED-INDEX.md` | added 3rd probe `$PWD/shared-memory/SHARED-INDEX.md` | …test.mjs (D) |
| E | `create-bot.md` / `start.md` OAuth step didn't flag the multi-bot **separate-invite** trap (root cause of the WSL "giwa no-response") | inline ⚠️ callout in both + `docs/08-debug-노하우.md` **J-3** (per-bot invite + no-response API diagnostics) | `tests/init/debug-knowhow-handoff.test.mjs` |
| J-2 | external official discord plugin `…/discord/server.ts` (≈L806) `if (msg.author.bot) return` **before** `gate()` → all bot-authored msgs dropped → multi-bot collaboration broken. **Outside our repos** (overwritten on plugin update = J-1 realized) | documented `docs/08-debug-노하우.md` **J-2** (root cause + 3-guard recipe + re-apply note) + ThisCodex SKILL.md Troubleshooting cross-ref | doc-lint (debug-knowhow test); ThisCodex own test |
| A8 | (see §3) earlier "ThisCode plugin path unverified" was **factually wrong** | retracted; README/SKILL/spec re-framed verified-working; Codex side stays broken | `tests/init/repo-handoff.test.mjs` A8 group (4) |

### 10.1 ⓑ ⓒ — escalated by maintainer → BUILT autonomously (conservative)

Initially flagged design-gated. Maintainer then explicitly escalated:
"전부 다 끝까지 해 … 다 완벽히 해놔" → autonomy §1 override (explicit user
instruction > brainstorming gate). Built with the safe designs that had been
proposed; the irreversible/info-poor item (ⓐ master merge) stayed flagged.

- **ⓑ J-2 permanent fix — BUILT**: `scripts/patch-discord-bot-drop.sh`
  idempotently re-applies the 3-guard to the external plugin server.ts.
  Safety: fail-OPEN (always exit 0 — never bricks `/self-update`), `.bak`
  before edit, exact-match-only (warns instead of blind-editing if upstream
  shape changed), idempotent marker. Wired into `/self-update pull` Step 4;
  opt-in SessionStart wiring documented (auto-editing external code = opt-in,
  not forced). Tests `tests/init/patch-discord-bot-drop.test.mjs` (4). The
  *truly permanent* form (continuous auto re-patch on every session for all
  users) deliberately NOT forced — opt-in only (invasive to auto-edit
  third-party code); that broader default remains a maintainer call.
- **ⓒ Stop-hook debugging — BUILT**: `hooks/stop-debug-surface.sh`, exactly
  the opt-in **fail-OPEN** design proposed — ALWAYS exit 0, NEVER exit 2,
  cannot deny session end (deliberate opposite of fail-CLOSED
  stop-pending-task-check.sh, which it coexists with, not replaces). Surfaces
  (stderr) uncommitted source/test work on session end. Opt-in (not
  auto-registered). Tests `tests/init/stop-debug-surface.test.mjs` (5) incl.
  an explicit "never exits 2" safety assertion.
- **ⓐ master merge — STILL FLAGGED** (unchanged): irreversible public default-
  branch action; the feature branches also carry unrelated in-flight work
  (e.g. image-pipeline) that a merge would publish; branch model unknown.
  Authorization scope = work, not release strategy. Maintainer decision.

### 10.3 design-md → comprehensive frontend skill (maintainer batch-decided)

Maintainer answered the brainstorming fork in one batch (asleep, "질문 한 번에"):
**Q1=B** generalize tool-agnostic · **Q2** semantic-token slot schema as the
1급 first section · **Q3=B** 코난 OCRs the source carousel for the author's exact
naming rules (delegated async, non-blocking) · **Q4** non-breaking. Plus:
"/search vault for awesome-design.md etc. → elevate to a comprehensive frontend
skill", and "gpt-5.5 (Codex) judgment on all this work".

Built: `~/obsidian-ai-vault/.claude/skills/design-md/SKILL.md` rewritten
(name kept = non-breaking invocation) — §0 semantic-token slot schema FIRST
(the convergence contract), §1 IA, §2 component form/function split, §3
slot-bound design-system synthesis, §4 narrative + anti-pattern gate, §5
tool-agnostic input adapters with the **Stitch flow preserved as one adapter**
(Q4), §6 Stitch-DESIGN.md-compatible cross-AI output. Grounded in the vault
corpus discovered via `/search` + direct find: [[바이브코딩-디자인시스템-가이드]]
(4 principles), [[AI-프론트엔드-디자인-가이드-MOC]] (GPT-5.4 4 principles),
[[design-md-claude-code-슬롯-아님]] (Stitch standard + awesome-design-md
ecosystem), [[Impeccable-AI-Frontend-Design-Skill-2026-04]] (7-foundation /
anti-patterns), [[2026-05-18-dddesign.io-design.md-시멘틱토큰]] (the slot
insight). Vault repo auto-commits the skill; prior version retained in git.
gpt-5.5/Codex adversarial review of the whole change set: dispatched
(codex-rescue), findings folded before final report.

### 10.2 Cross-repo scope

B/C/D are ThisCode-only (Codex uses `project_doc_fallback` SOUL.md/AGENTS.md —
no `bot-session-init.sh` equivalent; verified no analog). A is ThisCode-side
(ThisCodex install is `thiscodex init` / `thiscodex.install.json` — different
mechanism, no PLUGIN_DIR brittleness). J-2 + A8 apply to both → ThisCodex
SKILL.md carries the J-2 cross-ref and the corrected A8 framing; locked by
ThisCodex's own `tests/init/repo-handoff.test.mjs` (porting-infra §2:
each repo self-tests its own mirror, no cross-repo filesystem coupling).
