---
name: test
description: Use when running ThisCodex feature smoke tests through the /test dispatcher for memory, tmux, GraphRAG, meetings, rules, hooks, or installer behavior.
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
| Test a specific feature | `/test <feature name>` — fuzzy-matches one feature by name and runs that smoke test. Examples: `/test memory`, `/test meetings`, `/test graphrag`. |
| Include GraphRAG benchmark | `/test graphrag-bench`, `/test --bench`, or `/test all` — includes the heavyweight GraphRAG indexing benchmark (slower, full-scope). |
| View test output | Test harness prints one row per feature (`PASS`/`FAIL`/`SKIP`) plus a summary line. Missing optional dependencies show `SKIP`; broken shipped files or syntax errors show `FAIL`. Exit code 0 = all passed or skipped; non-zero = ≥1 failed. |
| Debug a failed test | Add `--verbose` flag for detailed logs: `/test --verbose` or `/test memory --verbose` for step-by-step output. |

The harness is idempotent — run it as many times as needed during development.
