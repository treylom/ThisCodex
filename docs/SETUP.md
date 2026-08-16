# SETUP — ThisCodex

This guide is for an AI assistant or developer installing the Codex side of the
ThisCode / ThisCodex pair.

## 0. Ask Your AI Assistant To Install It

Use this prompt. It follows the bundled `/prompt` rule: clear goal, step-by-step
execution, safety stops, and verification.

```text
https://github.com/treylom/ThisCodex 를 설치해줘. README.md와 docs/SETUP.md를 먼저 읽고 `thiscodex init` 안내형 설정을 실행해. 첫 질문은 자동/수동이어야 해. 자동 모드에서는 복구 가능한 일을 실제로 시도하고 결과를 감사 로그에 남긴 뒤에만 나에게 넘겨. 브라우저는 같은 provider로 완료 또는 기록된 종료 상태까지 진행해. 토큰/자격증명, ~/.codex 권한 설정, 시스템 패키지 설치는 실행 전에 나에게 확인해. 끝나면 `thiscodex doctor` 또는 문서의 검증 명령을 실행하고 결과를 요약해.
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

The guided setup first asks **Automatic (`auto`) or Manual (`manual`)**. It then
asks for the repo root, workspace, bot working directory,
state directory, Codex config, runner guidance, and final doctor checks. Answer
one question at a time. Do not report "copied = installed"; skill placement and
guided onboarding are different steps.

`install/automation-policy.yaml` is consumed by code. In Automatic mode, a
manual fallback is blocked until `thiscodex automation-gate` consumes a
current-turn completion envelope written by the bridge or records a named
human-only boundary. The returned receipt must accompany the handoff and is
checked by both the Discord PreToolUse hook and bridge fallback. The audit
stores only policy labels and evidence coordinates at
`~/.config/thiscodex/automation-attempts.jsonl` with file mode `0600`.

## 3. Discord Bot Creation With Browser Automation

After guided setup has confirmed the bot state directory, ask Codex to **run
the `create-bot` skill**. It ports the companion ThisCode portal flow: Codex
opens the Discord Developer Portal, creates the application, enables Message
Content Intent and Server Members Intent, receives the token through a
secret-safe handoff, and creates the server invitation.

The skill accepts the policy-listed `playwright` or `claude-in-chrome` provider
and discovers its callable tool names by capability. If neither can navigate,
inspect a page, click, type, and wait, it asks before registering Playwright MCP:

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest
```

The equivalent `~/.codex/config.toml` block is:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]
```

Restart Codex after registration, then run the `create-bot` skill again so it
can re-detect the callable tools. The app-server completion envelope must name
one of the two policy providers. `web.run` can fetch pages but cannot
replace interactive portal control.

Keep the selected browser provider in use through one terminal state:
completed, a named credential/CAPTCHA boundary, or a recorded provider/tool
failure. A provider that was merely started is not evidence of a completed
automatic attempt. Manual fallback is shown only when the code gate returns
`handoff_allowed: true`.

Only three security steps remain human-owned: Discord login credentials/MFA,
the New Application hCaptcha, and the Reset Token password/MFA confirmation.
Never paste a bot token into chat, screenshots, logs, or git. Package tests use
the skill's dry-run contract and do not touch a real Discord account.

## 4. Verification

```bash
node bin/thiscodex.mjs
npm test
```

If installed globally or through `npx`, also run:

```bash
thiscodex doctor
```

## 5. Next Docs

- [SETUP-BEGINNER.md](SETUP-BEGINNER.md) — same flow in simpler words.
- [SETUP-CONFIG-GUIDE.md](SETUP-CONFIG-GUIDE.md) — author the canonical
  `AGENTS.md` (including its SOUL v2 capsule) and rules with the bundled
  `/prompt` skill.
- [RECENT-CHANGES.md](RECENT-CHANGES.md) — newest behavior changes an installed
  bot must reflect.
