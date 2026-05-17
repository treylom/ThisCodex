import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export function backupFile(path) {
  const bak = `${path}.thiscodex.bak`;
  if (existsSync(path)) copyFileSync(path, bak);
  return bak;
}

export function planSkillInstall(repoRoot, home, layer = 'user') {
  const source = join(repoRoot, 'skills', 'thiscodex');
  const dest = layer === 'repo'
    ? join(repoRoot, '.agents', 'skills', 'thiscodex')
    : join(home, '.agents', 'skills', 'thiscodex');
  return { source, dest, layer };
}

export function applySkillInstall(repoRoot, home, layer = 'user') {
  const plan = planSkillInstall(repoRoot, home, layer);
  mkdirSync(plan.dest, { recursive: true });
  cpSync(plan.source, plan.dest, { recursive: true });
  return plan;
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
