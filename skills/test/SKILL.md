---
name: test
description: Use when running ThisCodex feature smoke tests through the /test dispatcher for memory, tmux, meetings, rules, hooks, or installer behavior.
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
| Run all lightweight smoke tests | `/test` or `/test all` — runs memory, tmux, meetings, rules, hooks, and installer smoke tests. Each test prints `PASS`, `FAIL`, or `SKIP`. |
| Test a specific feature | `/test <feature name>` — fuzzy-matches one feature by name and runs that smoke test. Examples: `/test memory`, `/test meetings`. |
| View test output | Test harness prints one row per feature (`PASS`/`FAIL`/`SKIP`) plus a summary line. Missing optional dependencies show `SKIP`; broken shipped files or syntax errors show `FAIL`. Exit code 0 = all passed or skipped; non-zero = ≥1 failed. |

Vault search and storage are provided by the separate Knowledge Manager plugin
(`km-search` and `km-storage-abstraction`); this harness does not test those services.

The harness is idempotent — run it as many times as needed during development.
