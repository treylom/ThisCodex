import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function detectWindowsProfiles(root = '/mnt/c/Users') {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(root, entry.name))
    .sort();
}

export function windowsSkillPath(profileDir) {
  return join(profileDir, '.agents', 'skills', 'thiscodex');
}

export function syncWindowsSkill({ sourceSkillDir, profileDir }) {
  const dest = windowsSkillPath(profileDir);
  mkdirSync(dest, { recursive: true });
  cpSync(sourceSkillDir, dest, { recursive: true, force: true });
  return { dest };
}

export function verifyWindowsSkillSync({ sourceSkillDir, profileDir }) {
  const source = join(sourceSkillDir, 'SKILL.md');
  const dest = join(windowsSkillPath(profileDir), 'SKILL.md');
  if (!existsSync(dest)) return { ok: false, message: 'Windows skill SKILL.md missing' };
  return readFileSync(source, 'utf8') === readFileSync(dest, 'utf8')
    ? { ok: true }
    : { ok: false, message: 'Windows skill SKILL.md does not match source' };
}
