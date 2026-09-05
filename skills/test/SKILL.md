---
name: test
description: Use when running ThisCodex feature smoke tests through the /test dispatcher for memory, tmux, the GraphRAG wrapper syntax smoke, meetings, rules, hooks, or installer behavior.
---

# /test

Use this skill for `/test` requests in ThisCodex.

Run the repository harness from the repo root:

```bash
node scripts/feature-test.mjs [query]
```

## Subcommands

Dispatch rules:

| When to use | Call |
|---|---|
| Run all lightweight smoke tests | `/test` — runs memory, tmux, meetings, rules, hooks, installer smoke tests (excludes GraphRAG benchmark). Each test prints `PASS`, `FAIL`, or `SKIP`. |
| Test a specific feature | `/test <feature name>` — fuzzy-matches one feature by name and runs that smoke test. Examples: `/test memory`, `/test meetings`, `/test graphrag` (bundled wrapper syntax smoke only; no live GraphRAG request). |
| Include GraphRAG benchmark | `/test graphrag-bench`, `/test --bench`, or `/test all` — preserves the benchmark-compatible command, but the shipped feature currently checks wrapper syntax/prerequisites only and does not run live GraphRAG indexing. |
| View test output | Test harness prints one row per feature (`PASS`/`FAIL`/`SKIP`) plus a summary line. Missing optional dependencies show `SKIP`; broken shipped files or syntax errors show `FAIL`. Exit code 0 = all passed or skipped; non-zero = ≥1 failed. |
| Debug a failed test | Add `--verbose` flag for detailed logs: `/test --verbose` or `/test memory --verbose` for step-by-step output. |

The harness is idempotent — run it as many times as needed during development.
