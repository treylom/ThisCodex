# Guided Installer Requirements

This document defines the Track B installer requirements for ThisCodex. It is
the product-facing form of the clean reinstall finding: copying a skill into a
Codex-visible directory is not the same thing as completing guided bot
onboarding.

## Status

- Track A regression fixes are already baseline on `master`.
- This document does not change code.
- Implementation must keep Track A behavior intact:
  - manifest `when` supports `and` and `or`;
  - rollout proof reads `.codex-thread-id` from confirmed `BOT_WD`;
  - non-interactive mode does not persist placeholder confirmed paths;
  - `doctor` skips rollout proof with a reason only when no Codex thread exists,
    and still fails when a thread exists but rollout is missing.

## Core Distinction

ThisCodex has two separate install surfaces:

1. **Skill placement install**: copy `skills/thiscodex` into a Codex-visible
   skill layer.
2. **Guided onboarding install**: guide a user through the first full bot setup
   until the bot working directory, state directory, skill layer, config, prompt
   files, daemon runner, and verification path are all configured and
   inspectable.

Passing `--non-interactive` checks or copying `SKILL.md` satisfies only the
first surface. It must not be reported as full guided onboarding.

## Required Guided Flow

`thiscodex init --apply` is the guided onboarding path. It must ask concrete,
reasoned questions with useful defaults. It must not display generic
`step.id:` prompts.

The guided sequence is ordered:

1. Confirm the ThisCodex repository root.
2. Confirm the workspace or vault root.
3. Confirm each bot working directory.
4. Confirm the Discord state directory and explain why it must live outside
   `BOT_WD`.
5. Select the Codex skill layer, defaulting to the user layer.
6. On WSL, detect paired Windows profiles and offer Windows-side sync.
7. Check and optionally patch `~/.codex/config.toml`.
8. Check the Codex-native superpowers path and record that the check ran.
9. Route the prompt flow that drafts `AGENTS.md`, `soul.md`, and `rules/`.
10. Run or route the `/using-superpowers` interview. This is required for full
    guided onboarding; if it is unavailable, the installer must stop before
    prompt-file generation and print the next command.
11. Offer daemon runner generation, safe by default, YOLO only by explicit
    opt-in.
12. Verify skill placement, config, `.codex-thread-id`, rollout materialization,
    and `doctor`.
13. Write machine-readable install state and a human-readable install log.

## Non-Interactive Mode

`--non-interactive` is for CI and diagnosis. It is not guided onboarding.

It must:

- never wait for stdin;
- never invent unconfirmed paths;
- never persist placeholder answers such as `confirmed_bot_wd: "check_only"`;
- print the next command needed to continue;
- return non-zero when a required guided decision is missing in `--apply`;
- stay useful for CI checks that do not have Codex auth, app-server, tmux, or a
  rollout file.

## Windows Sync

When running under WSL, Windows sync is a first-class setup step.

The guided installer must:

- detect WSL;
- list candidate Windows profiles under `/mnt/c/Users`;
- ask the user to confirm the target profile when there is ambiguity;
- sync `skills/thiscodex` to the Windows Codex user skill layer;
- preserve unrelated Windows-side skills and files;
- keep repeated runs idempotent;
- record both WSL and Windows destinations in install state;
- verify that Windows-side `SKILL.md` exists and matches the source skill.

If the Windows profile cannot be detected or written, the installer must stop
that step with a clear next command. It must not claim cross-OS setup is
complete.

## Superpowers And Prompt Flow

Guided onboarding needs the Codex-native superpowers path and the prompt flow
that drafts bot instructions.

If `/using-superpowers` is not available and cannot be made available in the
current environment, the installer must stop the guided onboarding flow and
explain the next command. It must not continue into `AGENTS.md`, `soul.md`, or
`rules/` generation as if the interview happened.

The interview execution model is explicit:

- interactive guided onboarding may invoke or route the interview and then
  store the result in the install log;
- non-interactive mode must not try to run the interview. It checks whether the
  superpowers path is already available, prints the next command if it is not,
  and exits with a status that reflects whether a required guided decision is
  missing.

The installer must persist a confirmed superpowers check marker such as
`confirmed_superpowers_checked` only after the check actually ran. It must not
invent this marker in check-only mode.

## Confirmed State Rule

The installer may display detected defaults, but it may persist only confirmed
values.

Confirmed keys include:

- `confirmed_repo_root`
- `confirmed_workspace_root`
- `confirmed_bot_wd`
- `confirmed_state_dir`
- `confirmed_windows_profile`
- `confirmed_skill_layer`
- `confirmed_superpowers_checked`

These values must come from explicit CLI flags, an answers file, or an
interactive user confirmation. `cwd`, repo root, or check-only defaults are not
confirmed values by themselves.

## Doctor Replay

`thiscodex doctor` must replay the same filesystem and environment verification
gates used by guided onboarding. It must not invent state from the install log.

Doctor verifies the current filesystem state for:

- skill placement;
- Codex config;
- confirmed path writability;
- `.codex-thread-id` when present;
- rollout materialization when a thread exists;
- Windows skill sync when selected;
- superpowers availability check status.

Placement-only state must stay separate. A placement-only install must not
persist `confirmed_*` guided-onboarding values, and a later guided `--apply`
must still prompt the full guided sequence instead of skipping it.
