import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFlow, evaluateWhen } from '../../scripts/lib/flow-runner.mjs';

const steps = [
  { id: 'b', order: 20, when: 'always', action: 'check', reason: 'B', safety: 'none', verify: { type: 'pass' }, on_fail: { next_command: 'fix-b' } },
  { id: 'a', order: 10, when: 'always', action: 'check', reason: 'A', safety: 'none', verify: { type: 'pass' }, on_fail: { next_command: 'fix-a' } },
];

test('evaluateWhen supports always, os, mode, answer, and tool conditions', () => {
  const ctx = { os: 'wsl', mode: 'apply', answers: { alias_consent: 'yes' }, tools: { tmux: false } };
  assert.equal(evaluateWhen('always', ctx), true);
  assert.equal(evaluateWhen("os == 'wsl'", ctx), true);
  assert.equal(evaluateWhen("mode == 'doctor'", ctx), false);
  assert.equal(evaluateWhen("mode == 'doctor' or mode == 'smoke'", { ...ctx, mode: 'doctor' }), true);
  assert.equal(evaluateWhen("mode == 'doctor' or mode == 'smoke'", { ...ctx, mode: 'smoke' }), true);
  assert.equal(evaluateWhen("os == 'wsl' and tools.tmux == false", ctx), true);
  assert.equal(evaluateWhen("answers.alias_consent == 'yes'", ctx), true);
  assert.equal(evaluateWhen('tools.tmux == false', ctx), true);
});

test('runner obeys manifest order and verify gate', async () => {
  const events = [];
  const result = await runFlow({ steps, ctx: { mode: 'check', os: 'mac', answers: {}, tools: {} }, handlers: {
    action: async step => events.push(`action:${step.id}`),
    verify: async () => ({ ok: true }),
    explain: step => events.push(`reason:${step.id}`),
  }});
  assert.equal(result.ok, true);
  assert.deepEqual(events, ['reason:a', 'action:a', 'reason:b', 'action:b']);
});

test('runner stops on failed required step with next command', async () => {
  const result = await runFlow({ steps, ctx: { mode: 'check', os: 'mac', answers: {}, tools: {} }, handlers: {
    action: async () => {},
    verify: async step => step.id === 'a' ? { ok: false, message: 'bad' } : { ok: true },
    explain: () => {},
  }});
  assert.equal(result.ok, false);
  assert.equal(result.failed_step, 'a');
  assert.equal(result.next_command, 'fix-a');
});

test('non-TTY consent-gated apply does not run without consent', async () => {
  const gated = [{ id: 'danger', order: 1, when: 'always', action: 'apply', reason: 'Danger', safety: 'consent-gated', verify: { type: 'pass' }, on_fail: { next_command: 'rerun --yes' } }];
  let ran = false;
  const result = await runFlow({ steps: gated, ctx: { mode: 'apply', os: 'mac', answers: {}, tools: {}, tty: false, yes: false }, handlers: {
    action: async () => { ran = true; },
    verify: async () => ({ ok: true }),
    explain: () => {},
  }});
  assert.equal(ran, false);
  assert.equal(result.ok, false);
  assert.equal(result.next_command, 'rerun --yes');
});

test('non-TTY check mode shows consent-gated guidance without failing', async () => {
  const gated = [{ id: 'tmux_install_consent', order: 1, when: 'always', action: 'guide', reason: 'tmux reason', safety: 'consent-gated', verify: { type: 'tmux-present-or-guide-shown' }, on_fail: { next_command: 'install tmux' } }];
  let verified = false;
  const result = await runFlow({ steps: gated, ctx: { mode: 'check', os: 'mac', answers: {}, tools: {}, tty: false, yes: false }, handlers: {
    action: async () => {},
    verify: async () => {
      verified = true;
      return { ok: true };
    },
    explain: () => {},
  }});
  assert.equal(result.ok, true);
  assert.equal(verified, true);
});
