#!/usr/bin/env python3
"""PreToolUse gate for automatic-mode manual handoff messages.

The model cannot authorize its own handoff with prose.  A message that looks
like a manual handoff must carry a short-lived receipt issued by
`thiscodex automation-gate` for the bridge's current turn.  Receipt files hold
only coordinates and policy labels; tool arguments/results are never stored.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone

FLOW_TTL_SECONDS = 2 * 60 * 60

HANDOFF_RE = re.compile(
    r"thiscodex-manual-handoff|직접\s*(?:해|입력|설치|승인|로그인)|"
    r"수동으로\s*(?:진행|해|입력)|"
    r"(?:로그인|인증|계정|비밀번호|토큰|캡차|승인|입력|설치|설정|클릭|열기|완료)"
    r".{0,24}(?:해\s*주세요|해주세요|주셔야|해야\s*합니다|필요합니다)|"
    r"(?:please|you\s+(?:need|must|have)\s+to|operator\s+must|user\s+must)"
    r".{0,96}(?:sign\s*in|log\s*in|authenticate|enter|provide|approve|install|configure|click|complete)|"
    r"please\s+(?:do|complete|enter|install|approve).{0,40}manually|"
    r"manual\s+handoff",
    re.I | re.S,
)
RECEIPT_RE = re.compile(r"<!--\s*thiscodex-automation-receipt:([a-f0-9]{48})\s*-->")


def _payload() -> dict:
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def _decision(allow: bool, reason: str = "") -> None:
    value = "allow" if allow else "deny"
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": value,
        **({"permissionDecisionReason": reason} if reason else {}),
    }}, ensure_ascii=False))


def _state_dir() -> Path:
    explicit = os.environ.get("THISCODEX_AUTOMATION_EVIDENCE_DIR")
    if explicit:
        return Path(explicit).expanduser()
    discord = os.environ.get("DISCORD_STATE_DIR")
    if discord:
        return Path(discord).expanduser() / ".thiscodex-automation"
    return Path.home() / ".config" / "thiscodex" / "automation-evidence"


def _auto_mode() -> bool:
    if os.environ.get("THISCODEX_AUTOMATION_MODE"):
        return os.environ["THISCODEX_AUTOMATION_MODE"] == "auto"
    state = Path.home() / ".config" / "thiscodex" / "install-state.json"
    try:
        return json.loads(state.read_text()).get("answers", {}).get("automation_mode", "auto") == "auto"
    except Exception:
        return True  # missing/corrupt state fails closed for a detected handoff


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _read_jsonl(path: Path) -> list[dict]:
    try:
        return [json.loads(line) for line in path.read_text().splitlines() if line]
    except Exception:
        return []


def _active_flow(path: Path, active: dict, now: datetime) -> dict:
    flow = _read_json(path)
    if not flow.get("flow") or flow.get("thread_id") != active.get("thread_id"):
        return {}
    try:
        started = datetime.fromisoformat(str(flow.get("started_at")).replace("Z", "+00:00"))
    except Exception:
        return {}
    return flow if (now - started).total_seconds() <= FLOW_TTL_SECONDS else {}


def _text(tool_input: dict) -> str:
    for key in ("text", "content", "message", "body"):
        value = tool_input.get(key)
        if isinstance(value, str):
            return value
    return json.dumps(tool_input, ensure_ascii=False)


def main() -> None:
    event = _payload()
    tool = str(event.get("tool_name") or "")
    if not re.search(r"(?:discord.*(?:reply|edit)|reply.*discord)", tool, re.I):
        _decision(True)
        return
    body = _text(event.get("tool_input") or {})
    directory = _state_dir()
    active = _read_json(directory / "active-turn.json")
    now = datetime.now(timezone.utc)
    active_flow = _active_flow(directory / "active-flow.json", active, now)
    flow_applies = bool(active_flow)
    if not _auto_mode() or (not flow_applies and not HANDOFF_RE.search(body)):
        _decision(True)
        return
    match = RECEIPT_RE.search(body)
    if not match:
        _decision(False, "자동 모드의 수동 인계 문구에는 thiscodex automation-gate가 발급한 현재 턴 receipt가 필요합니다.")
        return

    receipts = _read_jsonl(directory / "handoff-receipts.jsonl")
    token = match.group(1)
    used_marker = directory / f"receipt-{token}.used"
    receipt = next((row for row in reversed(receipts) if row.get("token") == token), None)
    try:
        expires = datetime.fromisoformat(str(receipt.get("expires_at")).replace("Z", "+00:00"))
    except Exception:
        expires = datetime.fromtimestamp(0, timezone.utc)
    valid = bool(
        receipt
        and not used_marker.exists()
        and receipt.get("thread_id") == active.get("thread_id")
        and receipt.get("turn_id") == active.get("turn_id")
        and (not flow_applies or receipt.get("flow") == active_flow.get("flow"))
        and expires >= now
    )
    if not valid:
        _decision(False, "수동 인계 receipt가 만료·재사용됐거나 현재 bridge turn과 일치하지 않습니다.")
        return

    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        fd = os.open(used_marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        _decision(False, "수동 인계 receipt가 이미 다른 동시 실행에서 소비됐습니다.")
        return
    with os.fdopen(fd, "w", encoding="utf-8") as marker:
        marker.write(json.dumps({"token": token, "used_at": now.isoformat()}, separators=(",", ":")))
    used_path = directory / "used-handoff-receipts.jsonl"
    with used_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({
            "schema_version": 1,
            "token": token,
            "thread_id": active.get("thread_id"),
            "turn_id": active.get("turn_id"),
            "used_at": now.isoformat(),
        }, separators=(",", ":")) + "\n")
    os.chmod(used_path, 0o600)
    if flow_applies and receipt.get("resume_required") is False:
        try:
            (directory / "active-flow.json").unlink()
        except FileNotFoundError:
            pass
    _decision(True)


if __name__ == "__main__":
    main()
