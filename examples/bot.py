#!/usr/bin/env python3
"""ThisCodex reference bridge — Codex CLI app-server ↔ Discord (YOLO opt-in).

This is the **reference implementation** of the bridge daemon that `launch.sh`
runs as its `LAUNCH_CMD` infra process. It is what actually sends the
full-access sandbox to the Codex app-server. `launch.sh` alone is NOT enough —
without this bridge (or one that honors the same contract), a deployed user
cannot run a full-access Codex Discord bot. See docs/yolo-bridge-contract.md.

  Discord WebSocket Gateway
    ↓ inbound @mention / DM
  bot.py (discord.py + asyncio)
    ↓ format <channel source="discord" ...> text
    ↓ JSON-RPC over WebSocket → codex app-server
  codex app-server (ws://127.0.0.1:4222)
    ↓ thread/start (1x) → turn/start (per mention)
    ↓ codex auto-calls the mcp__discord__reply tool
  Discord plugin (reused as a codex MCP server)
    ↓ Discord REST API
  → Discord message sent

╔═══════════════════════════════════════════════════════════════════════════╗
║  YOLO MODE — READ BEFORE DEPLOYING                                         ║
║                                                                           ║
║  This bridge sends sandbox="danger-full-access", approvalPolicy="never"   ║
║  on BOTH thread/start AND thread/resume. That gives the model unrestricted ║
║  shell + filesystem + network on the host. It is OPT-IN, not a default:    ║
║  set THISCODEX_YOLO=1 to enable. With THISCODEX_YOLO unset the bridge runs ║
║  the SAFE default sandbox ("workspace-write"). There is no interactive     ║
║  approval UI in a headless bridge, so risky ops are DENIED by default      ║
║  (the bridge answers approval requests with "cancel"), not prompted.       ║
║                                                                           ║
║  Untrusted Discord text → a YOLO model = arbitrary code execution on your  ║
║  machine. Only enable on a host you control with a TRUSTED private Discord ║
║  server. See docs/yolo-bridge-contract.md §Security.                       ║
╚═══════════════════════════════════════════════════════════════════════════╝
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import time
from pathlib import Path

# unbuffered stdout — immediate tmux pane log visibility
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

try:
    import discord
    import websockets
except ImportError as e:
    print(f"[FATAL] missing dependency: {e}. Run `pip install -r requirements.txt` first")
    sys.exit(1)

# The bridge's working dir is the BOT working dir (holds .codex-thread-id,
# dedup.json, bot-info.json, and the auto-loaded SOUL.md/AGENTS.md) — NOT this
# examples/ folder. launch.sh starts the infra with cwd=$BOT_WD and exports
# BOT_WD; honor that. Never use __file__'s parent (that would scope state to
# ThisCodex/examples/ and mis-wire persona auto-load).
_bw = os.environ.get("BOT_WD")
WD = Path(_bw).resolve() if _bw else Path.cwd()

# Bot identity is NOT hardcoded — set BOT_NAME to your bot's channel-state slug.
# The Discord plugin keeps per-bot token/state at
#   ~/.claude/channels/discord-<BOT_NAME>/.env   (DISCORD_BOT_TOKEN=...)
# This mirrors the Claude Code Discord plugin layout so one plugin install
# serves both Claude Code and Codex bots.
BOT_NAME = os.environ.get("BOT_NAME", "mybot")
ENV_PATH = Path.home() / ".claude" / "channels" / f"discord-{BOT_NAME}" / ".env"
DEDUP_PATH = WD / "dedup.json"
BOT_INFO_PATH = WD / "bot-info.json"
THREAD_ID_PATH = WD / ".codex-thread-id"

CODEX_WS = os.environ.get("CODEX_WS", "ws://127.0.0.1:4222")
TURN_TIMEOUT_SEC = int(os.environ.get("CODEX_TURN_TIMEOUT", "300"))
MAX_DEDUP_ENTRIES = 5000

# YOLO is opt-in and selectable PER BOT. Opt-in signals — all OPERATOR-
# controlled and OUTSIDE the model's writable working dir (critical: a sentinel
# inside WD would let a model, fed untrusted Discord text in safe mode, write
# the file and self-upgrade safe→YOLO on the next bridge restart):
#   - env THISCODEX_YOLO=1                    (process-scoped, one-off launch)
#   - env THISCODEX_YOLO_FILE=/abs/path       (explicit operator path), else
#   - default sentinel  ~/.claude/channels/discord-<BOT_NAME>/.thiscodex-yolo
#     (the bridge/token state dir — per-bot, and NOT the model's cwd/WD, so the
#      model cannot create it). Neither present → safe default sandbox.
_yolo_file = os.environ.get("THISCODEX_YOLO_FILE")
_yolo_sentinel = Path(_yolo_file) if _yolo_file else (ENV_PATH.parent / ".thiscodex-yolo")
YOLO = (os.environ.get("THISCODEX_YOLO", "0") == "1") or _yolo_sentinel.is_file()
SANDBOX = "danger-full-access" if YOLO else "workspace-write"
APPROVAL_POLICY = "never" if YOLO else "on-request"

# B-fix: bridge-level progress heartbeat. A long turn (model working silently)
# emits a progress message to the originating channel every
# HEARTBEAT_INTERVAL_SEC, so a long/blocked task is never a silent gap even if
# the model forgets its proactive-report rule. 0 disables.
# Default MUST be < the turn timeout, or the timeout fires first and the
# heartbeat never sends. Clamp to guarantee at least one heartbeat per turn.
HEARTBEAT_INTERVAL_SEC = int(os.environ.get("THISCODEX_HEARTBEAT_SEC", "240"))
if 0 < TURN_TIMEOUT_SEC <= HEARTBEAT_INTERVAL_SEC:
    HEARTBEAT_INTERVAL_SEC = max(30, int(TURN_TIMEOUT_SEC * 0.8))


def load_token() -> str:
    if not ENV_PATH.exists():
        raise RuntimeError(f"DISCORD_BOT_TOKEN file not found: {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("DISCORD_BOT_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"no DISCORD_BOT_TOKEN= entry in {ENV_PATH}")


def load_dedup() -> dict:
    if not DEDUP_PATH.exists():
        return {}
    try:
        return json.loads(DEDUP_PATH.read_text() or "{}")
    except json.JSONDecodeError:
        return {}


def save_dedup(state: dict) -> None:
    if len(state) > MAX_DEDUP_ENTRIES:
        oldest = sorted(state.items(), key=lambda kv: kv[1].get("ts", 0))[: len(state) - MAX_DEDUP_ENTRIES]
        for k, _ in oldest:
            state.pop(k, None)
    DEDUP_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))


class CodexRPC:
    """Minimal JSON-RPC client over WebSocket for the codex app-server v2 protocol."""

    def __init__(self, url: str):
        self.url = url
        self.ws = None
        self.next_id = 1
        self.pending: dict[int, asyncio.Future] = {}
        self.turn_done: dict[str, asyncio.Future] = {}
        self.reader_task = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        print(f"[CODEX-RPC] connecting to {self.url} ...")
        self.ws = await websockets.connect(self.url, max_size=None)
        self.reader_task = asyncio.create_task(self._reader())
        await self.call("initialize", {
            "clientInfo": {"name": "thiscodex_bridge", "version": "0.1.0"},
            "capabilities": {"experimentalApi": True},
        })
        # initialized notification (no id)
        await self.ws.send(json.dumps({"method": "initialized"}))
        print("[CODEX-RPC] initialized")

    async def _reader(self) -> None:
        try:
            async for raw in self.ws:
                # DEBUG: log every incoming frame (truncated)
                print(f"[WS-IN] {str(raw)[:400]}")
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    print(f"[CODEX-RPC] non-JSON frame: {str(raw)[:200]}")
                    continue

                if "id" in msg and ("result" in msg or "error" in msg):
                    fut = self.pending.pop(msg["id"], None)
                    if fut and not fut.done():
                        fut.set_result(msg)
                    continue

                method = msg.get("method", "")

                # Server-initiated JSON-RPC request — the client MUST respond, or
                # the codex turn hangs forever (turn/start then codex asks the
                # client for approval / elicitation / a tool call; ignoring it
                # never completes the turn).
                if "id" in msg and method:
                    print(f"[WS-SERVER-REQ] method={method} id={msg['id']}")
                    if method in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval"):
                        # In YOLO the model should not be asked (approvalPolicy
                        # never); if it is, default-deny is the safe answer.
                        resp = {"id": msg["id"], "result": {"decision": "cancel"}}
                    elif method == "mcpServer/elicitation/request":
                        # MCP tool-call approval — codex asks the client right
                        # before calling e.g. mcp__discord__reply. accept +
                        # persist:"session" auto-approves for this session.
                        params = msg.get("params", {})
                        kind = (params.get("_meta") or {}).get("codex_approval_kind", "")
                        print(f"[ELICIT-ACCEPT] server={params.get('serverName')} kind={kind}")
                        resp = {"id": msg["id"], "result": {"action": "accept", "content": {}, "_meta": {"persist": "session"}}}
                    elif method == "item/tool/requestUserInput":
                        resp = {"id": msg["id"], "result": {"answers": {}}}
                    elif method == "item/tool/call":
                        params = msg.get("params", {})
                        resp = {"id": msg["id"], "result": {
                            "success": False,
                            "contentItems": [{"type": "inputText", "text": f"Client-side tool not implemented: {params.get('tool', '?')}"}],
                        }}
                    elif method == "item/permissions/requestApproval":
                        resp = {"id": msg["id"], "result": {"decision": "cancel"}}
                    else:
                        resp = {"id": msg["id"], "error": {"code": -32601, "message": f"Unhandled server request: {method}"}}
                    await self.ws.send(json.dumps(resp))
                    continue

                # any "completed"-flavored turn notification resolves the future
                if method == "turn/completed" or method.endswith("/turn/completed") or "TurnCompleted" in method:
                    turn = msg.get("params", {}).get("turn") or msg.get("params", {})
                    tid = turn.get("id") if isinstance(turn, dict) else None
                    if tid:
                        fut = self.turn_done.pop(tid, None)
                        if fut and not fut.done():
                            fut.set_result(turn)
                    else:
                        # fallback: resolve oldest pending turn
                        if self.turn_done:
                            key, fut = next(iter(self.turn_done.items()))
                            self.turn_done.pop(key, None)
                            if not fut.done():
                                fut.set_result(turn)
                elif method.startswith("item/agentMessage"):
                    # stream notification — log only
                    pass
        except websockets.ConnectionClosed as e:
            print(f"[CODEX-RPC] connection closed: {e}")
        except Exception as e:
            print(f"[CODEX-RPC] reader error: {type(e).__name__}: {e}")

    async def call(self, method: str, params: dict | None = None) -> dict:
        async with self._lock:
            rid = self.next_id
            self.next_id += 1
            fut = asyncio.get_running_loop().create_future()
            self.pending[rid] = fut
            req: dict = {"id": rid, "method": method}
            if params is not None:
                req["params"] = params
            await self.ws.send(json.dumps(req))
        try:
            msg = await asyncio.wait_for(fut, timeout=60)
        except asyncio.TimeoutError:
            self.pending.pop(rid, None)
            raise RuntimeError(f"timeout: {method}")
        if "error" in msg:
            raise RuntimeError(f"{method} failed: {msg['error']}")
        return msg.get("result", {})

    async def ensure_thread(self) -> str:
        if THREAD_ID_PATH.exists():
            tid = THREAD_ID_PATH.read_text().strip()
            try:
                # CONTRACT (do NOT drop): thread/resume MUST re-send sandbox +
                # approvalPolicy. If omitted, the resumed thread silently falls
                # back to the server default (workspace-write /
                # networkAccess:false) — so YOLO would apply on the very first
                # turn and then never again after the first resume. This is the
                # single nastiest bug; see docs/yolo-bridge-contract.md.
                await self.call("thread/resume", {
                    "threadId": tid,
                    "cwd": str(WD),
                    "sandbox": SANDBOX,
                    "approvalPolicy": APPROVAL_POLICY,
                })
                print(f"[CODEX-RPC] resumed thread {tid} (sandbox={SANDBOX})")
                return tid
            except Exception as e:
                print(f"[CODEX-RPC] resume failed ({e}) — starting new thread")

        res = await self.call("thread/start", {
            "cwd": str(WD),
            "sandbox": SANDBOX,
            "approvalPolicy": APPROVAL_POLICY,
            "threadSource": "user",
        })
        # spec uncertainty — try multiple shapes
        tid = None
        if isinstance(res, dict):
            tid = res.get("threadId") or (res.get("thread") or {}).get("id")
        if not tid:
            raise RuntimeError(f"thread/start did not return id: {res}")
        THREAD_ID_PATH.write_text(tid)
        print(f"[CODEX-RPC] started new thread {tid} (sandbox={SANDBOX})")
        return tid

    async def send_turn(self, thread_id: str, text: str) -> dict:
        res = await self.call("turn/start", {
            "threadId": thread_id,
            "input": [{"type": "text", "text": text}],
        })
        print(f"[CODEX-RPC] turn/start response = {json.dumps(res)[:400]}")
        turn = res if isinstance(res, dict) else {}
        turn_id = turn.get("turnId") or (turn.get("turn") or {}).get("id")
        print(f"[CODEX-RPC] extracted turn_id = {turn_id}")
        if not turn_id:
            return turn
        fut = asyncio.get_running_loop().create_future()
        self.turn_done[turn_id] = fut
        try:
            return await asyncio.wait_for(fut, timeout=TURN_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            self.turn_done.pop(turn_id, None)
            print(f"[CODEX-RPC] turn timeout: {turn_id}")
            return {"status": "timeout", "turnId": turn_id}


TOKEN = load_token()
codex = CodexRPC(CODEX_WS)
queue: asyncio.Queue = asyncio.Queue()
thread_id: str | None = None


intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)


@client.event
async def on_ready():
    global thread_id
    print(f"[READY] discord.py logged in as {client.user} (id={client.user.id})")
    print(f"[READY] YOLO={'ON (danger-full-access)' if YOLO else 'off (workspace-write)'} "
          f"heartbeat={HEARTBEAT_INTERVAL_SEC}s")
    BOT_INFO_PATH.write_text(json.dumps({
        "user_id": str(client.user.id),
        "name": str(client.user),
        "ready_at": int(time.time()),
    }, ensure_ascii=False, indent=2))

    # connect codex app-server (with retries — app-server may still be booting)
    for attempt in range(10):
        try:
            await codex.connect()
            break
        except Exception as e:
            print(f"[CODEX-RPC] connect attempt {attempt+1} failed: {e}")
            await asyncio.sleep(2)
    else:
        print("[FATAL] codex app-server connect failed after 10 attempts")
        await client.close()
        return

    thread_id = await codex.ensure_thread()
    print(f"[READY] codex thread = {thread_id}")
    asyncio.create_task(worker())


async def _heartbeat(channel, started: float, stop: asyncio.Event) -> None:
    """B-fix: while a turn runs, emit a progress note every interval so a long
    or blocked task is never a silent gap (defense-in-depth alongside the
    model's proactive-report rule in SOUL.md/AGENTS.md)."""
    if HEARTBEAT_INTERVAL_SEC <= 0 or channel is None:
        return
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL_SEC)
            return  # stop set → turn finished, no heartbeat needed
        except asyncio.TimeoutError:
            mins = int((time.time() - started) // 60)
            try:
                await channel.send(f"⏳ still working — {mins}m elapsed, no result yet "
                                    f"(bridge heartbeat; the bot will report when done or blocked)")
            except Exception as e:
                print(f"[HEARTBEAT] send failed: {type(e).__name__}: {e}")


@client.event
async def on_message(msg: discord.Message):
    is_self = (msg.author == client.user)
    is_mentioned = (client.user in msg.mentions)
    is_dm = isinstance(msg.channel, discord.DMChannel)
    print(f"[RAW] ch={msg.channel.id} dm={is_dm} "
          f"author={msg.author} ({msg.author.id}) bot={msg.author.bot} "
          f"self={is_self} mentioned={is_mentioned} content='{msg.content[:80]}'")

    if is_self:
        return
    # DM channel = no mention required (the bot receiving it IS the intent).
    # Guild channel/thread = mention required.
    if not is_dm and not is_mentioned:
        return

    state = load_dedup()
    if str(msg.id) in state:
        return
    state[str(msg.id)] = {"ts": int(time.time()), "ch": str(msg.channel.id)}
    save_dedup(state)

    print(f"[MSG] {msg.author} in {msg.channel} ({msg.id}): {msg.content[:120]}")
    try:
        await msg.add_reaction("🔍")
    except Exception:
        pass

    # format as a <channel> tag — codex reads it as conversation context
    clean = msg.content.replace(f"<@{client.user.id}>", "").replace(f"<@!{client.user.id}>", "").strip()
    parent_info = ""
    if hasattr(msg.channel, "parent") and msg.channel.parent is not None:
        parent_info = f' parent_chat_id="{msg.channel.parent.id}"'
    event = (
        f'<channel source="discord" chat_id="{msg.channel.id}"'
        f'{parent_info} message_id="{msg.id}"'
        f' user="{msg.author}" user_id="{msg.author.id}"'
        f' ts="{msg.created_at.isoformat()}">\n'
        f'{clean}\n'
        f'</channel>\n'
        f'→ reply to the message above.'
    )
    # Static reply rule lives in AGENTS.md (project-doc auto-loaded), NOT
    # re-injected per turn. Per-turn payload = the dynamic <channel> block +
    # one "→ reply" line only (no persona/SOUL re-announcement noise).
    await queue.put((event, msg.channel))


async def worker():
    """Serialize turns — the codex app-server is single-turn-per-thread here."""
    global thread_id
    print("[WORKER-START]")
    while True:
        event, channel = await queue.get()
        print(f"[WORKER-GET] event size = {len(event)} chars")
        stop = asyncio.Event()
        hb = asyncio.create_task(_heartbeat(channel, time.time(), stop))
        blocked_reason = None
        try:
            if thread_id is None:
                thread_id = await codex.ensure_thread()
            print(f"[WORKER-SEND] turn/start to thread {thread_id} ...")
            result = await codex.send_turn(thread_id, event)
            print(f"[TURN-DONE] result keys: {list(result.keys()) if isinstance(result, dict) else type(result).__name__}")
            if isinstance(result, dict) and result.get("status") == "timeout":
                blocked_reason = f"turn timed out after {TURN_TIMEOUT_SEC}s with no result"
        except Exception as e:
            blocked_reason = f"turn dispatch error: {type(e).__name__}"
            print(f"[ERROR] turn dispatch: {type(e).__name__}: {e}")
        finally:
            stop.set()
            hb.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await hb
            # B-fix fail-safe: a timeout/exception otherwise produces NO Discord
            # message at all (the codex turn never called mcp__discord__reply).
            # Emit a generic blocked report so it is never a silent gap.
            if blocked_reason and channel is not None:
                try:
                    await channel.send(f"⚠️ blocked — {blocked_reason}; no reply was produced "
                                       f"(bridge fail-safe report; check the bot host).")
                except Exception as e:
                    print(f"[BLOCKED-REPORT] send failed: {type(e).__name__}: {e}")
            queue.task_done()


def main():
    print(f"[INFO] WD: {WD}")
    print(f"[INFO] CODEX_WS: {CODEX_WS}")
    print(f"[INFO] ENV: {ENV_PATH}")
    print(f"[INFO] YOLO: {'ON' if YOLO else 'off'}  SANDBOX: {SANDBOX}  APPROVAL: {APPROVAL_POLICY}")
    client.run(TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
