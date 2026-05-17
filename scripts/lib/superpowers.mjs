import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function detectSuperpowers(env = process.env) {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  const path = join(home, '.codex', 'plugins', 'cache', 'openai-curated', 'superpowers');
  return {
    present: existsSync(path),
    path,
    next_command: 'Enable the Codex Superpowers plugin, then rerun: thiscodex init --apply',
  };
}
