import { createHash } from 'node:crypto';

const ROOT = '${PLUGIN_ROOT}';

export const REQUIRED_HOOKS = Object.freeze([
  'bot-session-init.sh',
  'rule-router.sh',
  'dispatch-room-gate.py',
  'automation-handoff-gate.py',
  'automation-no-interactive.sh',
  'verify-before-push.sh',
  'meeting-stop-reread.sh',
  'reply-gate.sh',
  'completion-gate.sh',
  'dispatch-verify.sh',
  'kst-timestamp.sh',
]);

const handler = (id, file, timeout) => ({
  type: 'command',
  command: `bash "${ROOT}/hooks/lib/bot-only.sh" "${id}" "${ROOT}/hooks/${file}"`,
  timeout,
});

export const HOOKS_CONTRACT = Object.freeze({
  SessionStart: [{
    hooks: [handler('bot-session-init', 'bot-session-init.sh', 10)],
  }],
  UserPromptSubmit: [{
    hooks: [handler('rule-router', 'rule-router.sh', 5)],
  }],
  PreToolUse: [
    {
      matcher: 'mcp__discord__reply|mcp__discord__edit_message|mcp__plugin_discord_discord__reply|mcp__plugin_discord_discord__edit_message',
      hooks: [
        handler('dispatch-room-gate', 'dispatch-room-gate.py', 5),
        handler('automation-handoff-gate', 'automation-handoff-gate.py', 5),
      ],
    },
    {
      matcher: 'AskUserQuestion|request_user_input',
      hooks: [handler('automation-no-interactive', 'automation-no-interactive.sh', 5)],
    },
    {
      matcher: 'Bash|exec_command',
      hooks: [handler('verify-before-push', 'verify-before-push.sh', 10)],
    },
  ],
  Stop: [{
    hooks: [
      handler('meeting-stop-reread', 'meeting-stop-reread.sh', 5),
      handler('reply-gate', 'reply-gate.sh', 5),
      handler('completion-gate', 'completion-gate.sh', 5),
      handler('dispatch-verify', 'dispatch-verify.sh', 5),
      handler('kst-timestamp', 'kst-timestamp.sh', 5),
    ],
  }],
});

export function hooksDocument() {
  return {
    description: 'ThisCodex bot hooks — plugin-discovered and guarded by DISCORD_STATE_DIR so ordinary Codex sessions stay silent.',
    hooks: HOOKS_CONTRACT,
  };
}

export function renderedHooksJson() {
  return `${JSON.stringify(hooksDocument(), null, 2)}\n`;
}

export function hookEventKey(event) {
  return String(event).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function hookTrustHash(event, matcher, hook) {
  const normalizedHook = {
    type: hook.type,
    command: hook.command,
    timeout: Math.max(1, Number(hook.timeout ?? 600)),
    async: Boolean(hook.async),
  };
  if (hook.statusMessage !== undefined) normalizedHook.status_message = hook.statusMessage;
  if (hook.additionalContextLimit !== undefined && hook.additionalContextLimit !== 2500) {
    normalizedHook.additional_context_limit = hook.additionalContextLimit;
  }
  const identity = {
    event_name: hookEventKey(event),
    ...(matcher === undefined || matcher === null ? {} : { matcher }),
    hooks: [normalizedHook],
  };
  const bytes = JSON.stringify(canonical(identity));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function flattenHooks(document = hooksDocument()) {
  const out = [];
  for (const [event, groups] of Object.entries(document.hooks || {})) {
    groups.forEach((group, groupIndex) => {
      (group.hooks || []).forEach((hook, hookIndex) => out.push({
        event,
        eventKey: hookEventKey(event),
        groupIndex,
        hookIndex,
        matcher: ['UserPromptSubmit', 'Stop', 'Interrupt'].includes(event)
          ? null
          : (group.matcher ?? null),
        hook,
      }));
    });
  }
  return out;
}

export function pluginTrustKey(pluginId, event, groupIndex, hookIndex, source = 'hooks/hooks.json') {
  return `${pluginId}:${source}:${hookEventKey(event)}:${groupIndex}:${hookIndex}`;
}
