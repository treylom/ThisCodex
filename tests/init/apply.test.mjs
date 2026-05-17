import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSkillInstall, applySkillInstall, patchCodexConfig, backupFile } from '../../scripts/lib/apply.mjs';

test('planSkillInstall maps repo skills/thiscodex to user layer', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  mkdirSync(join(repo, 'skills', 'thiscodex'), { recursive: true });
  writeFileSync(join(repo, 'skills', 'thiscodex', 'SKILL.md'), '# skill');
  const p = planSkillInstall(repo, home, 'user');
  assert.equal(p.dest, join(home, '.agents', 'skills', 'thiscodex'));
  assert.equal(p.source, join(repo, 'skills', 'thiscodex'));
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('applySkillInstall copies SKILL.md idempotently', () => {
  const repo = mkdtempSync(join(tmpdir(), 'tcx-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  mkdirSync(join(repo, 'skills', 'thiscodex'), { recursive: true });
  writeFileSync(join(repo, 'skills', 'thiscodex', 'SKILL.md'), '# skill');
  const r = applySkillInstall(repo, home, 'user');
  assert.equal(readFileSync(join(r.dest, 'SKILL.md'), 'utf8'), '# skill');
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('patchCodexConfig backs up and adds project_doc_fallback_filenames', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const dir = join(home, '.codex');
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, 'config.toml');
  writeFileSync(cfg, 'model = "gpt-5.5"\n');
  const result = patchCodexConfig(home, false);
  assert.equal(result.changed, true);
  assert.ok(existsSync(`${cfg}.thiscodex.bak`));
  assert.match(readFileSync(cfg, 'utf8'), /project_doc_fallback_filenames/);
  rmSync(home, { recursive: true, force: true });
});

test('patchCodexConfig previews YOLO ceiling but does not write in dry-run', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = patchCodexConfig(home, true, { yoloCeiling: true });
  assert.equal(result.changed, true);
  assert.match(result.preview, /sandbox_mode = "danger-full-access"/);
  assert.equal(existsSync(join(home, '.codex', 'config.toml')), false);
  rmSync(home, { recursive: true, force: true });
});

test('patchCodexConfig writes sandbox ceiling only with explicit YOLO opt-in', () => {
  const home = mkdtempSync(join(tmpdir(), 'tcx-home-'));
  const result = patchCodexConfig(home, false, { yoloCeiling: true });
  assert.equal(result.changed, true);
  const text = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /sandbox_mode = "danger-full-access"/);
  assert.match(text, /approval_policy = "never"/);
  rmSync(home, { recursive: true, force: true });
});

test('backupFile creates backup copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tcx-'));
  const f = join(dir, 'x.txt');
  writeFileSync(f, 'x');
  const b = backupFile(f);
  assert.equal(readFileSync(b, 'utf8'), 'x');
  rmSync(dir, { recursive: true, force: true });
});
