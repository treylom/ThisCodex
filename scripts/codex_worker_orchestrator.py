#!/usr/bin/env python3
"""codex_worker_orchestrator.py — the Codex equivalent of Claude Code's
Agent Teams (TeamCreate / Task* / SendMessage) for a KM `-at` skill body
(tool-equivalence-contract.md §"Worker shared-state" / §"Orchestrator
healthcheck").

Why this exists: app-server may not expose a model-visible spawn tool, so
an EXTERNAL orchestrator is authoritative. A KM `-at` adapter shells out
here; the KM SKILL.md is unchanged. Each "worker" is a `codex exec` child;
shared state is one lock-guarded `team_state.json`.

Contract guarantees implemented here:
- single `team_state.json` in the team run dir
  `{team_id, finalized, workers:[{id,workdir,thread,status}], results:[...]}`;
- every access takes an fcntl read-write lock; updates are atomic
  (temp-write → os.replace);
- `finalized` is set ONLY by the orchestrator — a worker never finalizes
  (kills the two-workers-finalize-same-task race);
- crash recovery: a second invocation for the same team that finds a LIVE
  lock exits without respawning; a STALE lock (dead pid) is recovered but
  already-`done` workers are NOT re-run (idempotent — an orchestrator
  restart never re-spawns an already-done task);
- startup healthcheck `codex exec --version` (then `codex --version`); on
  failure the run is `blocked` and the failure surfaces via
  `orchestrator_error`, DISTINCT from a per-worker task error, so a KM body
  can tell "workers never ran" from "a task failed".

Every invocation emits the common result envelope on stdout.
"""
from __future__ import annotations

import argparse
import contextlib
import errno
import fcntl
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path


def _envelope(status, data=None, warnings=None, source="", error=None,
              orchestrator_error=None, incomplete_reason=None):
    return {
        "status": status,                       # ok|partial|error|blocked
        "data": data,
        "warnings": warnings or [],
        "source": source,
        "error": error,
        # set ONLY when the spawn/orchestration layer itself failed —
        # distinct from a worker/task error (contract §envelope).
        "orchestrator_error": orchestrator_error,
        "incomplete_reason": incomplete_reason,
        "audit_id": uuid.uuid4().hex,
    }


def _emit(env: dict) -> int:
    print(json.dumps(env, ensure_ascii=False))
    return {"ok": 0, "partial": 0, "error": 1, "blocked": 2}.get(env["status"], 1)


CODEX_BIN = os.environ.get("THISCODEX_CODEX_BIN", "codex")
WORKER_TIMEOUT = int(os.environ.get("THISCODEX_WORKER_TIMEOUT", "1800"))
WORKER_OUTPUT_CAP = int(os.environ.get("THISCODEX_WORKER_OUTPUT_CAP", "100000"))


def _team_base() -> Path:
    base = os.environ.get("THISCODEX_TEAM_DIR")
    if base:
        return Path(base).expanduser()
    return Path.home() / ".thiscodex" / "teams"


# ── lock (fcntl rw, POSIX) ──────────────────────────────────────────────────
class _Lock:
    """flock-based lock on a sidecar file. The held PID + ts is written to
    the lock file so a second invocation can tell LIVE from STALE."""

    def __init__(self, path: Path):
        self.path = path
        self.fd = None

    def acquire(self, exclusive=True, blocking=True) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
        flags = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        if not blocking:
            flags |= fcntl.LOCK_NB
        try:
            fcntl.flock(self.fd, flags)
        except OSError as e:
            if e.errno in (errno.EAGAIN, errno.EACCES):
                os.close(self.fd)
                self.fd = None
                return False
            raise
        # pid/ts written for human/forensic inspection ONLY — never read
        # back for control flow (a lock-free content read is racy with this
        # truncate+write window; flock itself is the source of truth —
        # independent-review BLOCKER).
        os.ftruncate(self.fd, 0)
        os.write(self.fd, json.dumps({"pid": os.getpid(),
                                      "ts": int(time.time())}).encode())
        os.fsync(self.fd)
        return True

    def release(self):
        if self.fd is not None:
            with contextlib.suppress(Exception):
                fcntl.flock(self.fd, fcntl.LOCK_UN)
            with contextlib.suppress(Exception):
                os.close(self.fd)
            self.fd = None


# ── atomic state ────────────────────────────────────────────────────────────
def _read_state(state_path: Path) -> dict:
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_state(state_path: Path, state: dict) -> None:
    """temp-write then os.replace (atomic, same dir). Caller MUST hold the
    team lock so concurrent writers cannot interleave."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_path.parent / f".{state_path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, state_path)
    except Exception:
        with contextlib.suppress(Exception):
            tmp.unlink()
        raise


# ── healthcheck ─────────────────────────────────────────────────────────────
def _healthcheck() -> tuple[bool, str]:
    """Contract: `codex exec --version` once; fall back to `codex --version`
    (CLI surface not pinned). Either succeeding = healthy."""
    last = "no attempt"
    for argv in ([CODEX_BIN, "exec", "--version"], [CODEX_BIN, "--version"]):
        try:
            p = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            continue
        if p.returncode == 0:
            return True, (p.stdout or p.stderr).strip()[:120]
        last = f"rc={p.returncode} {(p.stderr or p.stdout).strip()[:160]}"
    return False, last


# ── worker run ──────────────────────────────────────────────────────────────
def _run_worker(w: dict) -> dict:
    """One `codex exec` child. Returns a result record; a worker failure is a
    TASK error (not an orchestrator error)."""
    wid = w["id"]
    workdir = w.get("workdir") or os.getcwd()
    prompt = w.get("prompt", "")
    rec = {"id": wid, "workdir": workdir, "thread": w.get("thread"),
           "status": "running"}
    try:
        p = subprocess.run([CODEX_BIN, "exec", prompt], cwd=workdir,
                            capture_output=True, text=True,
                            timeout=WORKER_TIMEOUT)
        if p.returncode == 0:
            out = (p.stdout or "").strip()
            if len(out) > WORKER_OUTPUT_CAP:       # bound the state file size
                out = out[:WORKER_OUTPUT_CAP] + "\n…[truncated]"
            rec.update(status="done", output=out, returncode=0)
        else:
            rec.update(status="error", returncode=p.returncode,
                       error=(p.stderr or p.stdout or "").strip()[:500])
    except subprocess.TimeoutExpired:
        rec.update(status="error", error=f"worker timeout "
                   f"({WORKER_TIMEOUT}s)", incomplete_reason="worker timeout")
    except Exception as e:
        rec.update(status="error", error=f"{type(e).__name__}: {e}")
    return rec


def cmd_run(a) -> dict:
    team_id = a.team
    if (not team_id or "/" in team_id or "\\" in team_id
            or team_id in (".", "..") or team_id.startswith("-")
            or team_id.strip() != team_id):
        return _envelope("error", source="run", error="invalid team id")
    run_dir = _team_base() / team_id
    state_path = run_dir / "team_state.json"
    lock = _Lock(run_dir / "team.lock")

    # flock IS the source of truth. The kernel auto-releases it when the
    # holder process dies, so: non-blocking LOCK_EX failure ⇒ a *live*
    # orchestrator owns this team → blocked, no respawn. Success ⇒ the team
    # was free OR a prior holder crashed (flock auto-released) — the crash
    # case is then handled idempotently by the finalized/prior-done state
    # check below (done workers are not re-run). No racy lock-file content
    # read is involved (independent-review BLOCKER).
    if not lock.acquire(exclusive=True, blocking=False):
        return _envelope("blocked", source=str(run_dir),
                         error="team is owned by a live orchestrator; "
                               "not respawning",
                         orchestrator_error="team locked by live orchestrator")
    try:
        state = _read_state(state_path)
        if state.get("finalized"):
            # already done — idempotent: never re-spawn a finalized team.
            return _envelope("ok", data=state, source=str(state_path),
                             warnings=["team already finalized; returning "
                                       "prior result (no respawn)"])
        ok, info = _healthcheck()
        if not ok:
            # orchestration layer is down → blocked, and it is an
            # ORCHESTRATOR error, not a task error.
            state = {"team_id": team_id, "finalized": False,
                     "workers": [], "results": []}
            _write_state(state_path, state)
            return _envelope("blocked", source=str(run_dir),
                             error="codex exec unavailable; Agent-Teams "
                                   "equivalent cannot run",
                             orchestrator_error=f"healthcheck failed: {info}")

        try:
            tasks_raw = (sys.stdin.read() if a.tasks == "-"
                         else Path(a.tasks).read_text(encoding="utf-8"))
            tasks = json.loads(tasks_raw)
            assert isinstance(tasks, list) and tasks
        except Exception as e:
            return _envelope("error", source="tasks",
                             error=f"bad tasks spec: {type(e).__name__}: {e}")

        prior = {r["id"]: r for r in state.get("results", [])
                 if r.get("status") == "done"}
        workers, results = [], []
        for t in tasks:
            wid = str(t.get("id") or f"w{len(workers)+1}")
            if wid in prior:                       # idempotent skip-done
                results.append(prior[wid])
                workers.append({"id": wid, "workdir": prior[wid].get("workdir"),
                                "thread": prior[wid].get("thread"),
                                "status": "done"})
                continue
            w = {"id": wid, "prompt": str(t.get("prompt", "")),
                 "workdir": t.get("workdir"), "thread": t.get("thread")}
            # checkpoint queued state under lock before running
            workers.append({"id": wid, "workdir": w["workdir"],
                            "thread": w["thread"], "status": "queued"})
            state = {"team_id": team_id, "finalized": False,
                     "workers": workers, "results": results}
            _write_state(state_path, state)
            rec = _run_worker(w)
            results.append(rec)
            workers[-1]["status"] = rec["status"]
            state = {"team_id": team_id, "finalized": False,
                     "workers": workers, "results": results}
            _write_state(state_path, state)        # checkpoint each worker

        # ONLY the orchestrator finalizes (workers never do).
        failed = [r for r in results if r.get("status") != "done"]
        state = {"team_id": team_id, "finalized": True,
                 "workers": workers, "results": results}
        _write_state(state_path, state)
        if not failed:
            return _envelope("ok", data=state, source=str(state_path))
        if len(failed) == len(results):
            return _envelope("error", data=state, source=str(state_path),
                             error=f"all {len(failed)} workers failed")
        # surface a worker-level timeout explicitly (contract timeout-edge:
        # a timed-out unit → partial + incomplete_reason, never silent).
        timed_out = any(r.get("incomplete_reason") == "worker timeout"
                        for r in failed)
        inc = ("worker timeout (partial)" if timed_out
               else "some workers failed")
        return _envelope("partial", data=state, source=str(state_path),
                         warnings=[f"{len(failed)}/{len(results)} workers failed"],
                         incomplete_reason=inc)
    finally:
        lock.release()


def cmd_status(a) -> dict:
    # Lock-free read: _write_state uses temp-write + os.replace, which is
    # atomic, so a reader always sees a COMPLETE old-or-new state file,
    # never a torn one. Not taking the lock means `status` is NOT blocked
    # for the (possibly 30-min) duration a run holds the exclusive lock
    # (independent-review P1).
    state_path = _team_base() / a.team / "team_state.json"
    st = _read_state(state_path)
    if not st:
        return _envelope("error", source=str(state_path),
                         error="no such team / no state")
    return _envelope("ok", data=st, source=str(state_path))


_CMDS = {"run": cmd_run, "status": cmd_status}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="codex_worker_orchestrator")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--team", required=True)
    r.add_argument("--tasks", required=True,
                   help="path to a JSON file of [{id,prompt,workdir?}], or - for stdin")
    s = sub.add_parser("status")
    s.add_argument("--team", required=True)
    try:
        a = ap.parse_args(argv)
    except SystemExit as se:
        if se.code in (0, None):
            raise
        return _emit(_envelope("error", source="args",
                               error="invalid arguments"))
    try:
        return _emit(_CMDS[a.cmd](a))
    except Exception as e:                          # never a silent crash
        return _emit(_envelope("error", source=a.cmd,
                               error=f"{type(e).__name__}: {e}",
                               orchestrator_error=f"{type(e).__name__}: {e}"))


if __name__ == "__main__":
    sys.exit(main())
