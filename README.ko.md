# ThisCodex (한국어)

> **Claude Code + Codex CLI 멀티 에이전트 봇**을 **디스코드**로 운영하고, **옵시디언 볼트(Obsidian vault, 노트 저장소)**의 폴더·메모리 규칙과 연결하는 재현 가능한 세팅 모음.
>
> 🇺🇸 [English README](./README.md) · 함께 쓰는 런타임: [claude-discode](https://github.com/treylom/claude-discode) (Claude Code 쪽) · 본 레포 = **Codex 쪽** + 두 런타임 공통 규칙.

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
| YOLO(전체 권한) 실행 | ✅ 작동 | `thread/start`**와** `thread/resume` 둘 다 `sandbox:"danger-full-access"`·`approvalPolicy:"never"` 전송 |
| 이미지 생성 | ✅ 작동 | codex 내장 `image_gen.imagegen` 도구 |
| 웹 조회·검색 | ✅ 작동 | codex 내장 `web.run` 도구 |
| `computer_use`/`browser_use`(데스크톱·브라우저 제어) | ⏸️ **보류** | 기능 플래그는 `stable,true`지만 **CLI/app-server 경로에 도구로 노출 안 됨** — 업스트림 추적: [openai/codex#20851](https://github.com/openai/codex/issues/20851). 우회 없이 정직하게 문서화 |

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

### 3.4 실행 (설계상 yolo)
2-윈도우 tmux 런처(`sshee` 별칭): `infra` 윈도우는 `launch.sh`(app-server + `bot.py`), `codex` 윈도우는 같은 app-server에 터미널 화면(TUI)을 붙여 실시간 관전·개입. `launch.sh` 자체가 yolo 경계: `approvalPolicy:"never"` + `sandbox:"danger-full-access"` + bridge가 discord MCP 승인 요청을 `persist:"session"`으로 자동 수락.

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
- `computer_use`/`browser_use` CLI 미노출: `codex features list`(플래그 true) vs GitHub #20851(데스크톱 앱 전용) vs 깨끗한 app-server×`dangerFullAccess` 턴 → 도구목록=`web.run, exec_command, image_gen…`(브라우저/컴퓨터 도구 없음). 6신호 수렴, confound 없음.
- resume-sandbox 버그: `sandbox` 재전송 안 한 `thread/resume` → 실효 `workspaceWrite`/`networkAccess:false`; `danger-full-access` 재전송으로 수정 → `{"type":"dangerFullAccess"}` 검증.

---

## 7. 보안 주의 (#20851 도착 후 computer-use 켜기 전 필독)

업스트림이 `computer_use`를 CLI에 노출하면, 신뢰 불가한 디스코드 텍스트를 LLM의 "데이터로 취급" 지시로 흘려보내지 말 것 — 강제력 0. 필수: 코드레벨 기본거부, URL 허용목록(`file:`/`javascript:`/사설망/메타데이터 IP 차단), 일회용 브라우저 프로필, 민감 필드 `type`/`click` 차단, 허용·거부 전수 감사로그, 위임에 nonce/만료/HMAC. (출처: GPT-5.5 적대적 검토, 2026-05-16.)

---

## 8. 상태

- ✅ Codex 디스코드 봇·멀티클라이언트·roster/세션주입·yolo·image_gen/web.run/exec — 작동·검증.
- ⏸️ computer_use/browser_use — [openai/codex#20851](https://github.com/openai/codex/issues/20851) 대기.
- 🔁 스킬 이식성(Codex가 Claude Code 스킬 사용) + WSL/윈도우 codex 스킬 흡수 — 진행 중(협업).

라이선스: 레포 참조. 본인이 통제하는 머신 + 신뢰 가능한 비공개 디스코드 서버에서만 사용.
