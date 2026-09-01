#!/usr/bin/env python3
"""dispatch-room-gate.py — Gate A: top-level 채널 봇 발주 차단 (ThisCodex port).

Spec: obsidian-ai-vault meetings/2026-08-12-dispatch-meeting-gate/
      70-karpathy-track2-porting-spec.md v3.0 §1 D1·D2·D5 + P2(trust 게이트).
원본: ThisCode hooks/dispatch-room-gate.py (P1, e9a7ef3e) — 제품 델타 =
wiring 이 ~/.codex/hooks.json + Codex trust 확인(probe ⑥칸). 판정 로직은
접미사 매칭이라 MCP 도구명 차이(mcp__discord__* vs mcp__plugin_discord_*)에
무관 — decide() 무변경 이식.

Wiring (~/.codex/hooks.json): PreToolUse matcher
  "mcp__discord__reply|mcp__discord__edit_message"
Trust (Codex 전용): 배선된 훅은 /hooks 승인이 ~/.codex/config.toml 에
  trusted_hash 를 쓰기 전까지 «무징후 비활성»이다. trust 상태 키는
  snake_case(`…hooks.json:pre_tool_use:<entry>:<hook>`) — hooks.json 의
  이벤트 키는 CamelCase(PreToolUse). 같은 이벤트의 다른 표기 체계이므로
  옮겨 적을 때 통일하지 말 것. 훅 배열을 추가·삭제·재정렬하면 인덱스가
  밀리므로 /hooks 재승인을 확인할 것(잘못된 훅으로 승인이 옮겨붙는 쪽은
  해시 대조가 막고, 실패 양태는 재승인 필요 = 무징후 비활성 쪽 —
  [실측 미확인] 구조 추론).
Config: <state>/dispatch-gate.json
  {"top_channels": ["<channel_id>", ...], "roster_path": "/abs/bot-roster.yaml",
   "workspace_roots": ["/abs/workspace", ...]}
  state = $MEETING_WATCHDOG_STATE_DIR or ~/.claude-state.
  config 부재/빈 top_channels/빈 workspace_roots = 게이트 비활성(exit 0) —
  설치 완료 판정은 `--probe` 가 막는다(연결 증명 0번 칸: config 없이는 FAIL).

cwd guard (D2 — user-global 등록 + cwd 가드가 «한» 계약): 이 훅은 user-global
PreToolUse 라 모든 프로젝트에서 발화한다. 판정 전에 훅 입력 `cwd`(부재 시
$PWD)를 realpath 정규화해 `workspace_roots` 에 결박 — exact root 또는
`root/` 하위만 게이트 대상, prefix sibling(`/root-other`)·밖 = 통과(비활성).
이게 없으면 무관 프로젝트의 Discord 발신까지 전역 차단된다(85-doc 차단 1).

Origin (D5 v2.3): PreToolUse 는 구조상 model call-path 다 — tool_input 의
`origin` 필드는 host wrapper 상수가 아니라 모델 payload 유래이므로 어떤
값이든 통과 티켓이 될 수 없다. `bridge_notice` 를 자칭하면 model 로
재분류(fail-closed)하고 denial 로그에 `origin_reclassified: true` 를 남긴다.
(브리지 장애 알림의 실제 경로 = templates/bridge.py 직접 발신 — PreToolUse
비경유 = 구조적 음성. fixture 로 명기.)

Probe (`--probe`) — 6칸(setup 스킬 완료 판정과 동일 계약):
①wiring — hooks.json 에 본 훅 PreToolUse 등재 ②trust — config.toml 에
해당 인덱스의 pre_tool_use trusted_hash 존재(Codex 전용 — 없으면 배선돼도
무징후 비활성) ③config — top_channels+workspace_roots 로드 가능 ④양성 —
synthetic 발주 payload 가 실제 decide() 경로에서 deny ⑤음성(미끼) —
비-top 채널 payload 가 pass ⑥음성 — out-of-cwd payload 가 pass(D2 cwd
가드 실증). 전 칸 PASS 아니면 exit 1 (`PROBE PASS 6/6`). + 관측 로그
누적 행수를 info 줄로 표기(판독 계약 보조 — 판정 칸 아님).
"""

import json
import os
import re
import sys
import time

MARKERS = ["발주", "검수", "작업", "구현", "수리", "착수", "진행", "분석",
           "작성", "dispatch", "회수", "테스트", "검증"]
CARVEOUT = re.compile(r"\[(공지|단발|핑)\]")
MENTION = re.compile(r"<@!?(\d+)>")
ROSTER_ID = re.compile(r'user_id:\s*"(\d+)"')


def state_dir():
    return os.environ.get("MEETING_WATCHDOG_STATE_DIR") or os.path.expanduser(
        "~/.claude-state")


def load_config():
    try:
        cfg = json.load(open(os.path.join(state_dir(), "dispatch-gate.json"),
                             encoding="utf-8"))
        return {"top_channels": set(map(str, cfg.get("top_channels", []))),
                "roster_path": cfg.get("roster_path", ""),
                "workspace_roots": [os.path.realpath(r) for r in
                                    cfg.get("workspace_roots", [])]}
    except Exception:
        return None


def cwd_in_scope(data, cfg):
    """D2 cwd guard: 훅 입력 cwd(부재 = $PWD)가 workspace_roots 결박 안인가.
    exact root 또는 root/ 하위만 True — prefix sibling 통과 금지."""
    cwd = data.get("cwd") or os.environ.get("PWD") or ""
    if not cwd or not cfg["workspace_roots"]:
        return False
    real = os.path.realpath(cwd)
    for root in cfg["workspace_roots"]:
        if real == root or real.startswith(root.rstrip(os.sep) + os.sep):
            return True
    return False


def load_roster_ids(roster_path):
    """None = 미독(fail-closed 신호) / set = 실측 로스터."""
    try:
        parsed = set(ROSTER_ID.findall(
            open(roster_path, encoding="utf-8").read()))
        return parsed or None
    except Exception:
        return None


def decide(data, cfg):
    """(verdict, record) — verdict ∈ {'pass','deny'}; record = 로그/사유.
    pass record 에 'observe' 가 실리면 호출자가 관측 로그 1행을 남긴다."""
    tool = data.get("tool_name", "")
    if not tool.endswith("__reply") and not tool.endswith("__edit_message"):
        return "pass", {"why": "non-target tool"}
    if not cwd_in_scope(data, cfg):
        return "pass", {"why": "out of workspace scope (cwd guard)"}
    ti = data.get("tool_input", {}) or {}
    chat_id = str(ti.get("chat_id", ""))
    text = str(ti.get("text", "") or "")

    origin_claimed = ti.get("origin")
    origin_reclassified = bool(origin_claimed)  # 모델 payload 유래 = 전부 무효

    if chat_id not in cfg["top_channels"]:
        return "pass", {"why": "not a top-level channel"}

    roster_ids = load_roster_ids(cfg["roster_path"])
    mentioned = set(MENTION.findall(text))
    if roster_ids is None:
        # 로스터 미독 = fail-closed: 멘션 전부를 잠재 봇으로 간주
        bot_mentions = mentioned
    else:
        bot_mentions = mentioned & roster_ids

    carveout = CARVEOUT.search(text)
    if carveout:
        # 계약: 자기선언 carve-out 태그 = pass (감사 가능 경로 — 태그가
        # 발신문에 공개 표기된다. origin 과 달리 «의도 선언»이라 fail-closed
        # 승격 = §1.2 프로토콜 폐지와 등가 → 게이트 사정거리 밖).
        # 단 «태그 + 봇멘션 + 발주 마커» 조합은 오용 후보 — 관측 로그 1행
        # (pass 유지). 판독 계약 = 70-doc §2 (카파시 · 주간/폐합/P4+7일).
        rec = {"why": "carve-out tag"}
        if bot_mentions and any(m in text for m in MARKERS):
            rec["observe"] = {
                "chat_id": chat_id, "tag": carveout.group(0),
                "bot_mentions": sorted(bot_mentions),
                "text_head": text[:120],
            }
        return "pass", rec

    if not bot_mentions:
        return "pass", {"why": "no bot mention"}
    if not any(m in text for m in MARKERS):
        return "pass", {"why": "no dispatch marker"}
    return "deny", {
        "chat_id": chat_id,
        "bot_mentions": sorted(bot_mentions),
        "text_head": text[:120],
        "origin_claimed": origin_claimed,
        "origin_effective": "model",
        "origin_reclassified": origin_reclassified,
        "roster_fail_closed": roster_ids is None,
    }


def _append_jsonl(basename, record, probe=False):
    try:
        log_path = os.path.join(state_dir(), basename)
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(
                {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                 **({"probe": True} if probe else {}), **record},
                ensure_ascii=False) + "\n")
    except Exception:
        pass


def write_denial(record, probe=False):
    _append_jsonl("dispatch-gate-denials.jsonl", record, probe)


def write_observation(record, probe=False):
    _append_jsonl("dispatch-gate-observations.jsonl", record, probe)


def observation_count():
    try:
        with open(os.path.join(state_dir(),
                               "dispatch-gate-observations.jsonl"),
                  encoding="utf-8") as fh:
            return sum(1 for line in fh if line.strip())
    except OSError:
        return 0


DENY_REASON = (
    "[회의실 게이트 · meeting-protocol §1] 본문 채널에서 봇에게 발주하려 "
    "합니다 — 봇 간 작업 위임은 전용 스레드(회의실 4-file 동반)에서만. "
    "통과 경로: ① 회의 스레드/DM 에서 발신(없으면 회의실+스레드 먼저 생성) "
    "② 단발 공지·생존 핑이면 [공지]/[단발]/[핑] 태그 명기 "
    "③ 사람 대상 메시지는 봇 멘션 제거. (spec: dispatch-meeting-gate 70-doc "
    "v3.0 D1 — ThisCodex port)"
)


def hook_main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    cfg = load_config()
    if not cfg or not cfg["top_channels"] or not cfg["workspace_roots"]:
        return 0                      # 미설정 = 비활성 (probe 가 설치층에서 잡음)
    verdict, record = decide(data, cfg)
    if verdict == "pass":
        if record.get("observe"):
            write_observation(record["observe"])
        return 0
    write_denial(record)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": DENY_REASON,
        }
    }))
    return 0


def probe_main():
    """연결 증명 0번 칸 — 전 칸 PASS 여야 설치 완료를 말할 수 있다."""
    results = []

    settings_path = os.environ.get("DISPATCH_GATE_SETTINGS") or \
        os.path.expanduser("~/.codex/hooks.json")
    wired = False
    wired_idx = None                     # (entry, hook) — trust 키 좌표
    try:
        body = open(settings_path, encoding="utf-8").read()
        parsed = json.loads(body)
        entries = parsed.get("hooks", {}).get("PreToolUse", []) or []
        for i, entry in enumerate(entries):
            for j, h in enumerate(entry.get("hooks", []) or []):
                if "dispatch-room-gate.py" in str(h.get("command", "")):
                    wired = True
                    wired_idx = (i, j)
    except Exception:
        pass
    results.append(("wiring(hooks.json PreToolUse)", wired))

    # ②trust — Codex 전용: /hooks 승인 없이는 배선돼도 무징후 비활성.
    # config.toml 의 [hooks.state."…:pre_tool_use:<entry>:<hook>"] 블록에
    # trusted_hash 가 있어야 활성(표기 주의: hooks.json 은 PreToolUse
    # CamelCase, trust 키는 pre_tool_use snake_case — 같은 이벤트).
    config_toml = os.environ.get("DISPATCH_GATE_CONFIG_TOML") or \
        os.path.expanduser("~/.codex/config.toml")
    trusted = False
    if wired_idx is not None:
        try:
            toml_body = open(config_toml, encoding="utf-8").read()
            key = "pre_tool_use:%d:%d" % wired_idx
            pat = re.compile(
                r'\[hooks\.state\."[^"]*' + re.escape(key)
                + r'"\]([^\[]*)', re.S)
            m = pat.search(toml_body)
            trusted = bool(m and "trusted_hash" in m.group(1))
        except Exception:
            pass
    results.append(("trust(config.toml trusted_hash)", trusted))

    cfg = load_config()
    if not cfg or not cfg["top_channels"] or not cfg["workspace_roots"]:
        results.append(("config(top_channels+workspace_roots)", False))
        results.append(("deny(양성 in-cwd)", False))
        results.append(("pass(음성 비-top)", False))
        results.append(("pass(음성 out-cwd)", False))
    else:
        results.append(("config(top_channels+workspace_roots)", True))
        top = sorted(cfg["top_channels"])[0]
        in_cwd = cfg["workspace_roots"][0]
        roster_ids = load_roster_ids(cfg["roster_path"])
        probe_id = sorted(roster_ids)[0] if roster_ids else "999999999999"
        payload = {"tool_name": "mcp__discord__reply",
                   "cwd": in_cwd,
                   "tool_input": {"chat_id": top,
                                  "text": "<@%s> 작업 착수 (probe)" % probe_id}}
        verdict, record = decide(payload, cfg)
        if verdict == "deny":
            write_denial(record, probe=True)
        results.append(("deny(양성 in-cwd)", verdict == "deny"))
        neg = {"tool_name": "mcp__discord__reply",
               "cwd": in_cwd,
               "tool_input": {"chat_id": "000000000000000000",
                              "text": "<@%s> 작업 착수 (probe)" % probe_id}}
        verdict2, _ = decide(neg, cfg)
        results.append(("pass(음성 비-top)", verdict2 == "pass"))
        out = dict(payload, cwd="/tmp/dispatch-gate-probe-out-of-scope")
        verdict3, _ = decide(out, cfg)
        results.append(("pass(음성 out-cwd)", verdict3 == "pass"))

    ok = sum(1 for _n, r in results if r)
    for name, r in results:
        print("  [%s] %s" % ("PASS" if r else "FAIL", name))
    # 판독 보조(판정 칸 아님): 관측 로그 누적 — 판독 계약(70-doc §2, 카파시)
    print("  [info] carve-out 관측 로그 누적 %d행" % observation_count())
    print("PROBE %s %d/%d" % ("PASS" if ok == len(results) else "FAIL",
                              ok, len(results)))
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    # Windows 기본 stdout/stderr/stdin 은 cp1252 — probe 의 한국어 info 줄
    # (encode 축)과 훅 payload 의 비ASCII text(decode 축)가 죽는다. 같은
    # 전제(플랫폼 기본 인코딩)를 공유하는 세 표면을 함께 utf-8 강제
    # (POSIX 는 무해 · 2026-08-12 CI win32 실측 후 전수).
    for _s in (sys.stdout, sys.stderr, sys.stdin):
        if hasattr(_s, "reconfigure"):
            try:
                _s.reconfigure(encoding="utf-8")
            except Exception:
                pass
    if "--probe" in sys.argv:
        sys.exit(probe_main())
    sys.exit(hook_main())
