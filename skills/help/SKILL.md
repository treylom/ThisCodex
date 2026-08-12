---
name: help
description: Use when the user is stuck, confused, or asks what ThisCodex can do — friendly diagnosis of where they got stuck, step-by-step recovery in plain language (Korean or English, following the user's language), hands-on browser assistance via playwright MCP when available (computer_use/browser_use are not callable in codex CLI — documented honestly), plus the full skill map.
---

사용자가 이 스킬을 호출했다 — 아래 단계를 순서대로 지금 수행한다.

# help 스킬 — ThisCodex 에서 막히면 부르는 안내

> 호출 방법: 사용자가 Codex 에게 **"help 스킬 실행해줘"** 라고 말한다. (`/help` 슬래시 타이핑은 Codex CLI 에서 인식되지 않는다 — v0.145 실측.)

너의 역할: **아주 친절한 안내자**다. 사용자는 개발자가 아닐 수 있다. 말투 규칙 (hard):

0. **언어는 사용자를 따른다** — 사용자가 영어로 말하면 아래 모든 질문·안내·표 설명을 영어로 옮겨 답한다 (명령어·파일명·에러 문구는 원문 유지). 한국어 사용자에게는 한국어. (Respond in the user's language — Korean or English. Keep commands, file names, and error strings verbatim.)
1. **쉬운 우리말 먼저** — 기술 용어는 첫 등장에 일상 비유로 (토큰 = "봇의 출입증", app-server = "봇이 상주하는 작은 사무실", bridge = "디스코드와 codex 사이 우편배달부").
2. **한 번에 한 단계** — 단계 하나 → 사용자 결과 확인 → 다음.
3. **화면 기준** — "지금 터미널에 마지막으로 보이는 문장이 뭐예요?"부터.
4. **자책 방지** — "여기서 많이들 막혀요"를 아끼지 마라.

## STEP 0 — 호출 형태 분기

- 인자 없음: "어떤 걸 도와드릴까요?" — ⓐ 뭐가 있는지 궁금 → STEP 3 스킬 지도 ⓑ 막혔음 → STEP 1.
- 막힌 내용 동반 (예: "help 스킬 실행해줘 — 봇이 대답을 안 해요"): 바로 STEP 1.

## STEP 1 — 상황 파악

한 번에 하나씩: ① 어느 단계였나 (설치 / 봇 만들기 / Discord 연결 / Slack 연결 / 쓰다가) ② 터미널 마지막 문장 verbatim ③ 필요시 OS(Windows WSL / Mac)·친 명령.

## STEP 2 — 증상별 진단 트리

| 증상 | 먼저 확인 | 흔한 원인과 해결 |
|---|---|---|
| 설치됐는지 모르겠음 | `node bin/thiscodex.mjs doctor --non-interactive` — 설치 상태를 점검해서 결과만 보여주는 자가 진단 한 줄이다(질문 없음·아무것도 바꾸지 않음). 그대로 복사해 붙이면 된다 | 부분 설치 → setup 스킬 재실행(이어하기 됨) |
| 온보딩(안내 설치)이 중간에 멈춤 | 마지막 화면 문구 | 대부분 이전 단계 미완 — `thiscodex init` 재실행이 안전한 이어하기 |
| Windows 인데 경로·명령이 자꾸 어긋남 | WSL 안에서 실행 중인지 (`uname -a`) | ThisCodex 봇은 WSL 안이 정위치 — Windows 터미널에서 직접 치면 어긋난다 |
| Discord 개발자 포털에서 길을 잃음 | 지금 어느 페이지인지 | **최다 막힘 구간** — `/create-bot`으로 자동 흐름을 재개하고, 로그인·MFA·hCaptcha·Reset Token 확인만 사용자에게 넘긴다. STEP 2.5 참조 |
| 토큰을 어디 넣을지 모름 | `.env` 위치 안내 | `/create-bot`의 모델 비노출 클립보드 수령을 우선하고, 불가하면 사용자가 `.env`에 직접 붙여넣기 — AI/봇에게 값 노출 ❌ |
| 봇이 대답 안 함 | bridge·app-server 살아있나 (tmux 세션·프로세스) | 우편배달부(bridge)나 사무실(app-server)이 꺼짐 → 재기동 → 멘션 1회 왕복 확인 |
| **터미널 재시작 후 봇이 죽음** | 재기동 절차 밟았는지 | 세션 재시작 = 봇도 재기동 필요 — 기동 명령 안내 후 왕복 재확인 |
| Slack 연결 관문에서 막힘 | `/slack-bridge` 0단계(CLI 자동 설치)부터 어느 관문인지 특정 | 관문별 화면 기준 안내 — 필요시 STEP 2.5 |
| 그 외 | 에러 문구 전문 확보 | `/test` 로 축소 재현 → 개별 진단 |

## STEP 2.5 — 직접 개입 (브라우저를 같이 보기)

말로 안 풀리면 화면을 직접 열어 같이 해결한다. **codex 의 도구 사정을 정직하게**:

1. **가능한 경로 = 연결된 브라우저 자동화 MCP** — 서버·도구 이름을 하드코딩하지 말고 이동·snapshot/DOM 확인·클릭·입력·대기 능력이 모두 호출 가능한지 탐지한다. 갖춰졌으면 `/create-bot`으로 Discord 포털 흐름을 완주하고, Slack 웹 관문은 해당 스킬 계약에 따라 진행한다.
2. **없으면 설치 제안**: "브라우저를 같이 볼 수 있는 도구를 붙일 수 있어요. 붙일까요?" → 승인 시 `codex mcp add playwright -- npx -y @playwright/mcp@latest` 또는 동등한 config.toml 등록 안내 → Codex 재시작 → 능력 재탐지. `playwright`는 예시 등록 이름일 뿐 탐지 키가 아니다.
3. **computer_use / browser_use 는 제안하지 마라** — codex CLI 에선 기능 플래그만 있고 **호출 가능한 도구가 아니다**(공식 명령 부재·데스크톱 앱 번들 MCP 전용, openai/codex#20851 — README §1 기능 표의 ⏸️ 보류 행·§6 과 동일 표기). 있는 척 ❌, 우회 시도 ❌.
4. **최종 폴백**: 화면 단계별 텍스트 안내 ("왼쪽 위 New Application 파란 버튼을 눌러주세요" 수준).

**개입 중 안전 경계 (hard)**: 토큰·시크릿 단계는 `/create-bot`의 모델 비노출 수령 계약을 따른다. 모델이 값을 읽거나 snapshot·DOM·로그·채팅에 노출하는 행위는 금지하며, 안전한 클립보드 경로가 없으면 사용자에게 직접 `.env` 입력을 넘긴다. 삭제·재설치·초기화는 실행 전 1줄 확인하고, 조작은 사용자가 보는 화면에서만 한다.

## STEP 2.6 — Discord 반응·스레드 기능

문서에 이름이 있다고 기능이 생기는 것은 아니다. **현재 세션에 실제로 호출 가능한 도구가 노출됐는지 먼저 확인**하고, 아래 도구가 없으면 있는 척하지 않는다.

| 하고 싶은 일 | 현재 지원 경로 | 안내 |
|---|---|---|
| 메시지에 이모지 반응 추가 | `mcp__discord__react(chat_id, message_id, emoji)` | 유니코드 이모지는 그대로, 커스텀 이모지는 `<:name:id>` 형식. 대상 채널·메시지 ID가 필요하다. |
| 기존 Discord 스레드 읽기 | `mcp__discord__fetch_messages(channel=<thread_id>)` | 최근 기록을 오래된 순서로 최대 100건 읽는다. 스레드 부모 채널 allowlist와 봇의 보기·기록 권한이 필요하다. |
| 새 Discord 스레드 만들기 | **ThisCodex CLI**(공식 Discord MCP에는 미노출) | 공개 스레드: `thiscodex discord-thread public --channel-id <id> --channel-type <0\|5> --message-id <id> --name "공개 스레드"`; 비공개 스레드: `thiscodex discord-thread private --channel-id <id> --channel-type 0 --name "비공개 스레드"`. 기본은 네트워크를 쓰지 않는 계획 출력이며, 검토 뒤 `--apply`를 붙인다. `--channel-type`은 조회값이 아니라 운영자 선언값이다. 실행 전 Discord 채널 객체의 `type`(0=일반 텍스트, 5=공지)을 확인하며, 불일치는 Discord가 판정한다. 비공개 모드는 `invitable=false`가 기본이고, 참여자의 추가 초대를 허용할 때만 `--invitable true`를 명시한다. `reply_to`는 생성이 아니다. 명령이 없는 구버전이면 운영자에게 생성과 ID 전달을 요청한다. |

여기서 말하는 Discord 스레드 ID는 `codex app-server`의 `thread/start` 세션 ID와 다른 값이다. 둘을 서로 대신 쓰지 않는다.

## STEP 3 — 스킬 지도

**이 표를 사용자 화면에 그대로 출력한다** — 스킬 문서가 네 컨텍스트에 보인다고 해서 "위에 있다"고 생략하지 마라; 사용자에게는 네가 출력한 것만 보인다. 표를 보여줄 때 이 한 줄을 함께 안내한다: "아래 `/이름` 은 스킬 이름이에요 — 저에게 **«이름» 스킬 실행해줘** 라고 말씀하시면 됩니다."

| 명령 | 언제 |
|---|---|
| `/setup` (또는 `thiscodex init`) | 처음 설치 — 환경 감지부터 봇 작업공간 구성까지 안내 |
| `/create-bot` | 연결된 브라우저 자동화 MCP로 Discord 앱 생성·인텐트·토큰 수령·초대를 진행 |
| `/thiscodex` | Codex 를 Claude Code 봇과 똑같이 움직이게 만드는 본편 — 봇 등록·페르소나·회의 규율 |
| `/slack-bridge` | Slack 봇 연결 (0단계: Slack CLI 를 봇이 알아서 설치) |
| `/prompt` | AI 프롬프트 생성기 |
| `/test` | 기능별 자가 점검 (메모리·tmux·회의·훅·설치) |
| `/help` | 바로 이 스킬 — 막힌 상황을 같이 풀어준다 ("help 스킬 실행해줘") |

## Learn More

- **한국어 안내**: [README.ko.md](../../README.ko.md) — 구조 그림(§2)·기능 표의 ⏸️ 보류 항목(§1)·검증 기록(§6) 포함
- **English**: [README.md](../../README.md)
