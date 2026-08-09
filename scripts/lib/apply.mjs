import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export function backupFile(path) {
  const bak = `${path}.thiscodex.bak`;
  if (existsSync(path)) copyFileSync(path, bak);
  return bak;
}

export function listSkillNames(repoRoot) {
  const root = join(repoRoot, 'skills');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(root, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();
}

export function planSkillInstall(repoRoot, home, layer = 'user', name = 'thiscodex') {
  const source = join(repoRoot, 'skills', name);
  const dest = layer === 'repo'
    ? join(repoRoot, '.agents', 'skills', name)
    : join(home, '.agents', 'skills', name);
  return { source, dest, layer, name };
}

export function applySkillInstall(repoRoot, home, layer = 'user') {
  const names = listSkillNames(repoRoot);
  const installed = [];
  let primary = null;
  for (const name of names.length ? names : ['thiscodex']) {
    const plan = planSkillInstall(repoRoot, home, layer, name);
    mkdirSync(plan.dest, { recursive: true });
    cpSync(plan.source, plan.dest, { recursive: true });
    installed.push(name);
    if (name === 'thiscodex') primary = plan;
  }
  primary ||= planSkillInstall(repoRoot, home, layer, installed[0] || 'thiscodex');
  return { ...primary, installed };
}

export function patchCodexConfig(home, dryRun = true, opts = {}) {
  const dir = join(home, '.codex');
  const cfg = join(dir, 'config.toml');
  const lines = ['project_doc_fallback_filenames = ["SOUL.md", "AGENTS.md"]'];
  if (opts.yoloCeiling) {
    lines.push('sandbox_mode = "danger-full-access"');
    lines.push('approval_policy = "never"');
  }
  const before = existsSync(cfg) ? readFileSync(cfg, 'utf8') : '';
  const missing = lines.filter(line => !before.includes(line.split(' = ')[0]));
  if (!missing.length) return { path: cfg, changed: false, reason: 'already present' };
  const preview = missing.join('\n') + '\n';
  if (dryRun) return { path: cfg, changed: true, dryRun: true, preview };
  mkdirSync(dir, { recursive: true });
  if (existsSync(cfg)) backupFile(cfg);
  const next = before.trimEnd() + (before.trim() ? '\n' : '') + preview;
  writeFileSync(cfg, next);
  return { path: cfg, changed: true };
}

export function marketplaceHint(repoRoot, wantMarketplace) {
  if (!wantMarketplace) return null;
  return `codex plugin marketplace add ${join(repoRoot, '.codex-plugin')}`;
}
