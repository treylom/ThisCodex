# GraphRAG Operations Runbook (model-independent)

> Day-2 operations for the vault GraphRAG search stack: routine checks, code
> change procedure, incident response. Install/setup ships with the ThisCode
> companion (`docs/06-graphrag-setup.md` there); Codex bots are *consumers* of
> the same search server, and may also be its operator. Bot-side search
> *usage* discipline: [rules/search-usage.md](../rules/search-usage.md); tool
> *selection*: [rules/knowledge-retrieval.md](../rules/knowledge-retrieval.md).
>
> **Principle 1**: every command here must be copy-paste runnable.
> **Principle 2 (model-independence contract)**: a new operator model must be
> able to onboard from this doc + the design record alone. If that fails, the
> fix is to improve the doc — not to bridge the gap from memory.
> **Principle 3**: any system change updates this doc and search-usage.md's
> latency envelope *in the same change* (a stale instruction silently
> mis-routes every bot).

## 0. One-page system summary

vault (md notes) → **extractor** (wikilink/tag rules → concepts + relations)
→ **graph DB** (SQLite) + **embedding index** → **search server** (:8400,
hybrid channels + reranker) → bots' search skill/MCP.

| Component | Default path | Healthy signal |
|---|---|---|
| Root | `<vault>/.team-os/graphrag/` | — |
| Index | `index/` (db · npy · entity_meta.json) | db in the 100s of MB · meta ~MB |
| venv | `.venv/` | **all python runs via `.venv/bin/python3`** (system python lacks deps → *fake failures*) |
| Server | `http://localhost:8400` | `/health` 200 |

## 1. Schedulers (separation of roles is the point)

| job | role | cadence |
|---|---|---|
| server | search server, always-on | KeepAlive / service |
| incremental | catch-up on note changes — leaves a dense re-embedding *request* for the worker instead of embedding in-process | 30 min (≤10 min caused server-blocking regressions) |
| embedding-worker | dense note embeddings in a separate CPU process — staging → verify → promote → activate generation dirs, so embedding never wedges the server GPU | 5 min tick (no-op when no request) |
| rebuild | full build (communities, centrality) | nightly |
| monitor | external health watch (latency breach → push alert) | periodic |

> **Why the worker split** (2026-07, live incident): in-process re-embedding
> held the GPU (Metal/MPS) and wedged search itself for hundreds of seconds.
> `embedding_worker.py` (shipped in the ThisCode companion,
> `vendor/graphrag/scripts/`) builds indexes in separate generation dirs and
> the server only reloads; daily-build hygiene (log rotation, sync_log
> pruning, stale-file report) is `graphrag_maintenance.py`.

macOS = launchd (`launchctl bootout` / `bootstrap` is the reversible
stop/start pair); Linux/WSL = systemd timers, same shape.
▶ Fill in: your four job labels.

## 2. Daily 1-minute check

```bash
curl -s -o /dev/null -w "ready=%{http_code} t=%{time_total}s\n" http://localhost:8400/ready
ls -la index/                          # sizes outside §0 healthy band → §4.3
tail -5 <incremental log>              # "Up to date" or a small added/modified count
sqlite3 "file:index/<db>?mode=ro" "SELECT COUNT(*) FROM entities WHERE length(name)>10000;"  # must be 0
```
▶ Fill in: measured latency envelope (e.g. ready ~2ms · warm 0.2s · cold 1.5s · post-restart warmup ~25s).

## 3. Code change procedure (fixed order)

1. edit `scripts/` → 2. **full tests** `.venv/bin/python3 -m unittest discover
-s scripts -p "test_*.py"` (all green — never system python) → 3. restart
server → 4. §2 check + one real search → 5. benchmark regression (§5) →
6. update this doc + search-usage.md envelopes.

> ⚠️ **Why step 3 must not be skipped** (2026-07, live incident): the server
> imports script modules (e.g. `incremental`) at startup and **holds them in
> memory**. Edit the file without a restart and the CLI path runs new code
> while the server path (`POST /api/index/update`) silently runs the old —
> "fixed but not fixed", indefinitely. Server restart always precedes
> scheduler resume.

## 4. Incidents (symptom → diagnose → treat)

### 4.1 Server unresponsive / OOM-killed
- Diagnose: scheduler's last exit code + server RSS (healthy ~100s MB; GB+ → suspect §4.3).
- Treat: restart server → wait through warmup → §2 check.

### 4.2 Searches frequently fall back to 2nd-tier
- Diagnose: "server not ready" ratio in logs. Known cause: incremental update blocking the server.
- Treat: confirm the no-change-skip + async-reload patch is live; relax incremental cadence (§1).

### 4.3 🚨 DB/note bloat — self-output re-consumption (escape-doubling) class
- **Symptom**: GB-scale db / 100s-MB meta / a single note tens of MB / server RSS blow-up.
- **Mechanism (real incident, 2026-06)**: the extractor re-consumed a
  *system-output* frontmatter field as input → yaml re-escaping compounded
  every build → geometric growth (~3×/day). The essential fix is **blocking
  any path where automation eats its own output** (code guards: frontmatter
  strip + entity-name length/newline reject + sync sanitize + regression tests).
- **Treatment** (backup → stop → purge → verify; every step reversible):
  ```bash
  # 1) stop builds + backup
  #    (launchctl bootout / systemctl stop for <rebuild> and <incremental>)
  mkdir -p ~/quarantine-$(date +%F) && cp index/<db> index/entity_meta.json ~/quarantine-$(date +%F)/
  # 2) identify + delete contaminated rows (server stopped)
  sqlite3 index/<db> "SELECT id,length(name) FROM entities WHERE length(name)>10000;"
  #    → DELETE those ids from entities/relationships/FTS, then: PRAGMA optimize; VACUUM;
  # 3) contaminated notes: stream-scan for the frontmatter terminator '\n---\n',
  #    extract and restore the body only
  # 4) restart server → §2 check → resume builds
  ```

### 4.4 Index staleness (new notes not searchable)
- Diagnose: incremental log's last run time + scheduler registration.
- Treat: re-register per §1; run the manual one-shot update script to catch up.

## 5. Benchmarks

- Keep ONE canonical harness (retrieval hit@k/MRR + answer-quality axes).
- ⚠ **Numbers measured on a contaminated DB are not a baseline** — after a
  purge or structural change, re-measure and reset the baseline.
- Record every experiment honestly as KEEP/DISCARD — failed runs are assets.

## 6. Operator (model) handover

Onboarding inputs = ① this doc ② the design record (why it's built this way —
channel weights, deliberate deferral of LLM extraction, the two-layer
frontmatter rule, the incident postmortem) ③ the latest meeting/change log.
If those three don't suffice, improve this doc.

## 7. Reaching the search server from a Codex sandbox (two traps)

Codex sessions default to a `read-only` sandbox that **blocks even localhost
HTTP** (curl exit 7). To reach `:8400`:

```bash
# per-command
codex exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true ...
```

```toml
# persistent — $CODEX_HOME/config.toml (applies after restart; 1:1 with CLI -c)
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

- ⚠ `network_access` is **ignored under `read-only`** — it must pair with
  workspace-write or above.
- ⚠ `network_access = true` opens external networking too — enable
  persistently only for trusted always-on bots; otherwise prefer per-command.
- Result JSON identifies documents by `entity` / `source_note` /
  `description` — there is **no `title` field** (a naive `.results[].title`
  yields null):
  `curl -s "http://127.0.0.1:8400/api/search?q=<query>&top_k=5" | jq -r '.results[] | "\(.entity)\t\(.source_note)"'`
- Machine boundary: a bot on another machine cannot reach this host's :8400 —
  point it at that machine's own server instance.

## 8. Relabeling generic relations (relabel toolkit)

When most graph edges are generic `related_to`, the reclassification pipeline
in the ThisCode companion (`vendor/graphrag/relabel/README-method.md`) assigns
semantic types (parent / cites / precedes …): random-sample pilot → full run →
low-confidence second pass → merge (incremental stopped) → preservation guard.
The guard that keeps incremental re-extraction from reverting semantic labels
is already built into `incremental.py` (pair it with the §3 restart rule).
