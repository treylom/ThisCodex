---
name: slack-bridge
description: Use when creating a Slack bot that bridges to local AI engines (Claude Code / Codex CLI). Covers Slack CLI authentication (near-full automation), app creation, engine-prefix routing, per-bot persona loading via CLAUDE.md/AGENTS.md, thread-scoped conversation continuity (claude --resume / codex exec resume), and round-trip verification. Also covers the Discord semi-auto path.
---

# Slack Agent Bridge — Slack 봇 ↔ 로컬 엔진(claude/codex) 연결

Slack 워크스페이스에 봇을 만들고, 메시지를 로컬 AI 엔진(Claude Code `claude -p` / Codex CLI `codex exec`)으로 라우팅해 스레드로 답하게 하는 전 공정. 2026-08-05 macOS 에서 전 단계 실측 검증됨(왕복·페르소나 로딩 포함). Windows 는 설치 명령만 다르고 공정은 동일하다 — Windows 실측은 아직 없으므로 어긋나는 단계가 나오면 그 단계를 기록하고 멈춘다.

## 전제

- Slack CLI v4.6+ — macOS: `curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash` / Windows: https://tools.slack.dev/slack-cli 의 Windows 설치 안내(공식) 사용
- 로컬에 `claude`(Claude Code) 또는 `codex`(Codex CLI) 중 최소 1개 설치·로그인 상태
- Slack 워크스페이스에 로그인된 브라우저 (자동화 시: 브라우저 조작 도구)

## 1단계 — Slack CLI 인증 (사람 관문 1곳, 브라우저 자동화로 0곳 가능)

```bash
slack login --no-prompt
# 출력: /slackauthticket <티켓문자열>
```

1. 위 `/slackauthticket …` 한 줄을 **Slack 아무 채널·DM 에 붙여넣고 전송** → 권한 모달에서 **Confirm** → 챌린지 코드 표시됨.
   - 자동화: 브라우저 도구로 Slack 웹 열기 → 메시지 입력창에 명령 입력·전송 → Confirm 클릭 → 코드 읽기.
   - Claude Code 환경 = claude-in-chrome 으로 완전 자동 실측 성공(2026-08-05). **Codex 앱 환경 = browser-use 도구로 같은 3동작(입력→Confirm→코드 회수)을 수행** — Codex 에서 이 스킬을 쓸 때는 수동 안내 대신 browser-use 자동화를 기본 경로로 시도하고, 도구가 없으면 사람 관문 1곳으로 안내한다.
2. 코드로 인증 완료:

```bash
slack login --no-prompt --ticket <티켓> --challenge <코드>
slack auth list   # 워크스페이스·User ID 나오면 성공 (~/.slack/credentials.json)
```

## 2단계 — 앱 생성

```bash
slack create my-agent-bridge   # 템플릿 선택: Bolt Python starter
cd my-agent-bridge && pip install -r requirements.txt
```

## 3단계 — 엔진 브리지 리스너

`listeners/messages/agent_bridge.py` 생성(핵심부 — 전체 규칙: 메시지가 `codex:` 로 시작하면 codex, 그 외 claude. 답은 항상 스레드로):

```python
import os, subprocess
from slack_bolt import BoltContext, Say

ENGINE_TIMEOUT_SEC = int(os.environ.get("AGENT_BRIDGE_TIMEOUT", "180"))
CLAUDE_CMD = [os.path.expanduser("~/.local/bin/claude"), "-p", "--strict-mcp-config"]
CODEX_CMD = [os.path.expanduser("~/.nvm/versions/node/v24.14.1/bin/codex"), "exec", "--skip-git-repo-check"]
# ⚠️ 경로는 절대경로로 — `which` 는 세션 셸의 가짜 경로(shim)를 줄 수 있어 slack run 프로세스와 어긋난다 (실측 함정)

BOT_HOME = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "bot-home"))
CODEX_HOME = os.path.join(BOT_HOME, ".codex")

def _run_engine(cmd, prompt, engine="claude"):
    env = dict(os.environ)
    if engine == "codex":
        env["CODEX_HOME"] = CODEX_HOME  # 4단계 참조
    p = subprocess.run([*cmd, prompt], capture_output=True, text=True,
                       timeout=ENGINE_TIMEOUT_SEC, cwd=BOT_HOME, env=env)
    return (p.stdout or "").strip() or (p.stderr or "").strip() or f"(빈 출력 — exit {p.returncode})"

def agent_bridge_callback(context: BoltContext, say: Say, logger, message: dict):
    text = (message.get("text") or "").strip()
    if not text:
        return
    try:
        if text.lower().startswith("codex:"):
            engine, reply = "codex", _run_engine(CODEX_CMD, text[6:].strip(), "codex")
        else:
            engine, reply = "claude", _run_engine(CLAUDE_CMD, text, "claude")
        say(text=f"[{engine}] {reply[:3800]}", thread_ts=message.get("thread_ts") or message.get("ts"))
    except subprocess.TimeoutExpired:
        say(text=f"⏱️ 엔진 {ENGINE_TIMEOUT_SEC}초 초과", thread_ts=message.get("thread_ts") or message.get("ts"))
```

`listeners/messages/__init__.py` 에 등록:

```python
app.message(re.compile(".*", re.DOTALL))(agent_bridge_callback)
```

> 위는 메시지마다 엔진을 새로 단발 호출하는 버전이다. 스레드 안에서 이어 물었을 때 이전 대화를 기억하게 하려면 **6단계 — 스레드 연속 대화** 참고.

## 4단계 — 봇 페르소나·규칙 (soul 입히기)

`bot-home/` 폴더를 만들고 **CLAUDE.md**(claude 엔진용)와 **AGENTS.md**(codex 엔진용)에 같은 규칙을 쓴다 — 각 엔진이 자기 정식 설정 파일로 규칙을 문다:

```markdown
너는 **토푸(Tofu)** — 이 워크스페이스의 Slack 비서 봇이다.
1. 항상 한국어로, 세 문장 이내로 답한다.
2. 모든 답 끝에 서명 `— 토푸 🫘` 를 붙인다.
3. 모르면 모른다고 말한다. 위험한 요청(삭제·결제)은 거절한다.
```

**⚠️ codex 전역 설정 충돌 (같은 머신에 다른 codex 봇이 살 때)**: codex 는 `~/.codex/AGENTS.md`(전역)도 읽는다. 전역에 다른 페르소나가 있으면 로컬 파일과 경합해 **다른 봇 이름으로 답할 수 있다** (실측: 2회 재현). 해법 = 전용 `CODEX_HOME` 격리:

```bash
mkdir -p bot-home/.codex
ln -s ~/.codex/auth.json bot-home/.codex/auth.json   # 인증만 승계
cp bot-home/AGENTS.md bot-home/.codex/AGENTS.md       # 규칙은 봇 것만
```

깨끗한 머신(수강생 환경)에서는 전역 AGENTS.md 가 비어 있어 이 단계가 없어도 로컬이 그대로 이긴다.

## 5단계 — 기동·초대·왕복 검증

```bash
slack run   # 앱 선택 → 팀 선택 → "Bolt app is running!" (Socket Mode·매니페스트 자동 설치)
```

1. Slack 에서 채널에 봇 초대: `/invite @<봇이름>` (⚠️ Bolt 기본 manifest 는 DM 탭 비활성 + `message.channels` 구독 = **채널 멤버여야 반응**)
2. **왕복 검증(합격선)**: 채널에 질문 → `[claude] …` 스레드 답 확인 → `codex: 질문` → `[codex] …` 확인
3. **페르소나 검증은 파일 존재가 아니라 행동으로**: "너는 누구야?" → 봇 이름 + 규칙의 서명(`— 토푸 🫘`)이 답에 실리는지 확인. 서명 = 규칙 로딩의 지문이다.

## 6단계 — 스레드 연속 대화 (구현·실측 완료)

Slack 스레드 `thread_ts`(또는 최상위 메시지면 `ts`) 를 엔진 세션 id 에 매핑해 **스레드 단위로 대화가 이어지게** 한다. 매핑은 `bot-home/.sessions.json` 에 스레드별 `{"claude": "<uuid>", "codex": "<session_id>"}` 로 원자 갱신 저장(`.tmp` 파일 후 `os.replace`).

- **claude**: 스레드 첫 메시지 = `--session-id <신규 uuid>` 로 세션 id 를 직접 지정해 생성. 이후 같은 스레드는 저장해둔 id 로 `--resume <id>` 재개.
- **codex**: 저장된 세션이 있으면 `codex exec resume <SESSION_ID>` 로 재개. 없으면 평소대로 `codex exec` 실행 후, codex 가 세션 id 를 표준출력으로 안 주므로 **`CODEX_HOME/sessions/**/*.jsonl` 중 가장 최근 mtime 파일명에서 역산**해 저장한다 — 동시 요청이 겹치면 다른 스레드의 파일을 최신으로 잘못 집을 수 있어 신규 세션 생성 구간을 락으로 직렬화한다(아래 `_CODEX_LOCK`).

```python
SESSIONS_FILE = os.path.join(BOT_HOME, ".sessions.json")
_MAP_LOCK = threading.Lock()    # 맵 파일 원자 갱신
_CODEX_LOCK = threading.Lock()  # codex 신규 세션 = 실행 후 최신 rollout 파일로 id 귀속 → 직렬화 필요

def _newest_codex_session() -> str | None:
    files = glob(os.path.join(CODEX_HOME, "sessions", "**", "*.jsonl"), recursive=True)
    if not files:
        return None
    m = re.search(r"([0-9a-f-]{36})\.jsonl$", max(files, key=os.path.getmtime))
    return m.group(1) if m else None

# codex 분기
sid = _session_map().get(thread_key, {}).get("codex")
if sid:
    reply = _run_engine([*CODEX_CMD, "resume", sid], prompt, engine="codex")
else:
    with _CODEX_LOCK:                      # 동시 실행 시 mtime 오귀속 방지
        reply = _run_engine(CODEX_CMD, prompt, engine="codex")
        new_sid = _newest_codex_session()
    if new_sid:
        _remember(thread_key, "codex", new_sid)

# claude 분기
sid = _session_map().get(thread_key, {}).get("claude")
if sid:
    reply = _run_engine([*CLAUDE_CMD, "--resume", sid], text, engine="claude")
else:
    sid = str(uuid.uuid4())
    reply = _run_engine([*CLAUDE_CMD, "--session-id", sid], text, engine="claude")
    _remember(thread_key, "claude", sid)
```

**라이브 검증(2026-08-05)**: 한 스레드에서 "내 별명은 두부야" 전송 후 되묻기("내 별명이 뭐라고 했지?") → `[claude] 두부님이에요! — 토푸 🫘`. 같은 스레드에 `codex: 내 별명이 뭐라고 했지?` → `[codex] 두부라고 했어! — 토푸 🫘`. 두 엔진 모두 세션 기억 복원 + 페르소나 서명 유지를 확인했다.

진짜 라이브 TUI 상주 세션(우리 Discord 봇 방식)에 붙이려면 브리지 데몬 구조가 별도로 필요하다 — 이건 여전히 참이다.

## Discord 쪽 (반자동 — API 로 앱 생성 불가)

Discord 는 앱 생성·봇 토큰 발급 API 가 없다(2026-08-04 실측 확정). 자동화 가능한 것은 초대(OAuth2 URL)뿐:

1. https://discord.com/developers/applications → New Application → Bot 탭 → 토큰 발급 (수동, ~2분)
2. 이후 봇 구동·페르소나·상태 관리 = `/thiscodex init` 온보딩이 담당 (skills/thiscodex/SKILL.md)

## 함정 목록 (전부 실측)

| 함정 | 증상 | 처방 |
|---|---|---|
| 엔진 경로를 `which` 로 잡음 | slack run 프로세스에서 엔진 못 찾음 | 절대경로 고정 |
| DM 으로 테스트 | 봇 무반응 (메시지 탭 비활성) | 채널 초대 후 채널에서 |
| codex 전역 AGENTS.md 경합 | 다른 봇 이름으로 답함 | CODEX_HOME 격리 |
| 티켓 유효시간 | 재부팅·지연 후 인증 실패 | 티켓은 쓰기 직전 발급 |
| cwd 를 홈으로 둠 | 페르소나·규칙 미주입("나는 그냥 Claude") | cwd = bot-home |
| codex 신규 세션 id 를 최신 rollout 파일 mtime 으로 역산 | 동시 실행 시 다른 스레드 세션 id 로 오귀속 위험 | 신규 세션 생성 구간을 락(`_CODEX_LOCK`)으로 직렬화 |
