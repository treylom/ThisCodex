import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msg, MESSAGES } from '../../scripts/lib/i18n.mjs';

test('plain is default', () => {
  assert.equal(msg('placement'), MESSAGES.placement.plain);
});

test('dev mode selectable', () => {
  assert.equal(msg('placement', 'dev'), MESSAGES.placement.dev);
});

test('all messages have plain and dev strings', () => {
  for (const [key, value] of Object.entries(MESSAGES)) {
    assert.ok(value.plain, `${key}.plain missing`);
    assert.ok(value.dev, `${key}.dev missing`);
  }
});

test('unknown key throws', () => {
  assert.throws(() => msg('missing_key'));
});

test('friendly messages include reason-first installer language', () => {
  assert.match(msg('non_tty_next_command'), /자동화|next command|다음 명령/i);
  assert.match(msg('wsl_first_reason'), /WSL|tmux|Linux/i);
  assert.match(msg('tmux_one_line_consent'), /한 줄|one command|tmux/i);
});
