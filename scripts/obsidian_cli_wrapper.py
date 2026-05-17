#!/usr/bin/env python3
"""obsidian_cli_wrapper.py — the Codex equivalent of Claude Code's
`mcp__obsidian__*` tools (tool-equivalence-contract.md §"Obsidian CLI
wrapper" / §"Obsidian write contract").

Why this exists: a KM skill body invariant calls Obsidian operations. On
Claude Code those are MCP tools; on Codex the per-skill
`references/codex-adapter.md` routes them here. The KM SKILL.md stays
unchanged — only the adapter names this wrapper.

Every command prints ONE common result envelope (contract §"Common result
envelope") to stdout so the adapter parses JSON, not text:

  {status, data, warnings[], source, error, orchestrator_error,
   incomplete_reason, audit_id}

Commands (the documented minimal set): read create append search backlinks
tags properties.

Tiering (vault-ops 3-Tier spirit): obsidian-cli is preferred for the
graph/metadata reads (search/backlinks/tags) when available; file IO
(read/create/append/properties) is done directly so the write contract
(atomic + frontmatter-preserving + deterministic dedupe + no vault escape)
is enforced precisely. If obsidian-cli is absent the graph reads degrade to
a ripgrep/scan fallback and the envelope says so in `warnings` /
`status:"partial"` — never a silent wrong answer.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ENVELOPE_KEYS = ("status", "data", "warnings", "source", "error",
                 "orchestrator_error", "incomplete_reason", "audit_id")


def _envelope(status, data=None, warnings=None, source="", error=None,
              incomplete_reason=None):
    return {
        "status": status,                       # ok|partial|error|blocked
        "data": data,
        "warnings": warnings or [],
        "source": source,
        "error": error,
        # this wrapper is not an orchestrator; kept for envelope uniformity
        "orchestrator_error": None,
        "incomplete_reason": incomplete_reason,
        "audit_id": uuid.uuid4().hex,
    }


def _emit(env: dict) -> int:
    print(json.dumps(env, ensure_ascii=False))
    return {"ok": 0, "partial": 0, "error": 1, "blocked": 2}.get(env["status"], 1)


# ── vault root & path safety ────────────────────────────────────────────────
def _vault_root() -> Path | None:
    """Precedence (generic distributable — never hardcode a user vault):
    THISCODEX_VAULT → CLAUDE_DISCODE_VAULT → ~/.thiscode-config (yaml
    `vault_root:`). None → caller emits a blocked envelope."""
    for env in ("THISCODEX_VAULT", "CLAUDE_DISCODE_VAULT"):
        v = os.environ.get(env)
        if v and Path(v).expanduser().is_dir():
            return Path(v).expanduser().resolve()
    cfg = Path.home() / ".thiscode-config"
    if cfg.is_file():
        for line in cfg.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"\s*vault_root\s*:\s*(.+?)\s*$", line)
            if m:
                p = Path(m.group(1).strip().strip('"\'')).expanduser()
                if p.is_dir():
                    return p.resolve()
    return None


def _resolve(vault: Path, relpath: str) -> Path:
    """Vault-root-anchored + normalized. Rejects absolute, `~`, Windows
    drive/UNC/backslash forms, and any `..`/symlink traversal that escapes
    the vault root, and the vault root itself (a note path must be strictly
    inside). `resolve()` follows symlinks, so an in-vault symlink pointing
    out is also caught by the containment check (contract §write)."""
    if not relpath or relpath.strip() in ("", "/", "."):
        raise ValueError("empty/root path")
    rp = relpath.strip()
    if "\\" in rp or re.match(r"^[A-Za-z]:", rp) or rp.startswith(("//", "\\\\")):
        raise ValueError("Windows/UNC paths rejected; use a POSIX vault-relative path")
    if os.path.isabs(rp) or rp.startswith("~"):
        raise ValueError("absolute paths are rejected; use a vault-relative path")
    target = (vault / rp).resolve()
    if target == vault:
        raise ValueError("path resolves to the vault root, not a note")
    try:
        target.relative_to(vault)              # containment on real paths
    except ValueError:
        raise ValueError("path escapes the vault root")
    return target


# ── frontmatter (CRLF-aware, exact-fence line-based) ────────────────────────
def _split_frontmatter(text: str) -> tuple[str, str]:
    """Return (frontmatter_block_incl_fences_or_empty, body). Frontmatter
    only if the FIRST line is exactly `---` (trailing CR allowed) AND a
    later line is exactly `---`; the first such closing fence ends it. No
    closing fence → it is NOT frontmatter (whole text is body — never
    eat the body), so an opening horizontal-rule is not misclassified."""
    nl = text.find("\n")
    if nl == -1 or text[:nl].rstrip("\r") != "---":
        return "", text
    rest_start = nl + 1
    for m in re.finditer(r"(?m)^---[ \t]*\r?$", text[rest_start:]):
        end = rest_start + m.end()
        if text[end:end + 2] == "\r\n":
            end += 2
        elif end < len(text) and text[end] == "\n":
            end += 1
        return text[:end], text[end:]
    return "", text


def _fm_tags(fm_block: str) -> list[str]:
    """Extract frontmatter `tags` supporting all three YAML shapes (stdlib
    has no yaml): inline flow `[a, b]`, scalar `a, b`, and block list
    (`tags:` then indented `- a`). Scalar-only regex missed block lists
    (independent-review P1)."""
    if not fm_block:
        return []
    lines = [ln.rstrip("\r") for ln in fm_block.splitlines()]
    inner = lines[1:-1] if len(lines) >= 2 and lines[-1] == "---" else lines[1:]
    out: list[str] = []
    i = 0
    while i < len(inner):
        m = re.match(r"\s*tags\s*:\s*(.*)$", inner[i])
        if not m:
            i += 1
            continue
        v = m.group(1).strip()
        if v:
            if v.startswith("[") and v.endswith("]"):
                v = v[1:-1]
            out += [t.strip().strip("'\"") for t in re.split(r"[,\s]+", v)
                    if t.strip()]
        j = i + 1
        while j < len(inner):
            lm = re.match(r"\s*-\s+(.+?)\s*$", inner[j])
            if not lm:
                break
            out.append(lm.group(1).strip().strip("'\""))
            j += 1
        i = max(j, i + 1)
    return [t for t in out if t]


def _parse_props(fm_block: str) -> dict:
    props: dict = {}
    if not fm_block:
        return props
    lines = fm_block.splitlines()
    inner = lines[1:-1] if len(lines) >= 2 and lines[-1].rstrip("\r") == "---" \
        else lines[1:]
    for line in inner:
        m = re.match(r"\s*([A-Za-z0-9_\-]+)\s*:\s*(.*?)\s*$", line.rstrip("\r"))
        if m:
            props[m.group(1)] = m.group(2)
    return props


class _suppress:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return True


def _fsync_dir(d: Path) -> None:
    try:
        fd = os.open(str(d), os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except (OSError, AttributeError):
        pass                                    # best-effort (e.g. non-POSIX)


# ── atomic write (overwrite — for append's intentional rewrite) ─────────────
def _atomic_write(target: Path, content: str) -> None:
    """temp-write in the same dir then os.replace (atomic, same fs). On any
    failure the temp is removed and the original (if any) is untouched."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f".{target.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
        _fsync_dir(target.parent)
    except Exception:
        with _suppress():
            tmp.unlink()
        raise


def _atomic_create(target: Path, content: str) -> Path:
    """Atomic NO-CLOBBER create with a deterministic, collision-free counter
    (contract §write). O_CREAT|O_EXCL makes name selection atomic, so two
    concurrent KM runs cannot both grab `name_1.md` and silently lose one
    write — the loser deterministically bumps to the next free counter."""
    target.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode("utf-8")
    stem, suf = target.stem, target.suffix
    i = 0
    while True:
        cand = target if i == 0 else target.with_name(f"{stem}_{i}{suf}")
        try:
            fd = os.open(cand, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            i += 1
            continue
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            _fsync_dir(cand.parent)
            return cand
        except Exception:
            with _suppress():
                cand.unlink()
            raise


# ── obsidian-cli discovery (optional Tier-1) ────────────────────────────────
def _obsidian_cli() -> str | None:
    """Return the obsidian-cli binary ONLY when it can be bound to the SAME
    vault this wrapper resolves. obsidian-cli operates on Obsidian's
    app-registered vaults *by name*, not on an arbitrary filesystem path —
    invoking it without binding the vault name risks silently
    searching/answering from a DIFFERENT vault than the one we read/write
    (a correctness hazard, not just degraded). So require an explicit
    `THISCODEX_OBSIDIAN_VAULT_NAME`; absent it we use the deterministic,
    path-scoped filesystem fallback instead (honest `partial`)."""
    if not os.environ.get("THISCODEX_OBSIDIAN_VAULT_NAME"):
        return None
    envp = os.environ.get("THISCODEX_OBSIDIAN_CLI")
    if envp and Path(envp).exists():
        return envp
    found = shutil.which("obsidian-cli")
    if found:
        return found
    for c in ("/Applications/Obsidian.app/Contents/MacOS/obsidian-cli",
              "/mnt/c/Program Files/Obsidian/Obsidian.com"):
        if Path(c).exists():
            return c
    return None


def _cli_base() -> list[str]:
    """obsidian-cli is key=value, vault bound by name (verified syntax,
    2026-05-16)."""
    name = os.environ.get("THISCODEX_OBSIDIAN_VAULT_NAME", "")
    return [f"vault={name}"] if name else []


def _run_cli(args: list[str], cwd: Path) -> tuple[int, str, str]:
    try:
        p = subprocess.run(args, cwd=str(cwd), capture_output=True,
                            text=True, timeout=60)
        return p.returncode, p.stdout, p.stderr
    except Exception as e:
        # 126 (not 1) so a launch/timeout failure is never mistaken for
        # grep/rg's rc=1 "no match" (independent-review P1).
        return 126, "", f"{type(e).__name__}: {e}"


def _cli_ok(rc: int, out: str) -> bool:
    """obsidian-cli prints usage/error to stdout with rc 0 in some builds —
    rc alone is not trustworthy (surfaced in functional testing)."""
    s = out.strip()
    return rc == 0 and bool(s) and not s.lstrip().startswith(("Error:", "Usage:"))


# ── commands ────────────────────────────────────────────────────────────────
def cmd_read(vault, a):
    t = _resolve(vault, a.path)
    if not t.is_file():
        return _envelope("error", source=str(t), error="not found")
    text = t.read_text(encoding="utf-8", errors="replace")
    fm, body = _split_frontmatter(text)
    return _envelope("ok", data={"path": a.path, "frontmatter": _parse_props(fm),
                                 "body": body, "raw": text}, source=str(t))


def _read_content(a) -> str:
    if a.content is not None:
        return a.content
    if a.stdin:
        return sys.stdin.read()
    return ""


def cmd_create(vault, a):
    t = _resolve(vault, a.path)
    if t.suffix != ".md":
        t = t.with_suffix(".md")
    try:
        t.relative_to(vault)                       # re-check after suffix swap
    except ValueError:
        return _envelope("error", source=str(t), error="path escapes the vault root")
    content = _read_content(a)
    # caller-supplied frontmatter is written verbatim (never clobbered);
    # atomic no-clobber create assigns a collision-free counter under races.
    final = _atomic_create(t, content)
    warnings = []
    if final != t:
        warnings.append(f"target existed; wrote to {final.name} (no overwrite)")
    return _envelope("ok",
                     data={"path": str(final.relative_to(vault)),
                           "bytes": len(content.encode())},
                     warnings=warnings, source=str(final))


def cmd_append(vault, a):
    t = _resolve(vault, a.path)
    add = _read_content(a)
    if not t.is_file():
        # append to a missing note = atomic no-clobber create
        final = _atomic_create(t, add)
        return _envelope("ok", data={"path": str(final.relative_to(vault)),
                                     "created": True,
                                     "appended_bytes": len(add.encode())},
                         warnings=["target did not exist; created"],
                         source=str(final))
    raw = t.read_bytes()
    try:
        orig = raw.decode("utf-8")                  # strict — no silent loss
    except UnicodeDecodeError:
        return _envelope("error", source=str(t),
                         error="note is not valid UTF-8; refusing to rewrite "
                               "(no silent corruption)")
    fm, body = _split_frontmatter(orig)            # FM preserved untouched
    sep = "" if body.endswith("\n") or not body else "\n"
    new = fm + body + sep + add
    # per-process unique backup name so concurrent appends don't share/clobber
    bak = t.with_name(f".{t.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.bak")
    try:
        shutil.copy2(t, bak)                       # rollback point
        _atomic_write(t, new)
    except Exception as e:
        if bak.exists():
            with _suppress():
                shutil.copy2(bak, t)               # restore
        return _envelope("error", source=str(t), error=f"{type(e).__name__}: {e}")
    finally:
        if bak.exists():
            with _suppress():
                bak.unlink()
    return _envelope("ok", data={"path": a.path, "appended_bytes": len(add.encode()),
                                 "frontmatter_preserved": bool(fm)}, source=str(t))


def cmd_properties(vault, a):
    t = _resolve(vault, a.path)
    if not t.is_file():
        return _envelope("error", source=str(t), error="not found")
    fm, _ = _split_frontmatter(t.read_text(encoding="utf-8", errors="replace"))
    return _envelope("ok", data={"path": a.path, "properties": _parse_props(fm)},
                     source=str(t))


def _cli_attempt(sub_args: list[str], vault: Path) -> tuple[str, str]:
    """Try obsidian-cli. Returns ('ok', stdout) on success, else a
    (reason, detail) where reason distinguishes 'obsidian-cli not bound' /
    'obsidian-cli error' / 'obsidian-cli timeout' — never collapse all
    degradation into one misleading message (independent-review P1)."""
    cli = _obsidian_cli()
    if not cli:
        return ("obsidian-cli not bound",
                "obsidian-cli not bound (set THISCODEX_OBSIDIAN_VAULT_NAME to "
                "the registered vault name to enable it)")
    rc, out, err = _run_cli([cli] + sub_args + _cli_base(), vault)
    if _cli_ok(rc, out):
        return ("ok", out.strip())
    detail = ((err or out).strip() or "no output")[:200]
    reason = ("obsidian-cli timeout" if "TimeoutExpired" in detail
              else "obsidian-cli error")
    return (reason, f"{reason}: rc={rc} {detail}")


def cmd_search(vault, a):
    st, res = _cli_attempt(["search", f"query={a.query}", "format=json"], vault)
    if st == "ok":
        return _envelope("ok", data={"query": a.query, "raw": res},
                         source="obsidian-cli search")
    # fixed-string (-F) + `--` so a query like `-rf` or `.*` is data, not a
    # regex/flag (independent-review P1). rg/grep rc: 0=hits 1=none >1=error.
    tool = shutil.which("rg")
    cmd = ([tool, "-l", "-i", "-F", "--glob", "*.md", "--", a.query, str(vault)]
           if tool else
           ["grep", "-rliF", "--include=*.md", "--", a.query, str(vault)])
    rc, out, err = _run_cli(cmd, vault)
    warns = [res, "ripgrep/grep fixed-string filename fallback (no rank/snippet)"]
    inc = st
    if rc not in (0, 1):                          # surface a real tool error
        warns.append(f"search tool rc={rc}: {(err or out).strip()[:200]}")
        inc = f"{st}; search-tool error rc={rc}"
    hits = [str(Path(p).relative_to(vault)) for p in out.split("\n")
            if p.strip() and Path(p).is_file()]
    return _envelope("partial", data={"query": a.query, "files": hits},
                     warnings=warns, source="search-fallback",
                     incomplete_reason=inc)


def cmd_backlinks(vault, a):
    t = _resolve(vault, a.path)
    st, res = _cli_attempt(["backlinks", f"path={a.path}", "format=json"], vault)
    if st == "ok":
        return _envelope("ok", data={"path": a.path, "raw": res},
                         source="obsidian-cli backlinks")
    stem = Path(a.path).stem
    pat = re.compile(r"\[\[" + re.escape(stem) + r"(\||\]\]|#)")
    refs = []
    for md in vault.rglob("*.md"):
        try:
            if pat.search(md.read_text(encoding="utf-8", errors="replace")):
                refs.append(str(md.relative_to(vault)))
        except Exception:
            continue
    return _envelope("partial", data={"path": a.path, "backlinks": refs},
                     warnings=[res, "wikilink scan fallback "
                               "(alias links may be missed)"],
                     source="backlinks-fallback", incomplete_reason=st)


def cmd_tags(vault, a):
    if not a.path:
        st, res = _cli_attempt(["tags"], vault)
        if st == "ok":
            return _envelope("ok", data={"raw": res}, source="obsidian-cli tags")
    else:
        # per-file tags are not in obsidian-cli's surface — scan, by design
        st = "path-scoped (per-file tags not in obsidian-cli surface)"
        res = st
    if a.path:
        t = _resolve(vault, a.path)
        if not t.is_file():                       # parity with read/properties
            return _envelope("error", source=str(t), error="not found")
        files = [t]
    else:
        files = list(vault.rglob("*.md"))
    tags: dict[str, int] = {}
    for md in files:
        try:
            txt = md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        fm, body = _split_frontmatter(txt)
        for tg in _fm_tags(fm):                    # inline/scalar/block list
            tags[tg] = tags.get(tg, 0) + 1
        for tg in re.findall(r"(?:^|\s)#([A-Za-z0-9_\-/]+)", body):
            tags[tg] = tags.get(tg, 0) + 1
    return _envelope("partial", data={"tags": tags},
                     warnings=[res, "frontmatter+#inline scan fallback"],
                     source="tags-fallback", incomplete_reason=st)


_CMDS = {"read": cmd_read, "create": cmd_create, "append": cmd_append,
         "properties": cmd_properties, "search": cmd_search,
         "backlinks": cmd_backlinks, "tags": cmd_tags}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="obsidian_cli_wrapper",
        epilog="Pass user-controlled values after `--` so a value starting "
               "with `-` is data, not a flag (the stage-4 KM adapter always "
               "does this): e.g. `search -- '-rf'`.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("read", "properties", "backlinks"):
        s = sub.add_parser(name)
        s.add_argument("path")
    for name in ("create", "append"):
        s = sub.add_parser(name)
        s.add_argument("path")
        s.add_argument("--content", default=None)
        s.add_argument("--stdin", action="store_true")
    s = sub.add_parser("search")
    s.add_argument("query")
    s = sub.add_parser("tags")
    s.add_argument("path", nargs="?", default=None)

    try:
        a = ap.parse_args(argv)
    except SystemExit as se:
        # argparse exits the process on bad args / -h; the contract says
        # every invocation returns the envelope (independent-review BLOCKER).
        if se.code in (0, None):                    # -h/--help: legit exit
            raise
        return _emit(_envelope("error", source="args",
                               error="invalid arguments"))
    vault = _vault_root()
    if vault is None:
        return _emit(_envelope(
            "blocked", source="vault-root",
            error="vault root not set — export THISCODEX_VAULT or "
                  "CLAUDE_DISCODE_VAULT, or set vault_root in ~/.thiscode-config"))
    try:
        return _emit(_CMDS[a.cmd](vault, a))
    except ValueError as e:                         # path-safety / bad input
        return _emit(_envelope("error", source=getattr(a, "path", a.cmd),
                               error=str(e)))
    except Exception as e:                          # never a silent crash
        return _emit(_envelope("error", source=a.cmd,
                               error=f"{type(e).__name__}: {e}"))


if __name__ == "__main__":
    sys.exit(main())
