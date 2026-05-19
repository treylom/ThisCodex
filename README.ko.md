![ThisCodex — Tofu](assets/readme-banner.png)

# ThisCodex (한국어)

> **Claude Code + Codex CLI 멀티 에이전트 봇**을 **디스코드**로 운영하고, **옵시디언 볼트(Obsidian vault, 노트 저장소)**의 폴더·메모리 규칙과 연결하는 재현 가능한 세팅 모음.
>
> 🇺🇸 [English README](./README.md) · 함께 쓰는 런타임: [ThisCode](https://github.com/treylom/ThisCode) (Claude Code 쪽) · 📖 [시작 안내서 (PDF, 초보자·한/영 병기)](docs/getting-started/ThisCode-ThisCodex-getting-started.pdf) · 본 레포 = **Codex 쪽** + 두 런타임 공통 규칙.

![ThisCodex 핵심 그림 — 구조화된 옵시디언 볼트, 작업 디렉토리별 적합한 봇, 디스코드로 운영, 봇끼리 협업](assets/core-mental-model.png)

> **처음 오셨나요?** 이 그림 한 장이 핵심입니다 — **구조화된 옵시디언 볼트**에 **작업 디렉토리별 적합한 봇**(Claude Code *와* Codex)을 두고, **디스코드**로 운영하며 봇끼리 협업합니다. ThisCodex는 Codex 쪽 — 스킬(`skills/thiscodex/`)로 설치하고 §3을 따라오시면 됩니다.

![ThisCode + ThisCodex 상세 배선 (tmux · app-server · 디스코드 · 볼트)](assets/architecture.png)
>
> **시작 전 권고:** 옵시디언 **폴더 구조**부터 잡고, 메모리·내부검색을 제대로 쓰려면 **옵시디언 설치** 권장. 옵시디언 없이도 단순 연결용 봇은 가능하나 메모리·내부검색 품질은 **보장되지 않습니다**.

ThisCodex는 OpenAI의 `codex` CLI 에이전트를 Claude Code 디스코드 봇과 **똑같이** 동작하게 만드는, 검증된 패턴을 담은 모음입니다. 같은 페르소나 규율, 같은 디스코드 입출력, 같은 볼트 규칙 + 여러 에이전트가 한 디스코드 작업공간에서 협업하는 규칙(봇끼리 호출법, 회의 스레드, 세션 시작 시 컨텍스트 주입)까지.

프레임워크가 아닙니다. 직접 조립하는 **문서화된 building block(구성 부품) 모음**이며, 모든 주장에 출처가 달려 있습니다.

---

## 1. 무엇이 되나

| 기능 | 상태 | 방식 |
|---|---|---|
| Codex CLI를 상시 디스코드 봇으로 | ✅ 작동 | `codex app-server`(화면 없는 백그라운드 실행) + 파이썬 bridge(다리) 데몬 `bot.py` + discord.py |
| 멀티 클라이언트 동일 스레드(봇 대화를 터미널 화면으로 관전·개입) | ✅ 작동 | 같은 app-server에 `codex resume <스레드ID> --remote ws://…` |
| 페르소나·볼트 규칙 자동 로드 | ✅ 작동 | `~/.codex/config.toml`의 `project_doc_fallback_filenames = ["SOUL.md","AGENTS.md"]` |
| 봇끼리 호출 + 회의 규율 | ✅ 작동 | `bot-roster.yaml`(단일 기준 파일)을 세션 시작 시 주입 |
| 안전 기본 / YOLO(전체 권한) opt-in | ✅ 작동 | 기본 `workspace-write`, `THISCODEX_YOLO=1` 시에만 `thread/start`·`thread/resume` 둘 다 `danger-full-access`·`never` 전송 ([계약](docs/yolo-bridge-contract.md)) |
| 이미지 생성 | ✅ 작동 | codex 내장 `image_gen.imagegen` 도구 |
| 웹 조회·검색 | ✅ 작동 | codex 내장 `web.run` 도구 |
| `computer_use`/`browser_use`(데스크톱·브라우저 제어) | ⏸️ **보류** | `codex features list`엔 `stable,true`로 뜨지만 **이를 노출하는 공식 `codex` 명령/서브커맨드가 없어서** CLI/app-server 경로에서 **호출 가능한 도구가 아님** (데스크톱 앱 번들 MCP 전용). 업스트림 추적: [openai/codex#20851](https://github.com/openai/codex/issues/20851). 우회 없이 정직하게 문서화 |

✅ 항목은 전부 실측 검증(§6 참고). ⏸️ 항목은 우회 안 하고 업스트림 이슈와 함께 정직 명시.

---

## 2. 구조

```
tmux 세션 "sshee"
├── 윈도우: infra
│     codex app-server --listen ws://127.0.0.1:4222   (화면 없는 LLM 런타임)
│        ▲ │  WebSocket 위 JSON-RPC
│        │ ▼
│     bot.py  ── discord.py on_message ──► 디스코드
│        - thread/start  (sandbox=danger-full-access, approvalPolicy=never)
│        - thread/resume (.codex-thread-id → 같은 파라미터 재전송) ← 핵심
│        - 매 턴: <channel chat_id message_id …> + "→ 답장"
│        - codex가 mcp__discord__reply 호출 → discord 플러그인이 REST 전송
│
└── 윈도우: codex
      codex resume "$(cat .codex-thread-id)" --remote ws://127.0.0.1:4222
      → 운영자가 같은 대화 스레드를 보고 직접 개입 가능
```

Claude Code 봇도 모양이 같습니다. 다만 들어오는 이벤트 주입이 `claude` 자체에 내장 vs Codex는 작은 파이썬 bridge가 `turn/start`로 주입. 나가는 응답은 동일(둘 다 `mcp__discord__reply` 도구 호출).

### 프로토콜 핵심 사실 (codex app-server JSON-RPC v2)

- 핸드셰이크(handshake, 연결 절차): `initialize` → `initialized` → `thread/start`(또는 `thread/resume`) → `turn/start` → 알림 스트림.
- 서버가 클라이언트에 보내는 요청 = **반드시 응답**: `mcpServer/elicitation/request`(discord MCP 허용은 `{"action":"accept","_meta":{"persist":"session"}}`), `item/*/requestApproval`, `item/tool/call`, `item/tool/requestUserInput`. 무시하면 그 턴이 영원히 멈춤.
- `thread/resume`는 디스크의 rollout 기록(`~/.codex/sessions/…/rollout-*-<tid>.jsonl`)에서 불러옴. `sandbox`+`approvalPolicy`를 받음 — **재전송 안 하면 resume된 스레드가 조용히 `workspaceWrite`/`networkAccess:false`로 떨어짐** (이번 작업에서 가장 까다로웠던 버그, §6).

---

## 3. 세팅

### 3.1 사전 준비
- `codex` CLI, `tmux`, 파이썬3+`websockets`, Claude Code 디스코드 플러그인(codex MCP 서버로 재사용).
- 플랫폼: macOS / Linux / **WSL2(Ubuntu 22.04+)**. 네이티브 윈도우 → WSL 사용. `computer_use`는 macOS Apple Events 의존이라 WSL/Linux에선 업스트림과 무관하게 불가.

### 3.1a Node installer

ThisCodex는 셸 의존이 없는 Node 설치기를 동봉합니다. **기본값은 대화형
guided onboarding** 입니다 — 플래그 없이 실행하세요:

```bash
npx github:treylom/ThisCodex init
```

guided `init`은 repo root, workspace, BOT_WD, state dir, Codex config,
superpowers 가용성, runner 안내, 최종 doctor 검증을 한 번에 한 질문씩 안전한
기본값과 함께 물으며 진행하고, 확인 후에만 파일을 씁니다. 사람뿐 아니라
**레포를 건네받은 AI 에이전트의 경로이기도 합니다 — 에이전트는 guided
`init`을 실행하고 각 질문을 사용자에게 중계해야 하며, 비대화형 설치를
스스로 실행하거나 "복사 = 설치 완료"라고 보고해선 안 됩니다.**

`--apply`는 `thiscodex` 스킬을 Codex가 스캔하는 계층(기본
`~/.agents/skills/thiscodex`)으로 복사하고, 선택 시 `~/.codex/config.toml`을
백업 후 패치하며, OS별 runner 실행 안내를 출력합니다. scope A에서는 데몬을
자동 시작하지 않습니다. 설치는 매니페스트 기반(`install/thiscodex.install.json`)
이고 `thiscodex doctor`가 같은 verify 검증을 다시 실행합니다.

스킬 배치와 guided onboarding은 다른 경로입니다. `SKILL.md`를 Codex 스킬
계층에 복사하면 스킬을 보이게 할 뿐, **완료된 onboarding이 아닙니다.**
guided onboarding은 repo, workspace, BOT_WD, state dir, Codex config,
superpowers, runner 안내, 최종 doctor 검증까지 확인한 뒤에만 봇 준비
완료라고 말합니다.

#### CI · 자동화 (비대화형 명시 옵트아웃)

비대화형은 CI·진단 전용이며, 반드시 명시 플래그로 요청해야 합니다:

```bash
npx github:treylom/ThisCodex init --check --non-interactive
npx github:treylom/ThisCodex init --apply --yes --answers <answers.json>
```

비대화형(`--non-interactive`)은 CI·진단 모드이지 guided onboarding이
아닙니다. 누락된 경로를 발명하지 않습니다. 필수 결정이 없으면 조용히
계속하거나 스스로 답을 채우지 않고 — 입력이 가능하면 대화형 복구 힌트를,
불가능하면 명확한 Next command를 — 출력하고 멈춥니다.

Windows에서는 WSL을 먼저 쓰세요. tmux가 없으면 ThisCodex는 tmux 한 줄
안전선을 씁니다. tmux가 왜 필요한지 설명하고 설치 명령 한 줄만 제안합니다.
그 한 줄도 명시 동의가 있을 때만 실행합니다. alias는 `confirmed_repo_root`, `confirmed_bot_wd`,
`confirmed_state_dir`가 확정된 뒤에만 생성하므로 임시 경로가 shell에 박히지
않습니다.

WSL 안에서 실행 중이면 WSL -> Windows 스킬 동기화가 1급 단계입니다.
설치기는 `/mnt/c/Users/*`를 감지하고 사용할 Windows 프로필을 확인한 뒤,
`thiscodex` 스킬만 `%USERPROFILE%\.agents\skills\thiscodex`로 동기화합니다.
다른 Windows 스킬은 보존하고, 복사 뒤 `SKILL.md` 일치를 검증합니다.

`/using-superpowers` 인터뷰 전에 superpowers가 필요합니다. Codex superpowers
bundle이 없으면 설치기는 멈추고 superpowers 다음 명령을 출력합니다. guided
interview가 끝난 것처럼 진행하지 않습니다.

#### Installer ownership

Node installer가 Codex 스킬 배치의 단일 정본입니다. `skills/thiscodex`를
선택한 Codex-visible 계층(기본 `~/.agents/skills`, 선택 시 repo-local
`.agents/skills`)으로 복사합니다. ThisCodex는 별도 shell sync 스크립트를
두 번째 경로로 동봉하지 않습니다. 중복 sync 경로는 drift가 나고 Windows에서
실행하기 더 어렵습니다.

`scripts/launch.sh`는 이미 bridge를 직접 운영하는 사람을 위한 legacy/tmux
fallback입니다. 새 사용자는 Node runner guide를 따릅니다. `launch.sh`를
쓸 때는 `THISCODEX_SHELL=${SHELL:-/bin/sh}`(또는 명시 shell 경로)을 설정해
zsh가 없어도 실행되게 합니다.

사용자가 YOLO/full-access를 명시 선택하면, bridge의 per-turn
`sandbox:"danger-full-access"`와 `approvalPolicy:"never"`가 있어도
`~/.codex/config.toml`에 `sandbox_mode = "danger-full-access"` 및
`approval_policy = "never"`가 없으면 Codex app-server 기본값에 clamp될 수
있다고 경고합니다. installer는 Q6e YOLO opt-in 경로에서만 보안 경고와 백업
후 두 key를 추가할 수 있습니다. safe mode는 계속 zero-config 기본값입니다.

### 3.2 `~/.codex/config.toml`
```toml
project_doc_fallback_filenames = ["SOUL.md", "AGENTS.md"]
project_doc_max_bytes = 65536

[mcp_servers.discord]
command = "bun"
args = ["run", "--cwd", "<discord 플러그인 경로>", "start"]
[mcp_servers.discord.env]
DISCORD_STATE_DIR = "~/.claude/channels/discord-<봇이름>"
```

### 3.3 봇 작업 디렉토리
`SOUL.md`(페르소나)와 `AGENTS.md`(규칙 — 정적 디스코드 답장 규칙 포함, §4)를 봇 작업 폴더에 둠. 매 스레드 자동 로드되므로 **매 턴 페르소나 텍스트 재주입 금지**.

### 3.4 실행 (접근 권한을 주는 건 bridge)
2-윈도우 tmux 런처(`scripts/launch.sh`): `infra` 윈도우는 `LAUNCH_CMD`(codex app-server + bridge 데몬), `codex` 윈도우는 같은 app-server에 터미널 화면(TUI)을 붙여 실시간 관전·개입.

`launch.sh` 는 감독만 하고, **실제 sandbox 를 보내는 건 bridge 데몬**입니다. 참조 bridge 는 본 레포에 동봉: [`examples/bot.py`](examples/bot.py), 지켜야 할 규칙은 **[YOLO bridge 계약](docs/yolo-bridge-contract.md)**. 핵심:

- **기본 안전, YOLO opt-in, 봇별 선택**: 봇이 env `THISCODEX_YOLO=1` **또는** operator 통제 sentinel(`THISCODEX_YOLO_FILE`, 기본 `~/.claude/channels/discord-<BOT_NAME>/.thiscodex-yolo` — 봇별, **모델 writable dir 밖**이라 모델이 safe→YOLO self-upgrade 불가)로 opt-in 안 하면 `sandbox:"workspace-write"`+`approvalPolicy:"on-request"`. opt-in 한 봇만 `danger-full-access`+`never`. 호스트 무제한 접근은 봇별 의식적 선택이지 무설정 동작 ❌ — 계약의 보안 절 먼저 읽기.
- **`thread/start`·`thread/resume` 둘 다 동일 sandbox/approval 재전송** — resume 누락 시 첫 재시작 후 안전 기본값으로 silent fallback(§6). 계약에서 필수 조항.
- bridge 가 discord MCP 승인을 `persist:"session"` 자동 수락.
- 긴 턴 침묵 갭 방지 = bridge-level progress heartbeat(계약 heartbeat 절 + soul/AGENTS 능동보고 규율).

### 3.5 GitHub 인증 & superpowers
- GitHub: 실행 전 `gh auth login`(또는 환경변수 토큰) → codex `exec`가 push/PR 가능.
- Superpowers/스킬: codex는 `AGENTS.md`를 읽음. 스킬 디렉토리와 마이그레이션 규칙(§5)을 가리켜 두면 스킬 호출이 풀림.

---

## 4. 멀티 에이전트 규칙 (왜 봇 하나가 아닌가)

Claude Code + Codex 에이전트가 공존하게 하는 규칙. `bot-roster.yaml`(단일 기준 파일)에 있고 세션 시작 시 주입:

- **봇끼리 호출**: 공용 채널에서 다른 봇 대상 메시지는 **반드시** `<@user_id>` 멘션 또는 `reply_to`. 아니면 받는 봇이 조용히 버림(silent drop). 봇 `user_id`는 봇 토큰 첫 base64 조각에서 결정적으로 추출 — 추측 금지.
- **직통 채널은 멘션 규칙 면제**(`require_mention: false`).
- **회의 = 전용 스레드**: 봇 2개↑·10분↑·안건 있음 중 2개 충족 시 전용 스레드 신설, 본 채널엔 안내만. 단발 relay/ACK는 본문 유지.
- **세션 시작 주입**: 단일 렌더러(`roster-inject.py`)가 같은 좌표·규칙을 Claude Code 봇(세션 init 훅)과 Codex 봇(`~/.codex/hooks.json`) 양쪽에 주입.
- **디스코드 답장 규칙(정적, AGENTS.md — 매 턴 아님)**: 각 턴은 `<channel chat_id="…" message_id="…">`로 들어옴 → `mcp__discord__reply(chat_id, reply_to=message_id)`로 답장. 페르소나·볼트 규율은 `SOUL.md`/`AGENTS.md`가 자동 로드되므로 항상 적용.

---

## 5. Claude Code ↔ Codex 마이그레이션 규칙

| 항목 | Claude Code | Codex 대응 |
|---|---|---|
| 페르소나·규칙 로드 | `CLAUDE.md` + 세션 시작 훅 | `project_doc_fallback_filenames`로 `AGENTS.md`/`SOUL.md` |
| 들어오는 디스코드 이벤트 | `claude --channels` 내장 | `bot.py` bridge → `turn/start` |
| 나가는 응답 | `mcp__discord__reply` 도구 | 동일(discord 플러그인=codex MCP) |
| 도구 승인 | 권한 모드 | `approvalPolicy` + bridge 자동수락 |
| 스킬 | Skill 도구 | `AGENTS.md` 선언 스킬 디렉토리, 정식 지원 전엔 shell/`exec` 경유 |
| 지속성 | 세션 메모리 | rollout `thread/resume` + `.codex-thread-id` |
| 샌드박스 | 권한 프롬프트 | `sandbox` enum; **resume 시 재전송 필수** |

요령: **메시지마다 바뀌는 동적 정보는 bridge 프롬프트에, 정적인 것은 전부 `AGENTS.md`로**(자동 로드되므로 매 턴 재주입은 순수 노이즈).

---

## 6. 근거 (모든 ✅ 추적됨)

- Codex 봇 동등성 + 9 디버깅 사이클: vault 회의록 `2026-05-15-codex-discord-bot-poc`.
- 멀티 클라이언트 동일 스레드: 2번째 WS 클라이언트 붙여 bridge 실시간 히스토리 읽어 검증.
- `computer_use`/`browser_use`: `codex features list`엔 플래그 `stable,true`지만 **이를 노출하는 공식 명령/서브커맨드가 없어 호출 가능한 도구가 아님**. 삼각검증: features list(플래그 true) vs GitHub #20851(데스크톱 앱 번들 MCP 전용) vs 깨끗한 app-server×`dangerFullAccess` 턴 → 도구목록=`web.run, exec_command, image_gen…`(브라우저/컴퓨터 도구 없음). 6신호 수렴, confound 없음.
- resume-sandbox 버그: `sandbox` 재전송 안 한 `thread/resume` → 실효 `workspaceWrite`/`networkAccess:false`; 재전송으로 수정 → `{"type":"dangerFullAccess"}` 검증. **[YOLO bridge 계약](docs/yolo-bridge-contract.md)** 의 필수 조항으로 명문화 + [`examples/bot.py`](examples/bot.py) 구현.

---

## 7. 보안 주의 (#20851 도착 후 computer-use 켜기 전 필독)

업스트림이 `computer_use`를 CLI에 노출하면, 신뢰 불가한 디스코드 텍스트를 LLM의 "데이터로 취급" 지시로 흘려보내지 말 것 — 강제력 0. 필수: 코드레벨 기본거부, URL 허용목록(`file:`/`javascript:`/사설망/메타데이터 IP 차단), 일회용 브라우저 프로필, 민감 필드 `type`/`click` 차단, 허용·거부 전수 감사로그, 위임에 nonce/만료/HMAC. (출처: GPT-5.5 적대적 검토, 2026-05-16.)

---

## 8. 상태

- ✅ Codex 디스코드 봇·멀티클라이언트·roster/세션주입·안전/YOLO sandbox·image_gen/web.run/exec — 작동·검증.
- ✅ **참조 bridge 동봉** — [`examples/bot.py`](examples/bot.py) + 실행 가능 **[YOLO bridge 계약](docs/yolo-bridge-contract.md)**(안전기본 vs opt-in YOLO·resume sandbox 재전송·progress heartbeat). 배포 시 접근권한 부여 bridge 를 직접 짤 필요 없음.
- ⏸️ computer_use/browser_use — [openai/codex#20851](https://github.com/openai/codex/issues/20851) 대기.
- 🔁 스킬 이식성(Codex가 Claude Code 스킬 사용) + WSL/윈도우 codex 스킬 흡수 — 진행 중(협업). superpowers는 upstream 자체 codex 경로로 설치 → [docs/skill-portability.md](docs/skill-portability.md) §2.5.
- ✅ Progressive-disclosure **rules 시스템**(규칙을 다 넣지 않고 상황별 참조 — context bloat 방지) — 컨벤션 동봉, [docs/rules-system.md](docs/rules-system.md).
- ✅ **가역 메모리 정리(지우지 않고 옮김)** (`scripts/memory_dreaming.py`) — 안 쓰는 메모리를 작업공간 밖 보관소로 옮기고 명령 한 줄로 체크섬 검증 복원. 9칸 전부 같은 기준표 **Codex 메모리 칸 포함**(`~/.codex/memories`, cold subdir env 설정), 보수적(자동이동 게이트·애매하면 사람검토)·기준 자기보정·주1회 강제. 쉬운 설명: [docs/memory-dreaming.md](docs/memory-dreaming.md).
- ✅ **회의 watchdog** (`scripts/meeting_watchdog.py`) — 회의 스레드 신설 시 YAML 강제 ~5분 진행 점검, 목표+전체 작업 완료 시에만 자동 종료(Claude `/goal` 응용), fail-closed = 살아있는 회의 절대 잘못 종료 안 함.
- ⚙️ **설정 가이드**(AGENTS.md · soul.md · rules · Skills 2.0 체크리스트) — [docs/SETUP-CONFIG-GUIDE.md](docs/SETUP-CONFIG-GUIDE.md).

라이선스: 레포 참조. 본인이 통제하는 머신 + 신뢰 가능한 비공개 디스코드 서버에서만 사용.
