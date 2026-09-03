import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REQUIRED_HOOKS,
  flattenHooks,
  hookTrustHash,
  hooksDocument,
  renderedHooksJson,
} from '../../scripts/lib/hooks-contract.mjs';

test('static plugin bundle is byte-equivalent to the single hooks contract', () => {
  assert.equal(readFileSync('hooks/hooks.json', 'utf8').replace(/\r\n/g, '\n'), renderedHooksJson());
  const rendered = spawnSync(process.execPath, ['scripts/render-hooks.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  assert.match(rendered.stdout, /what|Compared|대조/i);
});

test('bundle has exactly the approved 11 handlers and every one uses bot-only', () => {
  const entries = flattenHooks(hooksDocument());
  assert.equal(entries.length, 11);
  const names = entries.map(({ hook }) => REQUIRED_HOOKS.find(name => hook.command.includes(`/hooks/${name}`)));
  assert.deepEqual(names.sort(), [...REQUIRED_HOOKS].sort());
  for (const { hook } of entries) {
    assert.match(hook.command, /\$\{PLUGIN_ROOT\}\/hooks\/lib\/bot-only\.sh/);
    assert.doesNotMatch(hook.command, /CLAUDE_PLUGIN_ROOT/);
    const target = hook.command.match(/\$\{PLUGIN_ROOT\}(\/hooks\/[A-Za-z0-9._/-]+)"$/)?.[1];
    assert.ok(target, `target missing from ${hook.command}`);
    assert.ok(existsSync(`.${target}`), `target file missing: ${target}`);
  }
  const ask = entries.find(({ hook }) => hook.command.includes('automation-no-interactive.sh'));
  assert.equal(ask.matcher, 'AskUserQuestion|request_user_input');
});

test('plugin manifest declares the bundle', () => {
  const plugin = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));
  assert.equal(plugin.hooks, './hooks/hooks.json');
});

test('bot-only wrapper is silent outside a bot and preserves stdin and exit in a bot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-bot-only-'));
  const target = join(dir, 'target.sh');
  const marker = join(dir, 'ran');
  writeFileSync(target, `#!/usr/bin/env bash\ncat\nprintf ran > '${marker}'\nexit 7\n`);
  try {
    const negative = spawnSync('bash', ['hooks/lib/bot-only.sh', 'fixture', target], {
      encoding: 'utf8', input: 'payload', env: { ...process.env, DISCORD_STATE_DIR: '' },
    });
    assert.equal(negative.status, 0);
    assert.equal(negative.stdout, '');
    assert.equal(existsSync(marker), false);
    const positive = spawnSync('bash', ['hooks/lib/bot-only.sh', 'fixture', target, 'arg'], {
      encoding: 'utf8', input: 'payload', env: { ...process.env, DISCORD_STATE_DIR: dir },
    });
    assert.equal(positive.status, 7);
    assert.equal(positive.stdout, 'payload');
    assert.equal(readFileSync(marker, 'utf8'), 'ran');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bot-only treats .PY as Python and fails open when python3 is unavailable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-bot-only-python-'));
  const target = join(dir, 'target.PY');
  writeFileSync(target, 'import sys\nprint("python-target")\nsys.exit(6)\n');
  try {
    const upper = spawnSync('bash', ['hooks/lib/bot-only.sh', 'python-fixture', target], {
      encoding: 'utf8', env: { ...process.env, DISCORD_STATE_DIR: dir },
    });
    assert.equal(upper.status, 6);
    assert.equal(upper.stdout.replace(/\r\n/g, '\n'), 'python-target\n');

    const emptyPath = mkdtempSync(join(tmpdir(), 'tcx-no-python-'));
    try {
      const absent = spawnSync('bash', [
        '-c', 'cat_path=$(command -v cat) || exit 127; PATH="$1"; shift; cat() { "$cat_path" "$@"; }; source "$@"', 'bot-only-test',
        emptyPath, 'hooks/lib/bot-only.sh', 'python-fixture', target,
      ], {
        encoding: 'utf8', input: 'x'.repeat(1024 * 1024),
        env: { ...process.env, DISCORD_STATE_DIR: dir },
      });
      assert.equal(absent.error, undefined, absent.error?.message);
      assert.equal(absent.status, 0);
      assert.equal(absent.stdout, '');
      assert.match(absent.stderr, /python3 unavailable/);
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trust hash implementation matches the Codex 0.152.1 temporary-HOME observation', () => {
  assert.equal(hookTrustHash('SessionStart', null, {
    type: 'command',
    command: '/tmp/thiscodex-trust-wRh9u3/probe-hooks/session-start.sh',
    timeout: 5,
  }), 'sha256:b12ef4f03b7954513d88c3e602cf18ddfe052ce739fb59193fe8cd4a7f288889');
});
