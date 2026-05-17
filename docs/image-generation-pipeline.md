# Race-Free Codex Image Generation Pipeline

This document is the ThisCodex domain contract for generating multiple raster
images with Codex without scrambling file-to-prompt mappings.

## Problem

Do not run multiple Codex image jobs against the shared
`~/.codex/generated_images` directory and then select outputs by creation order,
"latest file", or unsorted directory listing. Parallel jobs can interleave their
outputs, causing a target such as `03.png` to receive the image for prompt `07`.

## Required Input

Batch generation starts from a manifest. A minimal row is:

```json
{
  "id": "03-search-fallback",
  "prompt_file": "prompts/03-search-fallback.md",
  "target_path": "assets/03-search-fallback.png",
  "expected_subject": "4-tier search fallback diagram",
  "expected_labels": ["GraphRAG", "vault-search", "Obsidian CLI", "ripgrep"],
  "aspect_ratio": "16:9"
}
```

Rules:

- `id` is stable, unique, and used for all intermediate paths.
- `prompt_file` and `target_path` are explicit; no positional mapping.
- `target_path` must be inside the destination repository or approved output
  root.
- The coordinator treats manifest order as display order only, never as output
  discovery logic.

## Run Layout

For each batch, create a run directory:

```text
.image-runs/<run-id>/
  manifest.json
  <job-id>/
    prompt.md
    work/
    codex-home/
    tmp/
    out/
    codex.log
    result.json
```

Each job gets its own process environment:

```bash
CODEX_HOME=<run>/<job-id>/codex-home
TMPDIR=<run>/<job-id>/tmp
codex exec --cd <run>/<job-id>/work ...
```

The coordinator may copy `auth.json` or other required operator-provided Codex
state into the job-local `codex-home`, but it must not point jobs at the shared
`~/.codex` home.

## Worker Contract

Each Codex worker owns exactly one manifest row.

1. Read only `<job>/prompt.md`.
2. Generate exactly one image.
3. Locate outputs only under `$CODEX_HOME/generated_images`.
4. Fail if zero or more than one PNG is produced for the job.
5. Copy the selected image to `<job>/out/generated.png`.
6. Write `<job>/result.json`:

```json
{
  "id": "03-search-fallback",
  "status": "ok",
  "prompt_sha256": "<sha256>",
  "source_image_path": "<job-local generated_images path>",
  "target_path": "assets/03-search-fallback.png",
  "image_sha256": "<sha256>"
}
```

No worker writes the final target path. Workers never scan
`~/.codex/generated_images`.

## Coordinator Contract

Only the coordinator writes final assets.

For each manifest row:

1. Read the matching `<job>/result.json` by `id`.
2. Verify `target_path` matches the manifest row.
3. Verify `prompt_sha256` and `image_sha256` are present.
4. Verify the source image exists, is a PNG, and has non-trivial size.
5. Copy to `target_path.tmp`.
6. Atomic rename `target_path.tmp` to `target_path`.
7. Emit a final report mapping `id -> target_path -> image_sha256`.

Never infer mappings from output order, mtime, or filename sorting outside the
manifest and `result.json`.

## Parallelism Rule

Parallel mode is allowed only after the `CODEX_HOME` isolation smoke passes on
the current host and Codex version.

If the smoke fails, the official fallback is:

- sequential execution;
- a global lock around any access to shared generated image state;
- the same manifest/result/atomic-rename coordinator contract.

The fallback keeps correctness and discards speed.

## Smoke Result

Smoke run: `2026-05-18`, Codex CLI `0.130.0`, macOS host.

Command shape:

```bash
CODEX_HOME=/tmp/thiscodex-image-smoke-parallel-1779058612/job-a/codex-home \
  codex exec --ignore-user-config --skip-git-repo-check \
  --cd /tmp/thiscodex-image-smoke-parallel-1779058612/job-a/work \
  --dangerously-bypass-approvals-and-sandbox ...

CODEX_HOME=/tmp/thiscodex-image-smoke-parallel-1779058612/job-b/codex-home \
  codex exec --ignore-user-config --skip-git-repo-check \
  --cd /tmp/thiscodex-image-smoke-parallel-1779058612/job-b/work \
  --dangerously-bypass-approvals-and-sandbox ...
```

Observed:

- `job-a` generated exactly one PNG under
  `/tmp/thiscodex-image-smoke-parallel-1779058612/job-a/codex-home/generated_images/...`.
- `job-b` generated exactly one PNG under
  `/tmp/thiscodex-image-smoke-parallel-1779058612/job-b/codex-home/generated_images/...`.
- shared `~/.codex/generated_images` new-file count during the parallel run:
  `0`.
- both outputs were valid PNG images (`1254 x 1254`, RGB).
- job logs contained no references to the shared generated-images path.

Conclusion: on this host/version, `CODEX_HOME` isolates Codex image outputs.
Parallel generation is permitted when using the job-local layout above.

## Review Limits

The pipeline can guarantee file-to-prompt mapping and atomic placement. It
cannot guarantee that generated text inside the image is correct. Text and
label accuracy remain a review item and should be surfaced as `needs_review`
when uncertain.
