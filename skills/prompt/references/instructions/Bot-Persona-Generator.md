# Bot-Persona-Generator — canonical AGENTS.md + SOUL v2 생성 프레임워크

> `/prompt bot-persona: <역할> <범위> <Discord 연동>` 로 호출되거나,
> SETUP-CONFIG-GUIDE §0 가이드 온보딩이 봇 메타 파일을 만들 때 이 레퍼런스를 따른다.
> 산출물은 Codex 봇의 **하나의 상시 프롬프트**다 — ad-hoc 작성 금지, 본
> 프레임워크로 생성.

## 산출물 (Codex 봇 1개당 정본 1파일)

| 파일 | 역할 | 위치 |
|---|---|---|
| `AGENTS.md` | Codex 봇 WD 정본 — frontmatter, SOUL v2 capsule, 역할·경계, `rules/INDEX.md` 포인터 | 봇 WD 루트 |
| `SOUL.md` | **legacy fallback 또는 외부 bridge-capsule source만**. AGENTS.md가 있는 같은 WD에 생성·배치 금지 | manual migration 전 legacy BOT_WD, 그 밖에는 bridge state dir 등 Codex WD 밖 |

## 생성 절차

1. **입력 수집 (부족하면 한 번에 하나씩 질문)**
   - **USER-PROFILE 선독**: `~/.claude/USER-PROFILE.md` 가 있으면 먼저 Read —
     roles/pain_points 에서 역할·템플릿을 *유도해 제안*하고, AGENTS.md SOUL v2
     capsule 말미에
     `## 사용자 컨텍스트` 절(응답 톤 보정용 요약 — 보조층)을 삽입한다.
     없으면 온보딩 인터뷰(SETUP-CONFIG-GUIDE §0 step 3 앵커 6종)로 먼저 생성.
     **프로필의 본 정착지는 구조다**: `north_star` → AGENTS.md/meta 최상단 목표
     1줄 · `roles`+`automation_wishes` → `## 사용자 업무 컨텍스트` 절 ·
     `workflows` → WD 폴더 스캐폴드 제안(답변의 실제 단계·산출물 이름, 범용
     템플릿 ❌) · `pain_points` → `rules/` topical stub 채움(페인포인트 1개 =
     INDEX 트리거 행 1 + rule stub 1) + 반복 실수형이면 hook 후보 1줄 제안
     (강제 설치 ❌).
   - 역할/도메인: 이 봇이 *소유*하는 일 vs *위임*하는 일
   - 페르소나: 이름·말투·시그니처 라인 (예: 보고 끝 `— <Bot Name>`)
   - 모델 id: 사용자의 하네스가 실제 노출하는 id 만 (지어내기 금지)
   - Discord: 채널/스레드 범위, 봇 user_id, 회의 스레드 규칙 적용 여부
   - vault 범위: 검색/쓰기 허용 경로, Obsidian 유무
2. **canonical AGENTS.md 생성** — 가장 가까운 `templates/soul-*.md`
   (research-bot / writing-bot / schedule-bot / general-assistant / custom)를
   capsule 초안으로만 사용하고, 결과를 하나의 AGENTS.md에 넣는다:
   - 파일 byte 0에서 frontmatter 시작: `---`, `name` / `description` /
     `version: 2.0.0` / `triggers`, 닫는 `---`, 그 다음 H1
   - `<!-- SOUL-CAPSULE-START -->` / `<!-- SOUL-CAPSULE-END -->` 사이에
     정체성·말투·시그니처, 전문영역+확정 도구 체인, 고유 게이트·경계,
     `rules/orchestration.md` §11 R1–R5 포인터를 둔다
   - 비개발자 사용자가 주인이면 "쉬운 말 우선" 규율 명시
   - 개인 식별 정보(타인 실명·채널 id)는 placeholder 로
   - 운영 규칙 본문은 인라인 금지 → `rules/INDEX.md` 포인터만
   - 같은 WD에 `SOUL.md`를 함께 만들지 않는다. legacy fallback은
     AGENTS.md가 없을 때만, bridge capsule은 Codex WD 밖의 외부 source일 때만
   - `SOUL.md`만 있는 WD는 existing install: `thiscodex migrate-identity
     --preview`로 먼저 확인하고, `--apply`는 `AGENTS.md.v2`와 receipt를
     stage하며 legacy SOUL.md를 active로 보존한다. backup은
     `SOUL.md.thiscodex.pre-v2.bak`; cutover는 수동이고 rollback은 unchanged
     candidate+receipt만 제거한다
3. **검증 후 완료 선언**
   - AGENTS.md frontmatter가 byte 0에서 파싱되고, capsule marker 2개와
     시그니처 라인이 존재
   - meta 파일이 rules 본문을 인라인하지 않고 INDEX 만 가리킴
   - `<@본인 봇 ID>` 같은 placeholder 가 실값으로 치환됐는지 (Discord
     Developer Portal → Bot → Copy User ID 가 그 값)

## 안티패턴

- 규칙 전체를 CLAUDE.md 에 욱여넣기 (context bloat → recall 저하)
- 다른 사람·다른 봇의 고유명사/채널 id 를 템플릿에서 그대로 복사
- 존재하지 않는 모델 id·스킬 이름 발명
- AGENTS.md와 같은 WD의 SOUL.md에 같은 내용을 중복 (Codex discovery·drift
  원인)
