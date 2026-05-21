# SETUP — ThisCodex

This guide is for an AI assistant or developer installing the Codex side of the
ThisCode / ThisCodex pair.

## 0. Ask Your AI Assistant To Install It

Use this prompt. It follows the bundled `/prompt` rule: clear goal, step-by-step
execution, safety stops, and verification.

```text
https://github.com/treylom/ThisCodex 를 설치해줘. README.md와 docs/SETUP.md를 먼저 읽고, `thiscodex init` 안내형 설정을 단계별로 진행해. 토큰/자격증명, ~/.codex 설정, 시스템 패키지 설치는 실행 전에 나에게 확인해. 끝나면 `thiscodex doctor` 또는 문서의 검증 명령을 실행하고 결과를 요약해.
```

## 1. Prerequisites

```bash
node --version
npm --version
git --version
codex --version 2>/dev/null
tmux -V 2>/dev/null
```

Expected: Node 18+, Git, Codex CLI, and tmux are available. If `tmux` is
missing, install it through your OS package manager before launching a
persistent Discord bot.

## 2. Clone And Run Guided Setup

```bash
git clone https://github.com/treylom/ThisCodex ~/.agents/thiscodex
cd ~/.agents/thiscodex
npx github:treylom/ThisCodex init
```

The guided setup asks for the repo root, workspace, bot working directory,
state directory, Codex config, runner guidance, and final doctor checks. Answer
one question at a time. Do not report "copied = installed"; skill placement and
guided onboarding are different steps.

## 3. Verification

```bash
node bin/thiscodex.mjs --check
npm test
```

If installed globally or through `npx`, also run:

```bash
thiscodex doctor
```

## 4. Next Docs

- [SETUP-BEGINNER.md](SETUP-BEGINNER.md) — same flow in simpler words.
- [SETUP-CONFIG-GUIDE.md](SETUP-CONFIG-GUIDE.md) — author `AGENTS.md`,
  `soul.md`, and rules with the bundled `/prompt` skill.
- [RECENT-CHANGES.md](RECENT-CHANGES.md) — newest behavior changes an installed
  bot must reflect.
