import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISCORD_API_BASE,
  DISCORD_CHANNEL_TYPES,
  DiscordThreadError,
  buildDiscordThreadPlan,
  executeDiscordThread,
  parseDiscordThreadArgs,
  tokenFromEnvText,
} from '../../scripts/lib/discord-thread.mjs';

const BIN = fileURLToPath(new URL('../../bin/thiscodex.mjs', import.meta.url));
const SENTINEL = 'fixture.token.value';
const RAW_STATE_DIR = '/confirmed/discord-state';
const CONFIRMED_STATE_DIR = resolve(RAW_STATE_DIR);

const response = (status, payload) => ({
  status,
  ok: status >= 200 && status < 300,
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  },
});

const publicOptions = (extra = []) => parseDiscordThreadArgs([
  'public',
  '--channel-id', '123456789012345678',
  '--channel-type', '0',
  '--message-id', '223456789012345678',
  '--name', '공개 스레드',
  ...extra,
]);

const privateOptions = (extra = []) => parseDiscordThreadArgs([
  'private',
  '--channel-id', '123456789012345678',
  '--channel-type', '0',
  '--name', '비공개 스레드',
  ...extra,
]);

test('public dry-run pins Discord API v10 and emits no authorization value', async () => {
  const options = publicOptions();
  const result = await executeDiscordThread(options, { packageVersion: '1.0.0' });

  assert.equal(DISCORD_API_BASE, 'https://discord.com/api/v10');
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.request.url, 'https://discord.com/api/v10/channels/123456789012345678/messages/223456789012345678/threads');
  assert.equal(result.request.method, 'POST');
  assert.equal(Object.hasOwn(result.request.headers, 'Authorization'), false);
  assert.equal(JSON.stringify(result).includes(SENTINEL), false);
});

test('request plan pins the required DiscordBot user agent', () => {
  const plan = buildDiscordThreadPlan(publicOptions(), '1.0.0');
  assert.equal(plan.headers['User-Agent'], 'DiscordBot (https://github.com/treylom/ThisCodex, 1.0.0)');
});

test('public announcement mode expects ANNOUNCEMENT_THREAD type 10', () => {
  const options = parseDiscordThreadArgs([
    'public', '--channel-id', '123456789012345678', '--channel-type', '5',
    '--message-id', '223456789012345678', '--name', '공지 공개 스레드',
  ]);
  assert.equal(buildDiscordThreadPlan(options, '1.0.0').expectedType, DISCORD_CHANNEL_TYPES.ANNOUNCEMENT_THREAD);
});

test('private dry-run sends explicit type 12 and defaults invitable closed', async () => {
  const result = await executeDiscordThread(privateOptions(), { packageVersion: '1.0.0' });
  assert.match(result.request.url, /\/channels\/123456789012345678\/threads$/);
  assert.equal(result.request.body.type, DISCORD_CHANNEL_TYPES.PRIVATE_THREAD);
  assert.equal(result.request.body.type, 12);
  assert.equal(result.request.body.invitable, false);

  const openResult = await executeDiscordThread(privateOptions(['--invitable', 'true']), { packageVersion: '1.0.0' });
  assert.equal(openResult.request.body.invitable, true);
});

test('forum and media channel types stop before token or network access', async () => {
  for (const channelType of [15, 16]) {
    assert.throws(
      () => parseDiscordThreadArgs([
        'public', '--channel-id', '123456789012345678', '--channel-type', String(channelType),
        '--message-id', '223456789012345678', '--name', '미지원 표면',
      ]),
      error => error instanceof DiscordThreadError && error.code === 'unsupported_surface',
    );
  }
});

test('apply sends the sentinel token only in the Authorization header and redacts output', async () => {
  let captured;
  const result = await executeDiscordThread(publicOptions(['--apply']), {
    packageVersion: '1.0.0',
    env: { DISCORD_STATE_DIR: RAW_STATE_DIR },
    tokenLoader: stateDir => {
      assert.equal(stateDir, CONFIRMED_STATE_DIR);
      return SENTINEL;
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return response(201, {
        id: '323456789012345678',
        parent_id: '123456789012345678',
        type: 11,
        name: '공개 스레드',
      });
    },
  });

  assert.equal(captured.init.headers.Authorization, `Bot ${SENTINEL}`);
  assert.equal(result.ok, true);
  assert.equal(result.thread_type, 11);
  assert.equal(JSON.stringify(result).includes(SENTINEL), false);
});

test('Discord JSON codes keep access, permission, duplicate, capacity, and support failures distinct', async () => {
  const cases = [
    [403, { code: 50001, message: 'Missing access' }, 'channel_not_accessible', /membership.*VIEW_CHANNEL/i],
    [403, { code: 50013, message: 'You lack permissions' }, 'permission_denied', /CREATE_PUBLIC_THREADS/],
    [400, { code: 160004, message: 'A thread has already been created' }, 'already_exists', /existing thread/i],
    [400, { code: 160006, message: 'Maximum number of active threads reached' }, 'capacity_exhausted', /Archive an inactive thread/i],
    [400, { code: 160007, message: 'Maximum number of active announcement threads reached' }, 'capacity_exhausted', /Archive an inactive thread/i],
    [400, { code: 50024, message: 'Cannot execute action on this channel type' }, 'unsupported_surface', /Correct the channel type/i],
  ];

  for (const [status, payload, expected, nextPattern] of cases) {
    const result = await executeDiscordThread(publicOptions(['--apply']), {
      env: { DISCORD_STATE_DIR: RAW_STATE_DIR },
      tokenLoader: () => SENTINEL,
      fetchImpl: async () => response(status, payload),
    });
    assert.equal(result.code, expected, `${payload.code} must map to ${expected}`);
    assert.match(result.next, nextPattern, `${payload.code} must preserve its operator action`);
    assert.equal(JSON.stringify(result).includes(SENTINEL), false);
  }

  const privatePermission = await executeDiscordThread(privateOptions(['--apply']), {
    env: { DISCORD_STATE_DIR: RAW_STATE_DIR },
    tokenLoader: () => SENTINEL,
    fetchImpl: async () => response(403, { code: 50013, message: 'You lack permissions' }),
  });
  assert.match(privatePermission.next, /CREATE_PRIVATE_THREADS/);
});

test('Cloudflare 1010 HTML remains distinct from Discord permission JSON', async () => {
  const result = await executeDiscordThread(publicOptions(['--apply']), {
    env: { DISCORD_STATE_DIR: RAW_STATE_DIR },
    tokenLoader: () => SENTINEL,
    fetchImpl: async () => response(403, '<html>Cloudflare error 1010</html>'),
  });
  assert.equal(result.code, 'user_agent_rejected');
  assert.doesNotMatch(result.message, new RegExp(SENTINEL.replaceAll('.', '\\.')));

  const discordJson = await executeDiscordThread(publicOptions(['--apply']), {
    env: { DISCORD_STATE_DIR: RAW_STATE_DIR },
    tokenLoader: () => SENTINEL,
    fetchImpl: async () => response(403, { code: 99999, message: 'Discord incident 1010' }),
  });
  assert.equal(discordJson.code, 'api_error');
});

test('transport ambiguity never retries automatically', async () => {
  let calls = 0;
  const result = await executeDiscordThread(privateOptions(['--apply']), {
    env: { DISCORD_STATE_DIR: RAW_STATE_DIR },
    tokenLoader: () => SENTINEL,
    fetchImpl: async () => {
      calls += 1;
      throw new Error(`socket closed after ${SENTINEL}`);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.code, 'indeterminate_transport');
  assert.equal(JSON.stringify(result).includes(SENTINEL), false);
  assert.match(result.next, /before any explicit retry/i);
});

test('token parser accepts one exact env key and rejects blank or whitespace values', () => {
  assert.equal(tokenFromEnvText(`# comment\nDISCORD_BOT_TOKEN='${SENTINEL}'\n`), SENTINEL);
  assert.throws(() => tokenFromEnvText('DISCORD_BOT_TOKEN=\n'), /missing/i);
  assert.throws(() => tokenFromEnvText('DISCORD_BOT_TOKEN=has whitespace\n'), /missing/i);
});

test('CLI dry-run works without token state and preserves Korean thread names', () => {
  const output = execFileSync(process.execPath, [
    BIN, 'discord-thread', 'private',
    '--channel-id', '123456789012345678',
    '--channel-type', '0',
    '--name', '비공개 스레드',
  ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.request.body.name, '비공개 스레드');
  assert.equal(result.request.body.type, 12);
});

test('CLI unsupported channel exits before a token-state error', () => {
  const result = spawnSync(process.execPath, [
    BIN, 'discord-thread', 'public',
    '--channel-id', '123456789012345678',
    '--channel-type', '15',
    '--message-id', '223456789012345678',
    '--name', '포럼 스레드',
    '--apply',
  ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const output = JSON.parse(result.stdout);
  assert.equal(result.status, 2);
  assert.equal(output.code, 'unsupported_surface');
  assert.doesNotMatch(result.stdout + result.stderr, /DISCORD_BOT_TOKEN|state_dir_unconfirmed/);
});
