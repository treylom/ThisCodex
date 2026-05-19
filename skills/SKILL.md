---
name: thiscodex-plugin
description: Use when installing or reviewing the packaged ThisCodex Codex plugin. Routes users to the guided installer, explains that plugin packaging and guided onboarding are separate, and delegates implementation detail to skills/thiscodex/SKILL.md.
---

# ThisCodex Plugin Entry

This is the plugin-level entrypoint. It keeps marketplace/plugin discovery short
and delegates the full operational procedure to `skills/thiscodex/SKILL.md`.

## Use This First

1. For a human or AI agent setting up a bot, run guided onboarding:
   `thiscodex init`
2. Treat plugin/skill placement as visibility only. Placement is not guided
   onboarding, and it does not prove the Discord bot, BOT_WD, state dir, Codex
   config, or rollout checks are ready.
3. Load `skills/thiscodex/SKILL.md` for the complete step-by-step procedure,
   troubleshooting, and verification gates.

## Guardrail

Do not report "installed" from a copied `SKILL.md` alone. A completed setup
requires the guided onboarding or `thiscodex doctor` verification path.
