# Guided Installer Design

This design turns the Track B requirements into an implementation architecture.
It is intentionally separate from Track A, which fixed concrete reinstall
regressions already merged to `master`.

## Goals

- Make `thiscodex init --apply` a real guided onboarding path.
- Keep `--non-interactive` as CI and diagnostic mode only.
- Treat WSL-to-Windows skill sync as a first-class setup step.
- Persist only user-confirmed paths and choices.
- Reuse `doctor` as the replay of the same verification gates used during
  install.

## Non-Goals

- Do not install system packages automatically beyond a one-line consent-gated
  user command.
- Do not start or supervise a daemon automatically in this phase.
- Do not weaken Track A rollout proof behavior.
- Do not make Windows sync destructive or delete unrelated Windows files.

## Architecture

The installer has five layers:

1. **Manifest**: declarative ordered steps.
2. **Runner**: evaluates `when`, prints the reason, runs action, runs verify,
   stops with `on_fail.next_command` when required.
3. **Prompt adapter**: turns manifest steps into concrete user-facing questions.
4. **State store**: persists only confirmed values and install logs.
5. **Doctor**: replays verify steps and reports status without inventing state.

The manifest remains data. The runner owns ordering and failure behavior. The
prompt adapter owns the user experience.

## State Model

State is split into detected values and confirmed values.

Detected values are runtime observations:

- current OS and WSL status;
- current repo root candidate;
- cwd candidate;
- Codex auth and config paths;
- tmux presence;
- Windows profile candidates.

Confirmed values are persisted:

- `confirmed_repo_root`
- `confirmed_workspace_root`
- `confirmed_bot_wd`
- `confirmed_state_dir`
- `confirmed_windows_profile`
- `confirmed_skill_layer`
- `confirmed_windows_skill_dir`

Detected values can be shown as defaults. They cannot be written as confirmed
values until the user chooses them, a CLI flag supplies them, or an answers file
supplies them.

## Guided Flow

### Phase 1: Placement Boundary

The first prompt explains the difference:

- skill placement copies the skill;
- guided onboarding configures the bot.

The user can choose placement-only or full onboarding. Placement-only must not
claim that the daemon or bot workspace is ready.

### Phase 2: Paths

The installer confirms:

1. repo root;
2. workspace or vault root;
3. bot working directory;
4. Discord state directory.

The state directory prompt must explain that this directory lives outside
`BOT_WD` so safe-mode Codex cannot rewrite its own privilege toggle or token
state.

### Phase 3: Skill Layer And Cross-OS Sync

The user chooses a Codex skill layer.

Under WSL, the installer then asks whether to sync the skill to a native Windows
profile. Candidate profiles are detected under `/mnt/c/Users`. Ambiguity is
resolved by user confirmation. Sync is idempotent and limited to the
`thiscodex` skill directory.

Verification checks that both WSL and Windows `SKILL.md` files exist and match
the source.

### Phase 4: Codex And Superpowers

The installer checks:

- Codex auth;
- `~/.codex/config.toml`;
- optional YOLO config ceiling, only by explicit opt-in;
- Codex-native superpowers availability.

If superpowers is unavailable, the installer prints the next command and stops
before prompt authoring.

### Phase 5: Prompt Flow

The installer routes the bundled prompt flow to draft:

- `AGENTS.md`
- `soul.md`
- `rules/`

Then it runs or directs the `/using-superpowers` interview. The interview is a
required gate for full guided onboarding because it shapes `AGENTS.md`,
`soul.md`, and `rules/`. If the interview cannot run or cannot be routed, the
guided flow stops before file generation and prints the next command.

The output must be stored as part of the install log so the user can inspect
what changed. Non-interactive mode never runs the interview; it only verifies
whether the required superpowers path is available and reports the next command
when it is not.

### Phase 6: Runner And Verification

The installer offers daemon runner file generation. Safe mode is the default.
YOLO remains explicit opt-in.

Verification includes:

- skill placement;
- config readability and optional ceiling;
- generated runner files;
- `.codex-thread-id` when a thread exists;
- rollout materialization when a thread exists;
- stale local wrappers;
- Windows sync when selected.

## Non-Interactive Behavior

In non-interactive mode:

- prompts do not ask readline questions;
- missing required confirmed values stop `--apply`;
- check mode prints next commands;
- no placeholder values are persisted;
- consent-gated steps show guidance but do not perform writes without consent.

This keeps CI useful without pretending CI completed guided onboarding.

## Doctor Behavior

`thiscodex doctor` reuses the install verify gates. It replays verification
against the current filesystem and environment; it does not synthesize state
from the install log.

Doctor verifies:

- skill placement;
- Codex config;
- confirmed path writability;
- `.codex-thread-id` when present;
- rollout materialization when a thread exists;
- Windows skill sync when selected;
- superpowers availability check status.

Rollout proof remains conditional:

- no thread id: skip with a reason;
- thread id and rollout file: pass;
- thread id without rollout file: fail.

This matches app-server readiness "if running" and avoids both false green and
CI-only false red.

## Error Handling

Every required failure prints:

- what failed;
- why it matters;
- the next command;
- whether the failure blocks guided onboarding or only a selected optional
  step.

The installer must never hang waiting for stdin in non-interactive mode.

## Test Strategy

The implementation plan should include tests for:

- placement-only path does not claim guided readiness;
- guided prompts use concrete question text, not generic step ids;
- confirmed path keys are not written from cwd defaults;
- placement-only state does not persist guided `confirmed_*` values;
- placement-only followed by guided `--apply` still prompts the full guided
  sequence;
- WSL profile detection and ambiguous profile selection;
- Windows skill sync idempotence and checksum verification;
- non-interactive apply fails when required guided choices are missing;
- superpowers missing path stops before prompt flow;
- non-interactive mode checks superpowers availability but never runs the
  interview;
- `confirmed_superpowers_checked` is written only after the check actually ran;
- doctor replay uses the same verify functions as install;
- rollout proof skip/pass/fail triad from Track A remains intact;
- 3-OS CI remains green.

## Review Gates

Before implementation:

1. This design receives independent review.
2. The maintainer confirms the guided flow scope.
3. A task-by-task TDD plan is written.

Implementation must proceed in small commits with failing tests first.
