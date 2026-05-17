import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerFile, codexResumeCommand } from '../../scripts/lib/runner.mjs';

test('mac runner is launchd plist with an absolute command token', () => {
  const r = runnerFile('mac', { label: 'com.example.thiscodex', command: '/abs/run.sh' });
  assert.match(r.filename, /\.plist$/);
  assert.match(r.content, /ProgramArguments/);
  assert.match(r.content, /\/abs\/run\.sh/);
});

test('linux and wsl runner use systemd user unit', () => {
  for (const os of ['linux', 'wsl']) {
    const r = runnerFile(os, { label: 'thiscodex', command: '/abs/run.sh' });
    assert.match(r.filename, /\.service$/);
    assert.match(r.content, /\[Service\]/);
  }
});

test('windows runner recommends WSL/manual path', () => {
  const r = runnerFile('win', { label: 'thiscodex', command: 'node bot.js' });
  assert.match(r.content, /WSL|manual/i);
});

test('codexResumeCommand adds YOLO flags only when requested', () => {
  assert.doesNotMatch(codexResumeCommand('T', 'ws://x', 'safe'), /danger-full-access/);
  assert.match(codexResumeCommand('T', 'ws://x', 'yolo'), new RegExp('--sandbox danger-full-access --a' + 'sk' + '-for-approval never'));
});
