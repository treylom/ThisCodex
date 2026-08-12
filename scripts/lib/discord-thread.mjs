import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const DISCORD_API_BASE = 'https://discord.com/api/v10';
export const DISCORD_CHANNEL_TYPES = Object.freeze({
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
  ANNOUNCEMENT_THREAD: 10,
  PUBLIC_THREAD: 11,
  PRIVATE_THREAD: 12,
  GUILD_FORUM: 15,
  GUILD_MEDIA: 16,
});

const ARCHIVE_DURATIONS = new Set([60, 1440, 4320, 10080]);
const SNOWFLAKE_RE = /^\d{1,20}$/;

export class DiscordThreadError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DiscordThreadError';
    this.code = code;
    this.details = details;
  }
}

function integer(value, label) {
  if (!/^-?\d+$/.test(String(value ?? ''))) {
    throw new DiscordThreadError('invalid_request', `${label} must be an integer`);
  }
  return Number(value);
}

function boolean(value, label) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new DiscordThreadError('invalid_request', `${label} must be true or false`);
}

function snowflake(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SNOWFLAKE_RE.test(normalized)) {
    throw new DiscordThreadError('invalid_request', `${label} must be a Discord snowflake`);
  }
  return normalized;
}

function parseFlags(args) {
  const values = {};
  const booleans = new Set(['--apply']);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) {
      throw new DiscordThreadError('invalid_request', `unexpected argument: ${item}`);
    }
    const equal = item.indexOf('=');
    const key = equal === -1 ? item : item.slice(0, equal);
    if (booleans.has(key)) {
      if (equal !== -1) throw new DiscordThreadError('invalid_request', `${key} does not take a value`);
      if (Object.hasOwn(values, key)) {
        throw new DiscordThreadError('invalid_request', `duplicate option: ${key}`);
      }
      values[key] = true;
      continue;
    }
    const value = equal === -1 ? args[index + 1] : item.slice(equal + 1);
    if (!value || (equal === -1 && value.startsWith('--'))) {
      throw new DiscordThreadError('invalid_request', `${key} needs a value`);
    }
    if (equal === -1) index += 1;
    if (Object.hasOwn(values, key)) {
      throw new DiscordThreadError('invalid_request', `duplicate option: ${key}`);
    }
    values[key] = value;
  }
  return values;
}

export function parseDiscordThreadArgs(args) {
  const [mode, ...rest] = args;
  if (!['public', 'private'].includes(mode)) {
    throw new DiscordThreadError(
      'invalid_request',
      'usage: thiscodex discord-thread <public|private> --channel-id <id> --channel-type <type> --name <name> [--apply]',
    );
  }

  const flags = parseFlags(rest);
  const allowed = new Set([
    '--channel-id',
    '--channel-type',
    '--message-id',
    '--name',
    '--auto-archive',
    '--slowmode',
    '--invitable',
    '--timeout-ms',
    '--apply',
  ]);
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) throw new DiscordThreadError('invalid_request', `unknown option: ${key}`);
  }

  const channelId = snowflake(flags['--channel-id'], 'channel_id');
  const channelType = integer(flags['--channel-type'], 'channel_type');
  const name = String(flags['--name'] ?? '').trim();
  if (!name || [...name].length > 100) {
    throw new DiscordThreadError('invalid_request', 'name must contain 1-100 characters');
  }

  if ([DISCORD_CHANNEL_TYPES.GUILD_FORUM, DISCORD_CHANNEL_TYPES.GUILD_MEDIA].includes(channelType)) {
    throw new DiscordThreadError(
      'unsupported_surface',
      `channel type ${channelType} requires the Discord forum/media thread endpoint`,
      { channel_type: channelType },
    );
  }
  if (mode === 'public' && ![DISCORD_CHANNEL_TYPES.GUILD_TEXT, DISCORD_CHANNEL_TYPES.GUILD_ANNOUNCEMENT].includes(channelType)) {
    throw new DiscordThreadError('unsupported_surface', 'public mode requires channel type 0 or 5');
  }
  if (mode === 'private' && channelType !== DISCORD_CHANNEL_TYPES.GUILD_TEXT) {
    throw new DiscordThreadError('unsupported_surface', 'private mode requires channel type 0');
  }

  const messageId = flags['--message-id'] ? snowflake(flags['--message-id'], 'message_id') : '';
  if (mode === 'public' && !messageId) {
    throw new DiscordThreadError('invalid_request', 'public mode requires --message-id');
  }
  if (mode === 'private' && messageId) {
    throw new DiscordThreadError('invalid_request', 'private mode does not accept --message-id');
  }

  const autoArchiveDuration = flags['--auto-archive'] === undefined
    ? 1440
    : integer(flags['--auto-archive'], 'auto_archive_duration');
  if (!ARCHIVE_DURATIONS.has(autoArchiveDuration)) {
    throw new DiscordThreadError('invalid_request', 'auto_archive_duration must be 60, 1440, 4320, or 10080');
  }

  const rateLimitPerUser = flags['--slowmode'] === undefined
    ? 0
    : integer(flags['--slowmode'], 'rate_limit_per_user');
  if (rateLimitPerUser < 0 || rateLimitPerUser > 21600) {
    throw new DiscordThreadError('invalid_request', 'rate_limit_per_user must be between 0 and 21600');
  }

  const timeoutMs = flags['--timeout-ms'] === undefined
    ? 10000
    : integer(flags['--timeout-ms'], 'timeout_ms');
  if (timeoutMs < 100 || timeoutMs > 60000) {
    throw new DiscordThreadError('invalid_request', 'timeout_ms must be between 100 and 60000');
  }

  const invitable = mode === 'private'
    ? boolean(flags['--invitable'] ?? 'false', 'invitable')
    : undefined;
  if (mode === 'public' && flags['--invitable'] !== undefined) {
    throw new DiscordThreadError('invalid_request', 'public mode does not accept --invitable');
  }

  return {
    mode,
    apply: flags['--apply'] === true,
    channelId,
    channelType,
    messageId,
    name,
    autoArchiveDuration,
    rateLimitPerUser,
    invitable,
    timeoutMs,
  };
}

export function buildDiscordThreadPlan(options, packageVersion = '0.0.0') {
  const path = options.mode === 'public'
    ? `/channels/${options.channelId}/messages/${options.messageId}/threads`
    : `/channels/${options.channelId}/threads`;
  const body = {
    name: options.name,
    auto_archive_duration: options.autoArchiveDuration,
    rate_limit_per_user: options.rateLimitPerUser,
  };
  if (options.mode === 'private') {
    body.type = DISCORD_CHANNEL_TYPES.PRIVATE_THREAD;
    body.invitable = options.invitable;
  }
  return {
    method: 'POST',
    url: `${DISCORD_API_BASE}${path}`,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `DiscordBot (https://github.com/treylom/ThisCodex, ${packageVersion})`,
    },
    body,
    expectedType: options.mode === 'private'
      ? DISCORD_CHANNEL_TYPES.PRIVATE_THREAD
      : options.channelType === DISCORD_CHANNEL_TYPES.GUILD_ANNOUNCEMENT
        ? DISCORD_CHANNEL_TYPES.ANNOUNCEMENT_THREAD
        : DISCORD_CHANNEL_TYPES.PUBLIC_THREAD,
  };
}

export function tokenFromEnvText(text) {
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^DISCORD_BOT_TOKEN\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value || /\s/.test(value)) break;
    return value;
  }
  throw new DiscordThreadError('token_missing', 'DISCORD_BOT_TOKEN is missing from the confirmed Discord state .env');
}

export function resolveDiscordStateDir(env = process.env, installState = {}) {
  const candidate = env.DISCORD_STATE_DIR || installState.confirmed_state_dir || '';
  if (!candidate) {
    throw new DiscordThreadError(
      'state_dir_unconfirmed',
      'DISCORD_STATE_DIR is not set and confirmed_state_dir is absent; run thiscodex init first',
    );
  }
  if (!isAbsolute(candidate)) {
    throw new DiscordThreadError('state_dir_unconfirmed', 'Discord state directory must be absolute');
  }
  return resolve(candidate);
}

export function readDiscordBotToken(stateDir, read = readFileSync) {
  try {
    return tokenFromEnvText(read(join(stateDir, '.env'), 'utf8'));
  } catch (error) {
    if (error instanceof DiscordThreadError) throw error;
    throw new DiscordThreadError('token_missing', 'Could not read DISCORD_BOT_TOKEN from the confirmed Discord state .env');
  }
}

function safeText(value, token) {
  const text = String(value ?? '');
  return token ? text.replaceAll(token, '[REDACTED]') : text;
}

async function responseBody(response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function failureResult(response, payload, token, options) {
  const status = Number(response.status || 0);
  const code = Number(payload.json?.code);
  const message = safeText(payload.json?.message || payload.text || `HTTP ${status}`, token).slice(0, 500);
  const base = { ok: false, status, discord_code: Number.isFinite(code) ? code : null, message };

  if (code === 50001) {
    return { ...base, code: 'channel_not_accessible', next: 'Check bot membership, VIEW_CHANNEL, and channel permission overwrites.' };
  }
  if (code === 50013) {
    const permission = options.mode === 'private' ? 'CREATE_PRIVATE_THREADS' : 'CREATE_PUBLIC_THREADS';
    return { ...base, code: 'permission_denied', next: `Grant ${permission}; grant SEND_MESSAGES_IN_THREADS before posting in the new thread.` };
  }
  if (code === 160004) {
    return { ...base, code: 'already_exists', next: 'Use the existing thread attached to this message; do not retry creation.' };
  }
  if ([160006, 160007].includes(code)) {
    return { ...base, code: 'capacity_exhausted', next: 'Archive an inactive thread, then retry explicitly.' };
  }
  if (code === 50024 || status === 405) {
    return { ...base, code: 'unsupported_surface', next: 'Correct the channel type or choose the forum/media thread path.' };
  }
  if (status === 403 && !payload.json) {
    return { ...base, code: 'user_agent_rejected', next: 'Restore the fixed DiscordBot ($url, $version) User-Agent header.' };
  }
  if (status === 401 || code === 50014) {
    return { ...base, code: 'auth_invalid', next: 'Replace the bot token in the confirmed Discord state .env without exposing it to the model.' };
  }
  if (status === 404 || [10003, 10008].includes(code)) {
    return { ...base, code: 'target_not_found', next: 'Recheck the channel and message snowflakes.' };
  }
  if (status === 429) {
    return { ...base, code: 'rate_limited', retry_after: payload.json?.retry_after ?? null, next: 'Wait for retry_after; do not loop.' };
  }
  if (status === 400 || code === 50035) {
    return { ...base, code: 'invalid_request', next: 'Correct the named request field; do not retry unchanged.' };
  }
  return { ...base, code: 'api_error', next: 'Inspect the status and Discord code before retrying.' };
}

function successResult(payload, plan, options) {
  const id = String(payload?.id ?? '');
  const parentId = String(payload?.parent_id ?? '');
  const type = Number(payload?.type);
  if (!SNOWFLAKE_RE.test(id) || parentId !== options.channelId || type !== plan.expectedType) {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Discord returned a thread object that does not match the requested parent or thread type.',
    };
  }
  return {
    ok: true,
    dry_run: false,
    mode: options.mode,
    thread_id: id,
    parent_id: parentId,
    thread_type: type,
    name: String(payload.name ?? options.name),
  };
}

export async function executeDiscordThread(options, {
  packageVersion = '0.0.0',
  env = process.env,
  installState = {},
  fetchImpl = globalThis.fetch,
  tokenLoader,
} = {}) {
  const plan = buildDiscordThreadPlan(options, packageVersion);
  if (!options.apply) {
    return {
      ok: true,
      dry_run: true,
      mode: options.mode,
      request: { method: plan.method, url: plan.url, headers: plan.headers, body: plan.body },
      next: 'Review the plan, then repeat with --apply to create the thread.',
    };
  }

  if (typeof fetchImpl !== 'function') {
    throw new DiscordThreadError('transport_unavailable', 'This Node runtime does not expose fetch');
  }
  const stateDir = resolveDiscordStateDir(env, installState);
  const token = tokenLoader ? tokenLoader(stateDir) : readDiscordBotToken(stateDir);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(plan.url, {
      method: plan.method,
      headers: { ...plan.headers, Authorization: `Bot ${token}` },
      body: JSON.stringify(plan.body),
      signal: controller.signal,
    });
    const payload = await responseBody(response);
    if (!response.ok) return failureResult(response, payload, token, options);
    if (!payload.json) {
      return { ok: false, code: 'invalid_response', message: 'Discord success response was not JSON.' };
    }
    return successResult(payload.json, plan, options);
  } catch (error) {
    return {
      ok: false,
      code: 'indeterminate_transport',
      message: safeText(error?.message || 'Discord request ended without a confirmed response.', token),
      next: 'Check existing channel threads before any explicit retry to avoid duplicates.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function cliErrorResult(error) {
  if (error instanceof DiscordThreadError) {
    return { ok: false, code: error.code, message: error.message, ...error.details };
  }
  return { ok: false, code: 'internal_error', message: String(error?.message || error) };
}
