import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBotFiles, materializeBotFiles, aliasBlock } from '../../scripts/lib/materialize.mjs';

test('planBotFiles rejects provisional BOT_WD', () => {
  assert.throws(() => planBotFiles({
    confirmed_repo_root: '/repo',
    confirmed_bot_wd: ['/', 'home', 'tofu', ['thiscodex', 'current', 'bot'].join('-')].join('/'),
    confirmed_state_dir: '/state',
  }), /provisional/);
});

test('materializeBotFiles writes run and infra launch files with parameterized paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const bot = mkdtempSync(join(tmpdir(), 'tcx-bot-'));
  const state = mkdtempSync(join(tmpdir(), 'tcx-state-'));
  const files = materializeBotFiles({ confirmed_repo_root: root, confirmed_bot_wd: bot, confirmed_state_dir: state });
  assert.ok(existsSync(files.run));
  assert.match(readFileSync(files.run, 'utf8'), new RegExp(`BOT_WD="${bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(readFileSync(files.infra, 'utf8'), /DISCORD_STATE_DIR=/);
  rmSync(root, { recursive: true, force: true });
  rmSync(bot, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

test('aliasBlock enters confirmed repo root and confirmed BOT_WD', () => {
  const text = aliasBlock({ confirmed_repo_root: '/repo/ThisCodex', confirmed_bot_wd: '/bots/sonseokhee', session: 'thiscodex' });
  assert.ok(text.includes("cd '/repo/ThisCodex'"));
  assert.ok(text.includes("BOT_WD='/bots/sonseokhee'"));
  assert.doesNotMatch(text, new RegExp(['thiscodex', 'current', 'bot'].join('-')));
});

test('aliasBlock gives a tmux-only Discord flow and YOLO helpers without cmux', () => {
  const text = aliasBlock({
    confirmed_repo_root: '/repo/ThisCodex',
    confirmed_bot_wd: '/bots/sonseokhee',
    confirmed_state_dir: '/state/discord-sonseokhee',
    session: 'thiscodex',
  });
  assert.match(text, /thiscodex-discord/);
  assert.match(text, /thiscodex-yolo-on/);
  assert.match(text, /thiscodex-yolo-off/);
  assert.match(text, /tmux attach/);
  assert.doesNotMatch(text, /cmux/i);
});
