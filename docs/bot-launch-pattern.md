# Bot launch pattern: one owner, visible restarts

Codex Discord bots need supervision, but the supervision must have one owner.
Layering a shell alias, `.zshrc` helper, tmux launcher, and service manager so
each one restarts the others creates stale sessions and infinite retry loops.

## Anti-pattern

Do not wrap the launcher in an outer loop such as:

```bash
while true; do
  ./launch.sh
  sleep 5
done
```

This looks resilient but causes three concrete failures:

- tests cannot stop the process cleanly;
- old tmux sessions can reconnect to stale `.codex-thread-id` values;
- a fast-failing `codex resume` path can loop forever and hide the root cause.

## Recommended operator model

Use manual restart for local development and debugging:

```bash
BOT_WD=/path/to/bot SESSION=mybot LAUNCH_CMD=/path/to/infra-launch.sh \
  ./scripts/launch.sh
```

If the bot stops, inspect the tmux panes and logs, then run the same command
again. This keeps the failed state visible long enough to debug it.

## Production supervision

`systemd --user` or `launchd` is acceptable when it owns exactly one launcher
command and does not add another hidden recovery loop around an already
supervised tmux session.

Use these rules:

- one owner is allowed to restart the bot;
- the launcher must expose an operator stop path such as `STOP_FILE`;
- fast repeated `codex resume` exits must become a loud fatal state, not a
  silent fresh-session fallback;
- service managers should call the same checked command that manual restart
  uses.

ThisCodex keeps the reference local runner in `scripts/launch.sh`. That script
waits for app-server readiness, waits for `.codex-thread-id`, waits for rollout
materialization, and then runs `codex resume <thread-id> --remote`. It does not
start a fresh remote-only session as a workaround.

## Trade-off table

| Mode | Strength | Risk | Use when |
|---|---|---|---|
| Manual restart | Failures stay visible; easiest to debug | Human must restart | local bot work, first install, incident response |
| tmux launcher | Stable operator panes; same-thread TUI attach | wrong wrapper can create nested loops | normal single-operator bot use |
| `systemd --user` | OS-level restart after host reboot | can hide crash loops if logs are ignored | Linux/WSL always-on bots |
| `launchd` | macOS-native scheduling | plist quoting and working-dir mistakes | Mac always-on bots after manual smoke passes |

The important decision is not "manual versus automatic" in isolation. The rule
is: automatic restart is acceptable only after the bridge has a verified
same-thread attach path and failures remain observable.

## New-bot persona bootstrapping (prompt-engineering pass)

When you stand up a NEW bot (writing its soul/persona file and workspace
docs for the first time), run a prompt-engineering pass before pasting raw
answers into templates: if a `/prompt`-style skill is installed, use its
batch mode to generate the persona/system prompt (role, vocabulary,
signature, working context) from your interview answers, then inject that
output into the templates. Without the skill, plain AI generation works —
installing one is recommended because agent-purpose detection applies
expert priming and structure automatically. This mirrors ThisCode's
create-bot Step 4.5, so bots born on either harness get the same treatment.
