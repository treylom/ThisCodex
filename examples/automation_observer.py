"""Secret-minimizing app-server completion classifier used by bot.py."""
from __future__ import annotations

import re


def _error_class(item: dict) -> str:
    if not item.get("error"):
        return "none"
    message = str((item.get("error") or {}).get("message") or "").lower()
    if "cancel" in message:
        return "cancelled"
    return "mcp_error" if item.get("type") == "mcpToolCall" else "tool_error"


def classify_automation_item(item: dict, browser_servers: set[str]) -> dict | None:
    """Return an allow-listed envelope; never copy command/args/result/error."""
    if item.get("type") == "mcpToolCall":
        provider = str(item.get("server") or "")
        status = str(item.get("status") or "")
        if provider not in browser_servers or status not in ("completed", "failed"):
            return None
        tool = str(item.get("tool") or "unknown")[:96]
        normalized = tool.lower().replace("-", "_")
        if re.search(r"snapshot|inspect|accessibility|dom|page_content|screenshot", normalized):
            tool_class = "browser_inspect"
        elif re.search(r"navigate|goto|click|fill|type|press|select|wait|evaluate", normalized):
            tool_class = "browser_action"
        else:
            tool_class = "browser_other"
        return {
            "provider": provider,
            "tool": tool,
            "tool_class": tool_class,
            "status": status,
            "error_class": _error_class(item),
        }
    if item.get("type") != "commandExecution":
        return None
    command = str(item.get("command") or "")
    status = "completed" if item.get("exitCode") == 0 else "failed"
    error_class = "none" if status == "completed" else "tool_error"
    if re.search(r"\bcodex\s+mcp\s+add\s+(?:playwright|claude-in-chrome)\b", command, re.I):
        provider_match = re.search(r"\b(playwright|claude-in-chrome)\b", command, re.I)
        return {
            "provider": provider_match.group(1).lower(),
            "tool": "provider-setup-command", "tool_class": "provider_setup",
            "status": status, "error_class": error_class,
        }
    if re.search(r"\b(pbcopy|pbpaste|xclip|wl-copy|clip\.exe)\b", command):
        return {
            "provider": "model-blind-clipboard",
            "tool": "clipboard-receipt-command", "tool_class": "clipboard",
            "status": status, "error_class": error_class,
        }
    return None
