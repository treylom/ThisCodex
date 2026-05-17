import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { platform, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export function detectOS() {
  const p = platform();
  if (p === 'darwin') return 'mac';
  if (p === 'win32') return 'win';
  if (p === 'linux') {
    try {
      if (/microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'))) return 'wsl';
    } catch {}
    return 'linux';
  }
  return 'linux';
}

export function whichSync(bin, env = process.env) {
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const s of suffixes) {
      const candidate = join(dir, bin + s);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function codexHome(env = process.env) {
  return env.CODEX_HOME || join(env.HOME || homedir(), '.codex');
}

export function detectCodexAuth(env = process.env) {
  const path = join(codexHome(env), 'auth.json');
  return { path, present: existsSync(path) };
}

export function detectCodexConfig(env = process.env) {
  const path = join(codexHome(env), 'config.toml');
  return { path, present: existsSync(path) };
}

export function detectPluginCapability(helpText = null) {
  let text = helpText;
  if (text === null) {
    try {
      text = execFileSync('codex', ['plugin', '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      text = `${e.stdout || ''}\n${e.stderr || ''}`;
    }
  }
  return {
    marketplace: /\bmarketplace\b/.test(text),
    install: /\binstall\b/.test(text),
  };
}

export function detectEnv(env = process.env) {
  const tools = {
    git: !!whichSync('git', env),
    codex: !!whichSync('codex', env),
    node: !!whichSync('node', env),
    tmux: !!whichSync('tmux', env),
    python: !!whichSync('python3', env),
  };
  const plugin = tools.codex ? detectPluginCapability() : { marketplace: false, install: false };
  return {
    os: detectOS(),
    node: process.versions.node,
    tools,
    codexAuth: detectCodexAuth(env),
    codexConfig: detectCodexConfig(env),
    codexPlugin: plugin,
  };
}
