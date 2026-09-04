#!/bin/bash
# automation-no-interactive.sh — PreToolUse hook (A3, matcher: AskUserQuestion|request_user_input):
#   무인 자동화(반복운영루프) 세션에서 대화형 질문 도구 호출 시 deny.
#   대화형 질문은 응답자가 없어 루프가 정지(死)한다. 근거: AK-Tofu phase-b "사용자 질문/권한요청
#   절대 금지" + autonomy §1. 04-synthesis A3. 대화형(비-자동화) 세션은 통과.
# 현재 deny 계약 = JSON permissionDecision(hookkit hk_deny). fail-open.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hookkit.sh"
hk_failopen
hk_read_input
TOOL="$(hk_json '.tool_name')"
case "$TOOL" in
  AskUserQuestion|request_user_input) ;;
  *) hk_allow ;;
esac
hk_is_automation || hk_allow                   # 대화형(비-자동화) 세션 → 통과
hk_log "A3 no-interactive: 자동화 중 ${TOOL} → deny"
hk_deny "무인 자동화(반복운영루프) 세션에서는 대화형 질문 도구(${TOOL})를 사용할 수 없습니다 — 응답자가 없어 루프가 정지합니다. 합리적 기본값으로 진행하거나 해당 단계를 skip 하세요. (대화형 세션에서는 정상 허용됩니다.)"
