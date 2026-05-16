# YOLO bridge contract — making a full-access Codex Discord bot

> `scripts/launch.sh` is only the tmux supervisor. The thing that actually
> grants (or withholds) full host access is the **bridge daemon** it runs as
> `LAUNCH_CMD`. This document is the executable contract that bridge must
> honor. The reference implementation is [`examples/bot.py`](../examples/bot.py).
>
> Hard English terms glossed on first use. 🇰🇷 Korean mirror at `## 한국어`.

## Why this file exists

A deployed user gets `launch.sh` (the 2-window supervisor) but `launch.sh`
requires a `LAUNCH_CMD` — *"starts `codex app-server` + bot.py bridge"* — that
the user supplies. If that bridge does not send the sandbox parameters
correctly, the bot silently runs with the **safe default** sandbox
(`workspace-write`, approvals on) and cannot do full-access work — or, worse,
appears to work for one turn then degrades. README prose was not enough; this
is the runnable spec + a reference `examples/bot.py`.

## The contract (a conforming bridge MUST do all of these)

1. **Send sandbox + approvalPolicy on `thread/start`.**
   `{"sandbox": <mode>, "approvalPolicy": <policy>, "cwd": <bot-wd>, "threadSource": "user"}`.
2. **Re-send the SAME sandbox + approvalPolicy on `thread/resume`.** This is
   the single nastiest bug: `thread/resume` *accepts* `sandbox`/`approvalPolicy`,
   but if you omit them the resumed thread silently falls back to the server
   default (`workspace-write` / `networkAccess:false`). Net effect: YOLO
   applies on the very first turn, then **never again** after the first resume
   (every bot restart resumes). Symptom: "it worked yesterday, today it can't
   write." Always re-send on resume.
3. **Answer server-initiated JSON-RPC requests.** After `turn/start` the
   app-server sends the client requests (`mcpServer/elicitation/request`,
   `item/*/requestApproval`, `item/tool/call`, `item/tool/requestUserInput`).
   Ignoring any of them hangs the turn forever. Minimum: accept the discord
   MCP elicitation with `{"action":"accept","_meta":{"persist":"session"}}`;
   default-deny the rest safely.
4. **YOLO is opt-in and per-bot selectable, not the default.** Ship with the
   SAFE sandbox active. Switching a bot to `danger-full-access` requires an
   explicit opt-in signal, and the choice is **per bot** so a deployment can
   run some bots full-access and others sandboxed:
   - env `THISCODEX_YOLO=1` (process-scoped — a one-off launch), **or**
   - env `THISCODEX_YOLO_FILE=/abs/path`, else a default sentinel at
     `~/.claude/channels/discord-<BOT_NAME>/.thiscodex-yolo` (the per-bot
     bridge/token state dir).

   ⚠️ **The sentinel MUST live outside the model's writable working dir.** If
   you place it inside `BOT_WD` (where Codex can write in safe mode), a model
   fed untrusted Discord text could create it and **self-upgrade safe→YOLO**
   on the next restart — defeating the whole opt-in. The default path above is
   the token-state dir precisely because the model's cwd is `BOT_WD`, not
   there. Neither signal present → safe. Unrestricted host access is never the
   zero-config behavior.

| Mode | sandbox | approvalPolicy | When |
|---|---|---|---|
| **safe (default)** | `workspace-write` | `on-request` | zero-config behavior; sandboxed. A headless bridge has no approval UI, so risky ops are **denied by default** (bridge answers approval requests with `cancel`), not prompted |
| **YOLO (opt-in)** | `danger-full-access` | `never` | `THISCODEX_YOLO=1`; unrestricted shell/fs/network — host you control + trusted private server only |

## Security (read before setting `THISCODEX_YOLO=1`)

- A YOLO bridge pipes **untrusted Discord text** to a model with unrestricted
  shell + filesystem + network on the host. Anyone who can post in a channel
  the bot reads can, in effect, run code on your machine. There is no
  in-band "treat this as data" enforcement — that instruction has zero teeth.
- Only enable YOLO on a machine you control, with a **trusted private Discord
  server** and a tight allowlist of who can address the bot.
- Keep the bot token in `~/.claude/channels/discord-<BOT_NAME>/.env`
  (`DISCORD_BOT_TOKEN=`), never in the bridge source or the repo.
- Prefer safe mode for anything exposed to people you don't fully trust. YOLO
  is for a single-operator personal automation host.

## Progress-heartbeat contract (B-fix — silent-gap prevention)

A long model turn must not be a silent gap. Two layers, both required
(defense-in-depth — one is a model instruction that can be forgotten, the
other is code that cannot):

- **Model layer**: the bot's `SOUL.md`/`AGENTS.md` carries a hard rule to
  proactively post a new message on completion / partial-artifact /
  awaiting-permission / external-handoff / blocked > ~10–15 min — without
  waiting to be pinged. (See the deployed soul templates + rules-system.)
- **Bridge layer**: `examples/bot.py` emits a heartbeat to the originating
  channel every `THISCODEX_HEARTBEAT_SEC` (default 600s) while a turn runs,
  cancelled the instant the turn finishes. This catches the case where the
  model forgets the model-layer rule. The heartbeat is generic ("still
  working, N min elapsed") — it must never leak file paths, tool output, or
  other sensitive content.

> Root incident: a generation task finished its artifacts but the next step
> (writing them to a repo outside the bridge's writable root) was blocked, so
> the bot treated the work as "not done" and stayed silent until pinged. The
> model-layer rule reframes *blocked* as a reportable state; the bridge layer
> guarantees a signal even if that rule is missed.

## Wiring it (deployed)

```bash
# safe (default) — recommended unless you specifically need full host access
BOT_WD=/path/to/bot SESSION=mybot \
  LAUNCH_CMD="bash infra-launch.sh" \
  bash scripts/launch.sh

# infra-launch.sh runs: codex app-server --listen ws://127.0.0.1:4222 &
#                       BOT_NAME=mybot python3 examples/bot.py

# YOLO (opt-in, host you control + trusted private server only)
BOT_WD=/path/to/bot SESSION=mybot \
  LAUNCH_CMD="THISCODEX_YOLO=1 bash infra-launch.sh" \
  bash scripts/launch.sh
```

`launch.sh`'s own header documents the `LAUNCH_CMD` invariant; this file is
the authority for *what that command's bridge must send*.

## See also

- [`examples/bot.py`](../examples/bot.py) — the reference bridge (this contract, implemented)
- [README.md](../README.md) §3 Setup / §6 Evidence (the resume-sandbox bug)
- [SETUP-CONFIG-GUIDE.md](SETUP-CONFIG-GUIDE.md) — soul/AGENTS/rules wiring (where the model-layer proactive rule lives)

---

## 한국어

`scripts/launch.sh` 는 tmux 관리자일 뿐이고, 호스트 전체 접근을 실제로 부여(또는
차단)하는 건 그것이 `LAUNCH_CMD` 로 실행하는 **bridge 데몬**입니다. 본 문서는 그
bridge 가 지켜야 할 실행 가능한 계약이며, 참조 구현은
[`examples/bot.py`](../examples/bot.py) 입니다. 어려운 영어는 첫 등장에 풀이.

### 왜 이 파일이 필요한가
배포 사용자는 `launch.sh`(2창 supervisor — 감독 프로세스)를 받지만, `launch.sh`
는 사용자가 제공하는 `LAUNCH_CMD`("codex app-server + bot.py bridge 기동")를
요구합니다. 그 bridge 가 sandbox 파라미터를 제대로 안 보내면 봇은 조용히 **안전
기본값**(`workspace-write`, 승인 on)으로 돌아 full-access 작업을 못 하거나, 더
나쁘게는 첫 턴만 되고 이후 저하됩니다. README 산문만으론 부족 → 실행 spec +
참조 `examples/bot.py`.

### 계약 (적합 bridge 필수)
1. **`thread/start` 에 sandbox + approvalPolicy 전송.**
2. **`thread/resume` 에 동일 sandbox + approvalPolicy 재전송** — 누락 시 resumed
   thread 가 서버 기본값(`workspace-write`/`networkAccess:false`)으로 silent
   fallback. 결과: YOLO 가 첫 턴만 적용되고 첫 resume 후 영영 안 됨(봇 재시작 =
   resume). 증상: "어제 됐는데 오늘 못 씀". resume 마다 재전송.
3. **서버 발신 JSON-RPC 요청 응답** — `turn/start` 후 app-server 가 client 에
   보내는 요청(elicitation·approval·tool call) 무시 시 턴 영원히 미완. 최소 =
   discord MCP elicitation `{"action":"accept","_meta":{"persist":"session"}}`
   수락, 나머지 안전하게 default-deny.
4. **YOLO 는 opt-in + 봇별 선택, 기본값 아님** — 안전 sandbox 로 출하. 봇을
   `danger-full-access` 로 전환하려면 명시 opt-in 신호 필요, 선택은 **봇
   단위**(일부 봇은 full-access, 나머지는 sandbox 가능): env
   `THISCODEX_YOLO=1`(프로세스 범위) **또는** env `THISCODEX_YOLO_FILE=/abs`,
   없으면 기본 sentinel `~/.claude/channels/discord-<BOT_NAME>/.thiscodex-yolo`
   (봇별 bridge/token state dir). ⚠️ **sentinel 은 모델 writable WD 밖에
   둘 것** — `BOT_WD`(safe 모드서 Codex 쓰기 가능) 안에 두면 신뢰 불가
   Discord 텍스트를 받은 모델이 그 파일을 만들어 재시작 시 safe→YOLO
   **self-upgrade** 가능(opt-in 무력화). 기본 경로가 token-state dir 인 이유 =
   모델 cwd 는 `BOT_WD` 라 거기 못 씀. 둘 다 없으면 안전.

| 모드 | sandbox | approvalPolicy | 언제 |
|---|---|---|---|
| **안전(기본)** | `workspace-write` | `on-request` | 무설정 동작, sandbox 됨. headless bridge 는 승인 UI 없음 → 위험작업 **기본 거부**(bridge 가 approval 요청에 `cancel` 응답), 프롬프트 ❌ |
| **YOLO(opt-in)** | `danger-full-access` | `never` | `THISCODEX_YOLO=1`; 무제한 — 본인 통제 호스트 + 신뢰 사설 서버만 |

### 보안 (`THISCODEX_YOLO=1` 전 필독)
YOLO bridge = 신뢰 불가 Discord 텍스트를 호스트 무제한 권한 모델에 투입. 봇이
읽는 채널에 글 쓸 수 있는 사람은 사실상 네 머신에서 코드 실행 가능. "데이터로만
취급하라" 류 in-band 지시는 강제력 0. 본인 통제 머신 + **신뢰 사설 Discord
서버** + 발신자 allowlist 좁게. 토큰은
`~/.claude/channels/discord-<BOT_NAME>/.env` 에만, bridge 소스·레포 금지. 신뢰
불완전 노출이면 안전 모드.

### progress heartbeat 계약 (B-fix — 침묵 갭 방지)
긴 턴이 침묵 갭이면 안 됨. 2계층 병행 필수(defense-in-depth — 하나는 잊힐 수
있는 모델 지시, 하나는 못 잊는 코드):
- **모델 계층**: 봇 `SOUL.md`/`AGENTS.md` 의 hard rule — 완료 / 부분산출 /
  권한대기 / 외부핸드오프 / blocked 10~15분+ 시 ping 없이 새 메시지 능동 보고.
- **bridge 계층**: `examples/bot.py` 가 턴 진행 중 `THISCODEX_HEARTBEAT_SEC`
  (기본 600s)마다 발신 채널에 heartbeat, 턴 종료 즉시 취소. 모델 계층 누락
  방어. heartbeat 는 generic("작업 중, N분 경과") — 경로·도구출력·민감내용
  유출 금지.

> 근본 사건: 생성 작업이 산출은 끝냈으나 다음 단계(bridge writable-root 밖
> repo 쓰기)가 막혀 봇이 "미완"으로 보고 ping 받기 전까지 침묵. 모델 계층은
> *blocked* 를 보고 상태로 재정의, bridge 계층은 그 규율 누락돼도 신호 보장.
