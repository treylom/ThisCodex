# Codex app-server bridge pattern: materialize before TUI attach

This document records the Codex 0.132+ bridge rule for persistent Discord bots:
after a fresh `thread/start`, force the rollout JSONL onto disk before writing
`.codex-thread-id` or opening the operator TUI with `codex resume <id> --remote`.

## Source facts

Checked against `openai/codex` main commit
`0b4f86095c8005d8f74e9c62b971d72c1670aa88` on 2026-05-21.

- `codex-rs/app-server/tests/suite/v2/thread_start.rs` lines 148-152:
  fresh persistent threads expose an absolute path, and the test asserts that
  the rollout file does not exist yet.
  <https://github.com/openai/codex/blob/0b4f86095c8005d8f74e9c62b971d72c1670aa88/codex-rs/app-server/tests/suite/v2/thread_start.rs#L148-L152>
- `codex-rs/app-server/tests/suite/v2/thread_resume.rs` lines 163-181:
  resuming before the first user-message write is expected to fail with a
  missing-rollout error.
  <https://github.com/openai/codex/blob/0b4f86095c8005d8f74e9c62b971d72c1670aa88/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L163-L181>
- `codex-rs/rollout/src/recorder.rs` lines 641-646 and 1479-1508:
  new sessions precompute rollout metadata, then open the file only when the
  writer is forced to write pending items.
  <https://github.com/openai/codex/blob/0b4f86095c8005d8f74e9c62b971d72c1670aa88/codex-rs/rollout/src/recorder.rs#L641-L646>
  <https://github.com/openai/codex/blob/0b4f86095c8005d8f74e9c62b971d72c1670aa88/codex-rs/rollout/src/recorder.rs#L1479-L1508>

The tests are the best upstream source currently found for this behavior. No
separate public protocol document was found that contradicts them.

## Failure mode

`thread/start` can return a valid thread id and rollout path while the rollout
file is still absent. A bridge that immediately writes `.codex-thread-id` lets
`scripts/launch.sh` or a human run `codex resume <id> --remote` against a thread
that has no JSONL on disk. The result is a retry loop or an attach failure, even
though the app-server thread itself exists.

This is especially easy to hit in a two-window tmux bot:

1. window `infra` starts `codex app-server` and the Python bridge;
2. the bridge calls `thread/start`;
3. window `codex` waits for `.codex-thread-id`, then waits for the rollout file;
4. if the bridge never materializes the rollout, the TUI window waits until its
   rollout timeout and tells the operator to debug the bridge.

## Required bridge behavior

The bridge must write a harmless item to the thread immediately after a fresh
`thread/start` and before writing `.codex-thread-id`.

```python
async def materialize_thread_for_tui(self, thread_id: str) -> None:
    marker = {
        "type": "message",
        "role": "assistant",
        "content": [{
            "type": "output_text",
            "text": "[bridge:init] rollout materialized for local TUI attach. No action required.",
        }],
        "phase": None,
    }
    await self.call("thread/inject_items", {
        "threadId": thread_id,
        "items": [marker],
    })
```

Then:

```python
tid = res.get("threadId") or (res.get("thread") or {}).get("id")
await self.materialize_thread_for_tui(tid)
THREAD_ID_PATH.write_text(tid)
```

The reference implementation is `examples/bot.py`.

## Forward compatibility

This pattern relies on `thread/inject_items` remaining available. If a later
Codex release eagerly creates rollout files on `thread/start`, the injected
assistant marker is still safe: it is not user content, it carries no secrets,
and it makes the same-thread TUI attach invariant explicit. If a later release
removes or changes `thread/inject_items`, the bridge should fail loudly before
writing `.codex-thread-id`; it must not silently fall back to a fresh
`codex --remote` session.

## Verification

Use a fresh bot working directory and assert this sequence:

```text
before_exists=false
thread/start -> thread_id
thread/inject_items marker
after_materialized=true
.codex-thread-id written only after after_materialized=true
codex resume <thread_id> --remote attaches to the same thread
```

`thiscodex doctor --verbose` should fail if `.codex-thread-id` exists but no
matching `~/.codex/sessions/**/<thread-id>.jsonl` rollout exists.
