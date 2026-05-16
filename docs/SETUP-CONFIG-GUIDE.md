# Setup → Config Guide — wiring your Codex bot's brain

> After the [README](../README.md) §Setup installs ThisCodex, **this guide
> configures the bot's behavior**: the config surfaces a Codex bot reads, in
> what order, and how to author each one. It is a *hub* — it links to the
> canonical specs/templates instead of repeating them (same progressive-
> disclosure idea — 필요할 때만 펼치는 점진적 노출 — the rules system uses).
>
> Hard English terms glossed on first use. 🇰🇷 Korean mirror at `## 한국어`.

## The config surfaces (and load order)

A ThisCodex (Codex CLI) bot composes behavior from these, in order:

```
1. AGENTS.md            ← project + bot working-dir meta. Codex auto-loads this
   (Codex's CLAUDE.md-     as the project doc. Points ONLY at rules/INDEX.md.
    equivalent)
        ↓
2. soul.md / SOUL.md    ← persona / voice / model meta. The bridge injects it
   (persona doc)           at session start (mirrors Claude's SessionStart).
        ↓
3. rules/INDEX.md       ← progressive disclosure. Bridge injects per-turn
   (router; on demand)     dynamic state; static rules stay here, pulled by
                            trigger — never re-injected every turn.
        ↓
   memory / meetings    ← run-time state, not config
```

**single source of truth** (단일 기준 출처 — one place each fact lives): keep
each surface to its own concern. Do not copy rules into `AGENTS.md`/`soul.md`
— that is the context-bloat failure the rules system exists to prevent.

| Surface | What it owns | Author from |
|---|---|---|
| `AGENTS.md` | project meta + bot-WD meta + INDEX pointer | §1 |
| `soul.md` | persona, voice, signatures, model | §2 |
| `rules/` | situational operating rules | §3 → [rules-system.md](rules-system.md) |

See also [skill-portability.md](skill-portability.md) §3 for *why* Codex uses
`AGENTS.md` and how the bridge injection differs from Claude Code.

## §1 — AGENTS.md (the meta file, Codex side)

Codex auto-loads `AGENTS.md` as the project document — it is the Codex
equivalent of Claude Code's `CLAUDE.md`. Keep it thin (it is always in
context). It carries: project, the bot's working-dir role, the **load order
above**, and a single pointer to `rules/INDEX.md` — never the rule bodies.

Minimal template:

```markdown
# <Project> — bot working-dir meta (Codex)

This dir is the project root and **<BotName>'s working dir**. On a bot
session, load in order:

0. ./AGENTS.md (this file — project + bot-WD meta; Codex auto-loads)
1. <path>/soul.md (persona · voice · model)
2. rules/INDEX.md (situational rules — Read the matched topic file on demand)
3. meetings/<date>-<topic>/ (current task context)

**Bot meta**: <BotName> (`<@discord-id>`) · <one-line role> · model `<id>` ·
WD `<abs-path>`.

## Operating rules = rules/ (progressive disclosure)
Every turn: self-check rules/INDEX.md trigger table → Read the matched row's
file → apply. Conflict priority: **explicit user instruction > rule file >
inline default**.
```

Gotcha: the pointer block must be the *only* rules content here. A rule that
grows inline moves to `rules/<topic>.md`, leaving one INDEX row.

## §2 — soul.md (persona / voice / model)

ThisCodex ships no template of its own — reuse the companion repo's fillable
soul templates (anatomy is harness-agnostic):

| Template | For |
|---|---|
| [soul-custom.md](https://github.com/treylom/ThisCode/blob/main/templates/soul-custom.md) | blank anatomy (11 sections) |
| [soul-general-assistant.md](https://github.com/treylom/ThisCode/blob/main/templates/soul-general-assistant.md) | general helper |
| [soul-research-bot.md](https://github.com/treylom/ThisCode/blob/main/templates/soul-research-bot.md) | research / source-tracing |
| [soul-writing-bot.md](https://github.com/treylom/ThisCode/blob/main/templates/soul-writing-bot.md) | writing persona |
| [soul-schedule-bot.md](https://github.com/treylom/ThisCode/blob/main/templates/soul-schedule-bot.md) | scheduling |

Steps:
1. Copy the closest template into your bot's working dir as `soul.md`.
2. Fill the **frontmatter** (문서 맨 위 `---` 메타 블록 — `name`,
   `description`, `version`, `triggers`). The bridge reads this to inject.
3. Keep the **forced-persona self-check table** + **completion signature**
   (`— <BotName>`) — signature absence is the #1 persona-regression symptom.
4. Set the model meta to a real Codex model id (e.g. a `gpt-5.x` id your
   Codex CLI exposes).

## §3 — rules/ (progressive-disclosure operating rules)

Full convention (problem, pattern, how-to-add, **Codex variant**):
**[rules-system.md](rules-system.md)** — canonical, in this repo. Read it
once; do not duplicate it here. Its "Applying to a Codex bot" section is the
authoritative spec for the `AGENTS.md` → `rules/` wiring.

Minimal worked example —

`rules/INDEX.md` (router; the only file `AGENTS.md` points at):
```markdown
| Trigger (when this situation) | Rule file | One-line gist |
|---|---|---|
| Replying to an external channel | discord-comms.md | Use the reply tool; terminal text never reaches the user |
```
`rules/discord-comms.md` (loaded only when that row matches):
```markdown
# Rule: external-channel reply
- The user reads the channel, not your terminal transcript. Send via the
  channel reply tool. Terminal-only output = user never sees it.
```

## §4 — How to set up & how to ask (first run)

Install per [README §Setup](../README.md) and [SKILL.md](../skills/thiscodex/SKILL.md)
(register: `codex plugin marketplace add treylom/ThisCodex`; invoke via
`/skills thiscodex` or description match — there is no `codex plugin install`
subcommand).

Example asks and what to expect:

| You ask | The bot does |
|---|---|
| "Set up codex as a discord bot like claude code" | walks the bridge + persona + rules wiring (this guide) |
| "Port these Claude Code skills/rules to Codex" | applies the [skill-portability.md](skill-portability.md) path |
| "Why did you do X?" | answers from the injected soul + the rule that applied (it names which) |

Off-persona / rule ignored? Check (a) `soul.md` frontmatter valid, (b) the
situation matches an `rules/INDEX.md` trigger row, (c) the bridge actually
injected the persona (see SKILL.md §Verify / §Troubleshooting).

## §5 — Skills 2.0 conformance checklist

Any skill under `skills/<name>/SKILL.md` should pass:

- [ ] **Frontmatter present** — `---` block with `name` + `description`
- [ ] `name:` **kebab-case**, matches the directory
- [ ] `description:` **third-person** + a **"Use when …"** trigger phrase
- [ ] **SKILL.md ≤ 500 lines** — heavy detail → `references/` (progressive
      disclosure: load depth on demand)
- [ ] **No orphan dirs** — every skill dir has a `SKILL.md`
- [ ] **No broken references** — every `references/` link resolves
- [ ] **Imperative form** — "Run", "Check" (not "you should …")
- [ ] **Reference-type skills** set `disable-model-invocation: true`

This checklist **is** the conformance standard (Anthropic Skills 2.0 — the
12-check rubric: frontmatter, name, description, ≤500 lines, directory
structure, invocation control, no orphans/broken refs, progressive disclosure,
imperative form). Walk every box manually, and grep the diff for hardcoded
user paths / secrets, before any push.

## See also

- [README.md](../README.md) / [README.ko.md](../README.ko.md) — overview + install
- [skill-portability.md](skill-portability.md) — CC ↔ Codex porting (why AGENTS.md)
- [ThisCode](https://github.com/treylom/ThisCode) — the Claude Code companion runtime

---

## 한국어

[README](../README.md) 설치 **후** Codex 봇 행동을 설정하는 가이드. 봇이 읽는
설정 표면과 **로딩 순서**, 작성법을 묶고, 깊은 내용은 정본 문서로 링크(필요할
때만 펼치는 progressive disclosure — 점진적 노출). 어려운 영어는 첫 등장에 풀이.

### 설정 표면 + 로딩 순서
`AGENTS.md`(프로젝트+봇 WD 메타 — Codex 가 프로젝트 문서로 자동 로드, Claude 의
CLAUDE.md 대응, **rules/INDEX.md 만 가리킴**) → `soul.md`(페르소나·말투·모델,
bridge 가 세션 시작 시 주입) → `rules/INDEX.md`(라우터; bridge 는 매 턴 동적
상태만 주입, 정적 규칙은 트리거로 pull — 매 턴 재주입 안 함) → 메모리/회의록.
**single source of truth(단일 기준 출처)**: 규칙을 AGENTS.md/soul.md 에 복붙
금지 — context 비대화 방지가 rules 시스템의 존재 이유.

### §1 AGENTS.md (Codex 메타)
항상 context — 얇게. (a)프로젝트 (b)봇 WD 역할 (c)위 로딩 순서 (d)
`rules/INDEX.md` 포인터 1개. 템플릿은 위 영문 §1 코드블록.

### §2 soul.md
ThisCodex 자체 템플릿 없음 → 동반 레포 ThisCode 의 `templates/soul-*.md`(절대
링크, 위 표) 중 가까운 것 복사 → frontmatter(맨 위 `---` 메타 블록) 채움 →
자가점검 표 + 완료 서명(`— <봇이름>`) 유지 → 모델 메타를 Codex CLI 가 실제
노출하는 `gpt-5.x` id 로.

### §3 rules/
정본 = [rules-system.md](rules-system.md)(본 레포, 중복 금지). "Applying to a
Codex bot" 절이 AGENTS.md→rules/ 배선 정본. 매 턴 INDEX 스캔 → 매칭 파일 그때
Read → 적용. 우선순위 = **사용자 명시 지시 > rule 파일 > inline 기본**.

### §4 설정·질문 방법
[README §Setup](../README.md) + [SKILL.md](../skills/thiscodex/SKILL.md) 대로
설치(`codex plugin marketplace add treylom/ThisCodex`, `/skills thiscodex` 로
호출 — `codex plugin install` 서브커맨드 없음). 페르소나/규칙 벗어나면 soul.md
frontmatter·INDEX 매칭·bridge 주입(SKILL.md §Verify/§Troubleshooting) 점검.

### §5 Skills 2.0 체크리스트
`skills/<name>/SKILL.md`: frontmatter 존재 · `name` kebab-case ·
`description` 3인칭 + "Use when …" · ≤500줄(초과분 `references/`) · orphan
디렉토리 없음 · 깨진 reference 없음 · 명령형 · reference형은
`disable-model-invocation: true`. **본 체크리스트가 곧 표준**(Anthropic
Skills 2.0 12-check 루브릭). push 전 매 항목 수동 확인 + diff 에서 하드코딩
경로·시크릿 grep 검사 필수.
