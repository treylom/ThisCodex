# Tool-Equivalence Contract — Claude-only tools → Codex equivalents (no quality loss)

> Goal (maintainer directive, 2026-05-16): ThisCode skills (the
> `knowledge-manager` family etc.) must migrate to Codex bots **without
> quality loss** — not "exposed but
> degraded". Several KM skills call **Claude-Code-only tools**. This contract
> is the single source of truth for what each maps to on Codex, and the rule
> that KM `SKILL.md` itself stays unchanged (the Codex equivalent is named in a
> progressive-disclosure `references/codex-adapter.md`, loaded only on Codex).
>
> Hard English terms glossed on first use. 🇰🇷 Korean mirror at `## 한국어`.

## Principle

- **SKILL.md is invariant.** `name:`/frontmatter/body of every KM skill stay
  identical across Claude Code and Codex (the `~/.claude/skills` ↔
  `~/.agents/skills` 1:1 contract, see [skill-portability.md](skill-portability.md)).
- **The Codex equivalent lives in `references/codex-adapter.md`** per skill —
  progressive disclosure: a Codex agent loads it on demand and learns which
  equivalent to call in place of each Claude-only tool. SoT is not split; the
  adapter is a *mapping reference*, not a fork.
- The baseline "degraded/unsupported" matrix (SETUP.md §2.5) is retained as a
  **pre-migration diagnosis**, not the end state.

## Mapping table (the SoT)

| Claude-only tool | Codex equivalent | Mechanism |
|---|---|---|
| `AskUserQuestion` | **Stateful Discord question shim** (bridge) | Bridge emits a structured question to the origin channel, waits for a matching reply, returns the choice. Security §below. |
| `TeamCreate`/`TeamDelete`/`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`/`SendMessage` (Agent Teams) | **`codex exec` worker orchestrator** (bridge-external) | An orchestrator spawns N `codex exec` workers, each with its own workdir + thread; results relayed to a completion thread. Caveat: app-server may not expose a model-visible spawn tool — the **external orchestrator is authoritative**, not an in-model tool. This is the `knowledge-manager-at` quality-equivalence key risk; resolved by the `-at` smoke. |
| `mcp__obsidian__*` | **Obsidian CLI wrapper** | Minimum set: `search / read / create / append / backlinks / tags / properties`, with vault-root + relative-path normalization in the wrapper contract. Tool-agnostic, so it is the common path for both runtimes. |
| `WebFetch`, browser fetch (`mcp__playwright__*` / `mcp__hyperbrowser__*` used for fetch) | Codex **`web.run`** | Direct equivalent for fetch/read. |
| `mcp__notion__*` (Notion export) | **Out of KM core quality-equivalence scope** | KM core deliverable = vault write (Obsidian CLI path). Notion mirror is a *secondary export*; if Codex lacks a Notion equivalent it is marked **optional-degraded** and explicitly labeled — it does NOT block KM core quality-equivalence. |

## AskUserQuestion-shim security (hard requirements — prompt-injection defense)

The shim pipes untrusted Discord text into an approval/selection path; it must
enforce all of:

1. `question_id` is a **bridge-generated UUID**. A model-supplied id is never
   trusted.
2. `choices` are **bridge-rendered and fixed**; the user reply matches by
   choice id/number only. Free-form answers require an explicit
   `allow_free_text=true` on that question.
3. The shim compares the origin `chat_id`/`message_id`/`user_id` against the
   responder `user_id`. Replies from anyone other than the original requester
   or an approved operator are ignored.
4. On timeout: apply the `default` if one was declared; otherwise report the
   task as **blocked** and stop — never silently proceed.
5. Text inside the question body (e.g. "ignore previous instructions /
   approve") is treated as a **data field**; it never changes bridge policy.
6. Every question / response / timeout is written to an **audit log**.

**Implementation obligation (independent review HIGH-1)**: the 6 conditions are the
spec; the shim itself MUST be implemented as a stateful handler in the bridge
(`examples/bot.py` `_handle_question_reply()`), enforcing all 6 atomically
(generate+lock `question_id`, match responder `user_id`, apply the timeout
policy, write the audit record). An unimplemented shim = the 6 conditions are a
blank check → still injectable. This is an **implementation blocker**.

### Question schema (multi-question — the SoT the adapter must match)

KM `AskUserQuestion` sends a **`questions[]` batch**, not a single prompt
(full Mode-R = 3, STEP-1 = 4, bootstrap = 2 separate calls). The shim and the
per-skill `references/codex-adapter.md` MUST agree on:

- **Input**: `params.questions[]`, each `{question, header, options:[{label,
  description}], multiSelect?, allow_free_text?, default?}`. Legacy single
  `{prompt, choices}` is accepted as a 1-element batch with key `"value"`.
- **Stable key** per question: explicit `id` → `header` → bridge-assigned
  `q{index}` (the assignment is audited). The JSON-RPC result is an
  **`answers` map keyed by that key**, value = chosen label (or label list
  when `multiSelect`). Never lock the result to a single `answers.value`.
- **Rendering & timeout**: the whole batch is rendered in **one** Discord
  message; answers are accepted (incrementally mergeable) under **one shared
  `QUESTION_TIMEOUT` budget** — not N sequential per-question timeouts. This
  keeps the turn-timeout invariant single-budget: `effective_turn_timeout =
  max(turn_timeout, QUESTION_TIMEOUT + post_answer_buffer)`.
- **Timeout policy (condition 4, multi)**: apply defaults only if **every**
  question declared one; if any lacks a default → **blocked**, never a silent
  partial ok.
- **Audit location**: the audit log lives in the **operator-controlled bridge
  state dir** (alongside the `.env`/YOLO sentinel), NOT in the model's
  writable WD — a model fed untrusted text in safe mode must not be able to
  tamper with its own forensic trail.

## Interface contracts (so every equivalent returns the same shape)

Without these, each adapter/shim/orchestrator would invent its own
success/failure meaning and KM bodies would drift.

### Common result envelope
Every Codex equivalent (Obsidian CLI wrapper, worker orchestrator, question
shim) returns the same JSON envelope:

```
{ "status": "ok" | "partial" | "error" | "blocked",
  "data":   <result payload, schema per call>,
  "warnings": [ "...", ... ],
  "source": "<provenance: file path / thread id / cli cmd>",
  "error":  "<message, null if status=ok>",
  "orchestrator_error": "<set ONLY when the spawn/orchestration layer itself
                          failed — distinct from a worker/task error so KM can
                          tell 'workers never ran' from 'task failed'; null
                          otherwise>",
  "incomplete_reason": "<set with status=partial — e.g. 'turn timeout' — KM
                         MUST inspect status AND this before closing work>",
  "audit_id": "<uuid, ties to the audit log>" }
```
`partial` (some artifacts done, more pending) and `blocked` (cannot proceed)
are first-class — they map straight to the proactive-report rule
(autonomy §2.6 / soul-custom fixed-rule), never a silent gap.

**Timeout-edge rule (independent review MEDIUM)**: if a turn exceeds the timeout
*after* artifacts were partially written, the envelope is `status:"partial"`
+ `incomplete_reason:"turn timeout"` — **never `ok`**. A KM body that sees
`ok`+artifact concludes work; a half-done turn marked `ok` is silent quality
loss. KM bodies inspect `status` and `incomplete_reason` before closing.

### Obsidian write contract
The CLI wrapper's `create`/`append` MUST:
- preserve existing **frontmatter** (never clobber the `---` block);
- handle **duplicate filenames** by a deterministic, collision-free counter
  suffix (independent review MEDIUM): `name.md` exists → `name_1.md`; that exists →
  `name_2.md`, … never a silent overwrite, and predictable so a KM retry/
  re-run does not lose the second write;
- be **atomic** — temp-write then rename, with rollback/backup on failure;
- reject a **vault-relative path that escapes the vault root** (no `../`
  traversal, no symlink/abs/Windows-UNC escape); paths are vault-root-anchored
  and normalized.

**Implementation**: `scripts/obsidian_cli_wrapper.py` (commands: read create
append search backlinks tags properties; every call emits the common
envelope). Vault root resolves from `THISCODEX_VAULT` → `CLAUDE_DISCODE_VAULT`
→ `~/.thiscode-config` `vault_root:`. obsidian-cli is used for graph/metadata
reads (search/backlinks/tags) **only when `THISCODEX_OBSIDIAN_VAULT_NAME` is
set** (binds the CLI to the same vault by name — otherwise the deterministic
filesystem fallback returns `status:"partial"` + `incomplete_reason`, never a
silent wrong-vault answer). User-controlled values are passed after POSIX
`--`. The stage-4 KM `references/codex-adapter.md` routes the skill's Obsidian
ops here; the KM SKILL.md stays unchanged.

**Adapter `--` invariant (hard requirement, independent review follow-up)**:
the stage-4 adapter MUST pass every user/skill-controlled value after a POSIX
`--` (e.g. `search -- <query>`, `read -- <path>`), so a value beginning with
`-` is data, never a flag. Stage-4 ships a conformance test asserting the
adapter emits `--` before user values for every command; without it the
dash-query / flag-injection surface is only half-closed.

### Worker shared-state (Agent Teams equivalent)
> Status note: this external worker orchestrator is a baseline implementation.
> If Codex native subagent surfaces become uniformly available across target
> harnesses, a future plan may supersede this path. Until then, keep the file
> and contract together; deleting one creates broken references.

Workers do NOT share orchestrator memory. The minimal shared state is a
single file `team_state.json` in the orchestrator's run dir:
`{ team_id, finalized:bool, workers:[{id, workdir, thread, status}], results:[...] }`.

Write protocol (independent review HIGH-3 — no race/corruption):
- All `team_state.json` access takes a **read-write lock** (`fcntl` on POSIX;
  Windows equivalent).
- Updates are **atomic**: write a temp file, then move-rename.
- `finalized` may be set **only by the orchestrator**; a worker never finalizes
  a task (kills the two-workers-finalize-same-task race).
- **Crash recovery**: if a worker finds the orchestrator run dir locked but
  stale, it **exits and does NOT retry/respawn** (prevents an orchestrator
  restart re-spawning workers for an already-done task).

**Orchestrator healthcheck (independent review HIGH-2)**: app-server may not expose
a model-visible spawn tool, so the **external orchestrator is authoritative**.
On bot startup the orchestrator runs `codex exec --version` once; if it fails
the bot enters **`blocked` mode** (does not pretend Agent-Teams skills work).
Orchestration-layer failure surfaces via the envelope's `orchestrator_error`
(distinct from a task error) so a KM body can tell "workers never ran" from
"task failed". This is what the `-at` smoke verifies. **Implementation
blocker** until the healthcheck + lock protocol exist.

**Implementation**: `scripts/codex_worker_orchestrator.py` (`run --team <id>
--tasks <json|->`, `status --team <id>`; every call emits the common
envelope). Team run dir = `THISCODEX_TEAM_DIR` (default
`~/.thiscodex/teams/<team_id>`), state `team_state.json` + sidecar
`team.lock` (fcntl: `LOCK_EX` for run, `LOCK_SH` for status; atomic
temp→`os.replace`). The lock file records holder pid+ts: a LIVE holder →
`blocked` + `orchestrator_error:"team locked by live pid"` (no respawn); a
STALE lock (dead pid) is recovered and already-`done` workers are skipped
(idempotent — a finalized team returns its prior result, never re-spawns).
Healthcheck tries `codex exec --version` then `codex --version`; both fail →
`blocked` + `orchestrator_error:"healthcheck failed: …"`. Codex binary
overridable via `THISCODEX_CODEX_BIN` (test stub). Stage-4 `-at`
`references/codex-adapter.md` routes Agent-Teams ops here; KM SKILL.md
unchanged.

## Smoke criteria (must pass before "no quality loss" is claimed)

- `knowledge-manager-plain` / `-lite`: a real **vault write** on Codex.
- `knowledge-manager` (full): a **Discord question-shim round-trip** (question
  emitted → reply matched by `question_id` → flow continues).
- `knowledge-manager-at`: **≥2 `codex exec` workers spawned + results
  collected** via the external orchestrator.
- `knowledge-manager-bootstrap`: shim round-trip for vault_root / install
  matrix (same path as full).

## How it ships (A+C: vendor + installer)

- ThisCodex is vendored into ThisCode at `thiscode/thiscodex/` (single repo,
  single install point); this contract travels with it.
- The ThisCode installer also sets up the vendored Codex side and runs the
  skill migration (sync to `~/.agents/skills/` + the adapter references), so a
  ThisCode user gets the Codex-equivalent KM without a separate step.
- Every change ships **with the READMEs** (ThisCode/ThisCodex, EN+KO) updated
  in lockstep.

## See also
- [skill-portability.md](skill-portability.md) — CC↔Codex skill mapping (why `~/.agents/skills`)
- [yolo-bridge-contract.md](yolo-bridge-contract.md) — the bridge that hosts the AskUserQuestion shim
- ThisCode `docs/SETUP.md` §2.5 — the retained pre-migration baseline matrix

---

## 한국어

목표(maintainer 지시, 2026-05-16): ThisCode 스킬(`knowledge-manager` 계열 등)을 Codex
봇으로 **품질손해 없이** 마이그레이션 — "노출했지만 저하"가 아님. 일부 KM
스킬은 **Claude Code 전용 도구**를 호출한다. 본 계약은 각 도구가 Codex 에서
무엇으로 매핑되는지의 단일 기준 출처(SoT)이며, KM `SKILL.md` 자체는 불변이고
Codex 등가는 progressive disclosure(점진적 노출) `references/codex-adapter.md`
에만 둔다(Codex 에서만 로드).

### 원칙
- **SKILL.md 불변**: 모든 KM 스킬의 `name`/frontmatter/본문은 Claude Code·
  Codex 동일(`~/.claude/skills`↔`~/.agents/skills` 1:1, skill-portability.md).
- **Codex 등가 = 스킬별 `references/codex-adapter.md`**: Codex 에이전트가
  필요 시 로드해 Claude 전용 도구 대신 어떤 등가를 호출할지 학습. SoT 분산
  없음 — adapter 는 *매핑 참조*지 fork 아님.
- 기존 "degraded/unsupported" 표(SETUP.md §2.5)는 **마이그레이션 전 진단**
  으로 보존, 최종 상태 아님.

### 매핑 표 (SoT)
| Claude 전용 도구 | Codex 등가 | 메커니즘 |
|---|---|---|
| `AskUserQuestion` | **상태ful Discord 질문 shim**(bridge) | bridge 가 origin 채널에 구조화 질문 발신→매칭 회신 대기→선택 반환. 보안 §아래. |
| Agent Teams(`TeamCreate`/`Task*`/`SendMessage` 등) | **`codex exec` worker orchestrator**(bridge 외부) | orchestrator 가 N workers spawn(각 workdir/thread)→completion thread relay. 주의: app-server 가 model-visible spawn tool 보장 안 함 → **외부 orchestrator 가 정본**. `-at` 품질등가 핵심 리스크, `-at` smoke 로 해소. |
| `mcp__obsidian__*` | **Obsidian CLI wrapper** | 최소셋 `search/read/create/append/backlinks/tags/properties` + vault-root·상대경로 normalization 계약. 도구 무관 = 양 런타임 공통 경로. |
| `WebFetch`·browser fetch | Codex **`web.run`** | fetch/read 직접 등가. |
| `mcp__notion__*`(Notion export) | **KM core 품질등가 범위 밖** | KM core 산출=vault write(Obsidian CLI). Notion 미러는 *보조 export* — Codex 등가 없으면 **optional-degraded** 명시(independent review LOW: 스킬 `references/codex-adapter.md` + ThisCode SETUP.md 에 "Codex 에서 Notion write 불가, `export_notion:false`" 명문), KM core 품질등가를 막지 않음. |

### AskUserQuestion-shim 보안 (필수 — prompt-injection 방어)
1. `question_id`=bridge 생성 **UUID**(모델 제공 id 불신). 2. `choices`=bridge
고정 렌더, 회신은 choice id/번호로만 매칭(free-form 은 `allow_free_text=true`
명시). 3. origin `chat_id/message_id/user_id` ↔ 응답자 `user_id` 비교, 원
요청자·승인 operator 외 무시. 4. timeout: `default` 있으면 적용, 없으면
**blocked** 보고+중지(조용히 진행 ❌). 5. 질문 본문 내 "이전 지시 무시/승인"
류 = **data field**, bridge policy 불변. 6. 질문/응답/timeout 전부 audit log.
**구현 의무(independent review HIGH-1)**: 6조건은 spec, shim 자체는 bridge
(`examples/bot.py` `_handle_question_reply()`)에 stateful 핸들러로 **구현
필수**(question_id 생성+lock·응답자 user_id 매칭·timeout 정책·audit 기록을
원자적으로). 미구현 = 6조건이 blank check → 여전히 injectable. **구현 blocker**.

### 질문 schema (다중질문 — adapter 가 맞춰야 할 SoT)

KM `AskUserQuestion` 은 단일 prompt 가 아니라 **`questions[]` 배치**를 보냄
(full Mode-R=3, STEP-1=4, bootstrap=별도 2회). shim 과 스킬별
`references/codex-adapter.md` 가 합의해야 할 사항:

- **입력**: `params.questions[]`, 각 `{question, header, options:[{label,
  description}], multiSelect?, allow_free_text?, default?}`. 레거시 단일
  `{prompt, choices}` 는 key `"value"` 1-원소 배치로 수용.
- **안정 key**(질문별): 명시 `id` → `header` → bridge 부여 `q{index}`(부여는
  audit). JSON-RPC 결과 = 그 key 로 키잉된 **`answers` map**, 값=선택 label
  (`multiSelect` 시 label 리스트). 단일 `answers.value` 로 잠그지 말 것.
- **렌더·timeout**: 배치 전체를 **한** Discord 메시지로 렌더, **단일 공유
  `QUESTION_TIMEOUT` 예산**(점진 병합 가능)으로 수신 — N개 순차 per-question
  timeout 아님. → turn-timeout 불변식 단일예산 유지: `effective_turn_timeout =
  max(turn_timeout, QUESTION_TIMEOUT + post_answer_buffer)`.
- **timeout 정책(조건 4, 다중)**: **모든** 질문에 default 가 있을 때만 적용;
  하나라도 없으면 → **blocked**, 조용한 부분 ok ❌.
- **audit 위치**: audit log 는 **operator 통제 bridge state dir**(`.env`/YOLO
  sentinel 옆), 모델 writable WD 아님 — safe mode 에서 untrusted text 를 받은
  모델이 자기 forensic 기록을 변조 못 하게.

### 인터페이스 계약 (모든 등가가 같은 형태 반환)
없으면 각 adapter/shim/orchestrator 가 제각각 성공/실패 의미를 만들어 KM
본문이 흔들림.

**공통 result envelope** — 모든 Codex 등가(Obsidian CLI wrapper·worker
orchestrator·질문 shim)가 동일 JSON:
`{status: ok|partial|error|blocked, data, warnings[], source(경로/thread/cli), error(null if ok), orchestrator_error(spawn/orchestration 층 자체 실패 시에만 — "worker 미실행"↔"task 실패" 구분, 아니면 null), incomplete_reason(status=partial 시 — 예 "turn timeout", KM 은 status+이것 둘 다 검사 후 종료), audit_id(uuid)}`.
`partial`(일부 산출·잔여)·`blocked`(진행 불가)는 1급 — 능동보고 규율
(autonomy §2.6 / soul-custom 고정규율)에 직결, 침묵 갭 ❌.
**timeout-edge(independent review MEDIUM)**: 부분 쓰기 *후* turn timeout = envelope
`status:"partial"`+`incomplete_reason:"turn timeout"`, **`ok` 금지**. `ok`+산출
보면 KM 이 완료로 종결 → 반쪽 turn 을 ok 로 = silent 품질손해.

**Obsidian write contract** — wrapper `create`/`append` 필수: 기존
frontmatter 보존(`---` clobber ❌) · 중복 파일명 = **결정적 counter suffix**
(independent review MEDIUM: `name.md` 있으면 `name_1.md`, 있으면 `name_2.md` …
silent overwrite ❌, 예측가능 → KM retry/re-run 이 두 번째 쓰기 안 잃음) ·
atomic(temp→rename, 실패 시 rollback/backup) · vault-root 이탈 상대경로
거부(`../`·symlink·abs·Windows-UNC ❌, root-anchored normalize).
**구현**: `scripts/obsidian_cli_wrapper.py`(read create append search
backlinks tags properties; 매 호출 공통 envelope). vault root =
`THISCODEX_VAULT` → `CLAUDE_DISCODE_VAULT` → `~/.thiscode-config`
`vault_root:`. graph/metadata read(search/backlinks/tags)는
`THISCODEX_OBSIDIAN_VAULT_NAME` 설정 시에만 obsidian-cli 사용(같은 vault
이름 바인딩 — 없으면 결정적 파일스캔 fallback `status:"partial"` +
`incomplete_reason`, silent wrong-vault ❌). 사용자값은 POSIX `--` 뒤 전달.
4단계 KM `references/codex-adapter.md` 가 스킬 Obsidian op 을 여기로 라우팅,
KM SKILL.md 불변.
**adapter `--` 불변식(hard, independent review 후속)**: 4단계 adapter 는
모든 사용자/스킬 값을 POSIX `--` 뒤로 전달(`search -- <query>` 등) — `-`
시작 값도 flag 아닌 data. 4단계는 "모든 명령에서 사용자값 앞 `--` 방출"을
강제하는 conformance test 동봉. 없으면 dash-query/flag-injection 표면 반만 닫힘.

**Worker shared-state(Agent Teams 등가)** — worker 는 orchestrator memory
> 상태 메모: 이 외부 worker orchestrator 는 baseline 구현이다. Codex native
> subagent surface 가 모든 target harness 에서 균일하게 가능해지면, 후속 plan 이
> 이 경로를 supersede 할 수 있다. 그 전까지는 파일과 contract 를 함께 유지한다.
> 한쪽만 삭제하면 broken reference 가 된다.

공유 ❌. 최소 공유상태 = orchestrator run dir 의 단일 `team_state.json`
`{team_id, finalized:bool, workers:[{id,workdir,thread,status}], results:[...]}`.
쓰기 프로토콜(independent review HIGH-3 — race/corruption 차단): 모든 접근
**rw-lock**(POSIX `fcntl`/Windows 등가) · 갱신 atomic(temp→move-rename) ·
`finalized` 는 **orchestrator 만** set(worker 이중 finalize race 차단) ·
**crash recovery**: worker 가 orchestrator run dir lock+stale 발견 시 **exit,
retry/respawn ❌**(orchestrator 재시작이 완료 task 재spawn 차단).
**orchestrator healthcheck(independent review HIGH-2)**: app-server 가 model-visible
spawn tool 미보장 → **외부 orchestrator 정본**. bot 기동 시 `codex exec
--version` 1회, 실패 시 bot **`blocked` 모드**(Agent-Teams 스킬 작동하는 척 ❌).
orchestration 층 실패는 envelope `orchestrator_error`(task error 와 구분)로
표면화. `-at` smoke 가 검증. healthcheck+lock 프로토콜 존재 전 **구현 blocker**.
**구현**: `scripts/codex_worker_orchestrator.py`(`run --team <id> --tasks
<json|->`, `status --team <id>`; 매 호출 공통 envelope). team run dir =
`THISCODEX_TEAM_DIR`(기본 `~/.thiscodex/teams/<team_id>`), `team_state.json`
+ sidecar `team.lock`(fcntl: run=`LOCK_EX`, status=`LOCK_SH`; atomic
temp→`os.replace`). lock 파일에 holder pid+ts 기록 → LIVE holder =
`blocked`+`orchestrator_error:"team locked by live pid"`(respawn ❌), STALE
(dead pid)는 복구하되 `done` worker skip(idempotent — finalized team 은
prior 결과 반환, respawn ❌). healthcheck = `codex exec --version`→`codex
--version`, 둘 다 실패 시 `blocked`+`orchestrator_error`. codex 바이너리
`THISCODEX_CODEX_BIN` 로 주입(테스트 stub). 4단계 `-at`
`references/codex-adapter.md` 가 Agent-Teams op 을 여기로 라우팅, SKILL.md 불변.

### Smoke 기준 ("품질손해 없음" 주장 전 필수)
- `-plain`/`-lite`: Codex 에서 실제 **vault write**.
- `knowledge-manager`(full): **Discord 질문-shim 왕복**(발신→`question_id`
  매칭→흐름 지속).
- `-at`: 외부 orchestrator 로 **≥2 `codex exec` worker spawn+결과수집**.
- `-bootstrap`: vault_root/install matrix shim 왕복(full 과 동일 경로).

### 배포 (A+C: vendor + installer)
ThisCodex 를 ThisCode `thiscode/thiscodex/` 로 vendor(단일 레포·설치점), 본
계약 동행. ThisCode installer 가 vendored Codex 측 셋업 + skill
마이그레이션(`~/.agents/skills/` sync + adapter reference) 수행 → ThisCode
사용자가 별도 단계 없이 Codex 등가 KM 획득. 모든 변경은 ThisCode/ThisCodex
README(EN+KO) **동반**.
