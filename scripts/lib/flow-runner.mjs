import { sortSteps } from './manifest.mjs';

function readPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function parseValue(raw) {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  if (value === 'false') return false;
  if (value === 'true') return true;
  return value;
}

export function evaluateWhen(expr, ctx) {
  if (!expr || expr === 'always') return true;
  // Split on bare ` or `/` and ` — manifest conditions carry no quoted or/and literals.
  const orParts = expr.split(/\s+or\s+/);
  if (orParts.length > 1) return orParts.some(part => evaluateWhen(part, ctx));
  const andParts = expr.split(/\s+and\s+/);
  if (andParts.length > 1) return andParts.every(part => evaluateWhen(part, ctx));
  const match = expr.match(/^([a-zA-Z0-9_.]+)\s*==\s*(.+)$/);
  if (!match) throw new Error(`unsupported when expression: ${expr}`);
  return readPath(ctx, match[1]) === parseValue(match[2]);
}

export function hasConsent(step, ctx) {
  if (step.safety !== 'consent-gated') return true;
  if (ctx.yes === true) return true;
  const answer = ctx.answers?.[step.id] ?? ctx.answers?.[step.verify?.state_key];
  return ['yes', 'apply', 'config_ceiling_patch'].includes(answer);
}

export async function runFlow({ steps, ctx, handlers }) {
  const events = [];
  for (const step of sortSteps(steps)) {
    if (!evaluateWhen(step.when, ctx)) {
      events.push({ id: step.id, status: 'skipped' });
      continue;
    }
    handlers.explain?.(step, ctx);
    if (ctx.mode === 'apply' && (ctx.tty === false || ctx.nonInteractive === true) && step.safety === 'consent-gated' && !hasConsent(step, ctx)) {
      return {
        ok: false,
        failed_step: step.id,
        reason: 'consent required',
        next_command: step.on_fail.next_command,
        events,
      };
    }
    await handlers.action(step, ctx);
    const verified = await handlers.verify(step, ctx);
    if (!verified.ok) {
      return {
        ok: false,
        failed_step: step.id,
        reason: verified.message || 'verification failed',
        next_command: step.on_fail.next_command,
        events,
      };
    }
    events.push({ id: step.id, status: 'passed' });
  }
  return { ok: true, events };
}
