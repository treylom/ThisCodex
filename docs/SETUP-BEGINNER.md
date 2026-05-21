# ThisCodex Beginner Setup

ThisCodex helps a Codex CLI bot run from Discord and share the same working
rules as your Claude Code bots.

## First: Copy This To Your AI Assistant

```text
https://github.com/treylom/ThisCodex 에 있는 README.ko.md와 docs/SETUP-BEGINNER.md를 읽고 설치를 도와줘. 내가 복사해야 할 명령은 한 번에 하나씩 보여주고, 토큰/자격증명이나 시스템 패키지 설치 전에는 꼭 확인 질문을 해줘. 마지막에는 `thiscodex doctor` 또는 문서의 검증 명령까지 실행해줘.
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

## 3. Run The Guided Setup

```bash
npx github:treylom/ThisCodex init
```

The setup asks questions one by one. If you do not know an answer, ask the AI
assistant to explain the default in plain words before continuing.

## 4. Verify

```bash
node bin/thiscodex.mjs --check
npm test
```

If your shell can find `thiscodex`, run:

```bash
thiscodex doctor
```

Done means the verification commands pass, not just that files were copied.
