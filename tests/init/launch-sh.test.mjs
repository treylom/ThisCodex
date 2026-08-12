import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const text = readFileSync('scripts/launch.sh', 'utf8');
const shellQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;

test('launch.sh never contains bare codex --remote fallback', () => {
  assert.doesNotMatch(text, /codex --remote/);
  assert.match(text, /codex resume/);
});

test('launch.sh re-reads TID while waiting for rollout', () => {
  assert.match(text, /waiting rollout/);
  assert.match(text, /TID=\\\$\(cat \\\"\\\$TID_FILE\\\"\)/);
});

test('launch.sh has rollout timeout recovery text', () => {
  assert.match(text, /rollout timeout|timeout.*rollout|recovery command/i);
});

test('launch.sh addresses sessions and windows with exact tmux targets', () => {
  assert.match(text, /has-session -t "=\$SESSION"/);
  assert.match(text, /kill-session -t "=\$SESSION"/);
  assert.match(text, /new-window -t "=\$SESSION:"/);
  assert.match(text, /select-window -t "=\$SESSION:codex"/);
  assert.doesNotMatch(text, /has-session -t "\$SESSION"|kill-session -t "\$SESSION"/);
});

test('launch.sh executes a space- and apostrophe-containing absolute LAUNCH_CMD as one path', () => {
  const temp = mkdtempSync(join(tmpdir(), 'launch-sh-space-'));
  const bin = join(temp, 'bin');
  const botWd = join(temp, 'bot working directory');
  const launchCmd = join(temp, "infra launch's");
  const stopFile = join(temp, 'stop');
  const tmuxCapture = join(temp, 'tmux-infra-command');
  const codexCapture = join(temp, 'tmux-codex-command');
  const codexRan = join(temp, 'codex-ran');
  const readyLog = join(temp, "ready log's");
  const tidFile = join(temp, "thread id's");
  const home = join(temp, "home dir's");
  const tid = '12345678-1234-1234-1234-123456789abc';
  const ran = join(temp, 'ran');

  try {
    mkdirSync(bin);
    mkdirSync(botWd);
    mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
    writeFileSync(readyLog, 'Listening\n');
    writeFileSync(tidFile, `${tid}\n`);
    writeFileSync(join(home, '.codex', 'sessions', `rollout-${tid}.jsonl`), '{}\n');
    writeFileSync(join(bin, 'codex'), `#!/usr/bin/env bash
printf '%s\n' "$@" > "$CODEX_RAN"
`);
    writeFileSync(join(bin, 'tmux'), `#!/usr/bin/env bash
if [ "$1" = has-session ]; then exit 1; fi
if [ "$1" = new-session ]; then
  printf '%s' "\${@: -1}" > "$TMUX_CAPTURE"
  touch "$STOP_FILE"
fi
if [ "$1" = new-window ]; then
  printf '%s' "\${@: -1}" > "$CODEX_CAPTURE"
fi
`);
    writeFileSync(launchCmd, `#!/usr/bin/env bash
printf '%s' "$SESSION|$READY_LOG|$THISCODEX_PYTHON|$THISCODEX_LAUNCH_TEST" > "$RAN"
`);
    chmodSync(join(bin, 'codex'), 0o755);
    chmodSync(join(bin, 'tmux'), 0o755);
    chmodSync(launchCmd, 0o755);

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BOT_WD: botWd,
      LAUNCH_CMD: launchCmd,
      STOP_FILE: stopFile,
      TMUX_CAPTURE: tmuxCapture,
      CODEX_CAPTURE: codexCapture,
      CODEX_RAN: codexRan,
      RAN: ran,
      HOME: home,
      SESSION: 'quote-test',
      READY_LOG: readyLog,
      TID_FILE: tidFile,
      THISCODEX_PYTHON: join(temp, 'python executable'),
      THISCODEX_SHELL: '/usr/bin/true',
      CODEX_RESUME_FLAGS: '--sandbox read-only',
    };
    const launch = spawnSync('bash', ['scripts/launch.sh'], { encoding: 'utf8', env });
    assert.equal(launch.status, 0, launch.stderr);

    execFileSync('bash', ['-c', readFileSync(tmuxCapture, 'utf8')], { env });
    assert.equal(
      readFileSync(ran, 'utf8'),
      `quote-test|${readyLog}|${join(temp, 'python executable')}|`,
    );

    execFileSync('bash', ['-c', readFileSync(codexCapture, 'utf8')], { env });
    assert.deepEqual(readFileSync(codexRan, 'utf8').trim().split('\n'), [
      'resume', tid, '--remote', 'ws://127.0.0.1:4222', '--sandbox', 'read-only',
    ]);

    const prefixed = spawnSync('bash', ['scripts/launch.sh'], {
      encoding: 'utf8',
      env: { ...env, LAUNCH_CMD: `THISCODEX_LAUNCH_TEST=enabled ${shellQuote(launchCmd)}` },
    });
    assert.equal(prefixed.status, 0, prefixed.stderr);
    execFileSync('bash', ['-c', readFileSync(tmuxCapture, 'utf8')], { env });
    assert.equal(
      readFileSync(ran, 'utf8'),
      `quote-test|${readyLog}|${join(temp, 'python executable')}|enabled`,
    );
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
});

test('launch.sh syntax is valid bash', () => {
  execFileSync('bash', ['-n', 'scripts/launch.sh']);
});
