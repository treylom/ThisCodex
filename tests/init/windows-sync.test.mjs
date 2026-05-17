import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectWindowsProfiles,
  syncWindowsSkill,
  verifyWindowsSkillSync,
  windowsSkillPath,
} from '../../scripts/lib/windows-sync.mjs';

test('detectWindowsProfiles lists user directories under Windows root', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-win-'));
  mkdirSync(join(root, 'Alice'), { recursive: true });
  mkdirSync(join(root, 'Public'), { recursive: true });
  assert.deepEqual(detectWindowsProfiles(root), [join(root, 'Alice'), join(root, 'Public')]);
  rmSync(root, { recursive: true, force: true });
});

test('syncWindowsSkill copies thiscodex skill without deleting siblings', () => {
  const root = mkdtempSync(join(tmpdir(), 'tcx-win-'));
  const source = mkdtempSync(join(tmpdir(), 'tcx-skill-'));
  const profile = join(root, 'Alice');
  mkdirSync(profile, { recursive: true });
  mkdirSync(join(profile, '.agents', 'skills', 'other'), { recursive: true });
  writeFileSync(join(profile, '.agents', 'skills', 'other', 'SKILL.md'), 'keep');
  writeFileSync(join(source, 'SKILL.md'), 'thiscodex skill');
  const result = syncWindowsSkill({ sourceSkillDir: source, profileDir: profile });
  assert.equal(result.dest, windowsSkillPath(profile));
  assert.equal(readFileSync(join(result.dest, 'SKILL.md'), 'utf8'), 'thiscodex skill');
  assert.equal(readFileSync(join(profile, '.agents', 'skills', 'other', 'SKILL.md'), 'utf8'), 'keep');
  assert.equal(verifyWindowsSkillSync({ sourceSkillDir: source, profileDir: profile }).ok, true);
  rmSync(root, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test('verifyWindowsSkillSync reports missing Windows skill', () => {
  const source = mkdtempSync(join(tmpdir(), 'tcx-skill-'));
  const profile = mkdtempSync(join(tmpdir(), 'tcx-profile-'));
  writeFileSync(join(source, 'SKILL.md'), 'thiscodex skill');
  const result = verifyWindowsSkillSync({ sourceSkillDir: source, profileDir: profile });
  assert.equal(result.ok, false);
  assert.match(result.message, /Windows skill/i);
  assert.equal(existsSync(windowsSkillPath(profile)), false);
  rmSync(source, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
});
