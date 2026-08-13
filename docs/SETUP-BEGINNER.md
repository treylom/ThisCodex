# ThisCodex Beginner Setup

ThisCodex helps a Codex CLI bot run from Discord and share the same working
rules as your Claude Code bots.

## First: Copy This To Your AI Assistant

```text
https://github.com/treylom/ThisCodex 에 있는 README.ko.md와 docs/SETUP-BEGINNER.md를 읽고 설치를 도와줘. 첫 질문으로 자동/수동을 물어봐. 자동을 고르면 할 수 있는 단계는 실제로 시도하고 결과를 기록한 뒤에만 나에게 넘겨. 토큰/자격증명·보안 승인·시스템 패키지 설치 전에는 꼭 확인하고, 마지막에는 `thiscodex doctor` 또는 문서의 검증 명령까지 실행해줘.
```

## 1. Check The Tools

Paste these commands one at a time:

```bash
node --version
git --version
codex --version
tmux -V
```

If one command fails, stop and install that tool first.

## 2. Get ThisCodex

```bash
git clone https://github.com/treylom/ThisCodex ~/.agents/thiscodex
cd ~/.agents/thiscodex
```

If the folder already exists:

```bash
cd ~/.agents/thiscodex
git pull
```

## 3. Create A Discord Bot (one-time, with the browser skill)

Ask Codex to **run the `create-bot` skill**. In Automatic mode it keeps one
policy-listed Playwright or claude-in-chrome provider active, creates the
application, turns on the required intents, prepares the invite, and records a
failure before it shows any manual fallback.

Only the account owner performs login/MFA, hCaptcha, and Reset Token
password/MFA confirmation. Resume the same browser provider immediately after
each security step. If browser automation is unavailable, the skill first tries
registration and re-detection; it does not jump straight to click-by-click
instructions.

Keep the token secret: never paste it into Discord messages, git, screenshots,
or an AI-visible browser snapshot. The skill prefers a model-blind clipboard
handoff and writes only the local `.env` result.

## 4. Run The Guided Setup

```bash
npx github:treylom/ThisCodex init
```

The first setup question is Automatic or Manual. The remaining setup asks
questions one by one. If you do not know an answer, ask the AI
assistant to explain the default in plain words before continuing.

## 5. Verify

```bash
node bin/thiscodex.mjs
npm test
```

If your shell can find `thiscodex`, run:

```bash
thiscodex doctor
```

Done means the verification commands pass, not just that files were copied.
