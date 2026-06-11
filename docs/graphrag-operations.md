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
| incremental | catch-up on note changes | 30 min (≤10 min caused server-blocking regressions) |
| rebuild | full build (communities, centrality) | nightly |
| monitor | external health watch (latency breach → push alert) | periodic |

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
