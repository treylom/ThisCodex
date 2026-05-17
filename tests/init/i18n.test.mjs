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
