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

Dispatch rules:

- `/test` runs all lightweight features except `graphrag-bench`.
- `/test <natural language>` fuzzy-matches one feature and runs only that smoke.
- `/test graphrag-bench`, `/test --bench`, or `/test all` includes the benchmark entry.

The harness prints compact per-feature `PASS`, `FAIL`, or `SKIP` rows plus a summary. Missing optional dependencies are `SKIP`; broken shipped files or syntax errors are `FAIL`.
