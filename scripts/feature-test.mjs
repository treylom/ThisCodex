#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  SKIP: 'SKIP',
};

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fileExists(relPath) {
  return existsSync(join(repoRoot, relPath));
}

function pass(message) {
  return { status: STATUS.PASS, message };
}

function fail(message) {
  return { status: STATUS.FAIL, message };
}

function skip(message) {
  return { status: STATUS.SKIP, message };
}

function requireFiles(paths) {
  const missing = paths.filter((relPath) => !fileExists(relPath));
  if (missing.length > 0) {
    return fail(`missing required file(s): ${missing.join(', ')}`);
  }
  return null;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function commandAvailable(command, args = ['--version']) {
  const result = run(command, args);
  return !result.error;
}

function compilePython(relPath) {
  const missing = requireFiles([relPath]);
  if (missing) return missing;
  if (!commandAvailable('python3', ['--version'])) {
    return skip('python3 unavailable; syntax smoke skipped');
  }
  const result = run('python3', ['-m', 'py_compile', relPath]);
  if (result.status !== 0) {
    return fail(`${relPath} failed py_compile`);
  }
  return pass(`${relPath} py_compile passed`);
}

function bashSyntax(paths) {
  const missing = requireFiles(paths);
  if (missing) return missing;
  if (!commandAvailable('bash', ['--version'])) {
    return skip('bash unavailable; shell syntax smoke skipped');
  }
  for (const relPath of paths) {
    const result = run('bash', ['-n', relPath]);
    if (result.status !== 0) {
      return fail(`${relPath} failed bash -n`);
    }
  }
  return pass(`${paths.length} hook shell file(s) passed bash -n`);
}

function parseJson(relPath) {
  const missing = requireFiles([relPath]);
  if (missing) return missing;
  try {
    JSON.parse(readFileSync(join(repoRoot, relPath), 'utf8'));
    return pass(`${relPath} parses as JSON`);
  } catch (error) {
    return fail(`${relPath} JSON parse failed: ${error.message}`);
  }
}

function countMarkdownFiles(relPath) {
  try {
    return readdirSync(join(repoRoot, relPath)).filter((name) => name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

const FEATURES = [
  {
    id: 'memory',
    aliases: ['memory', 'dreaming', 'archive', 'cold storage'],
    run() {
      return compilePython('scripts/memory_dreaming.py');
    },
  },
  {
    id: 'tmux',
    aliases: ['tmux', 'terminal', 'pane', 'daemon'],
    run() {
      if (!commandAvailable('tmux', ['-V'])) {
        return skip('tmux unavailable on this host');
      }
      return pass('tmux binary is available');
    },
  },
  {
    id: 'graphrag',
    aliases: ['graphrag', 'graph rag', 'obsidian', 'vault search', 'graph'],
    run() {
      return compilePython('scripts/obsidian_cli_wrapper.py');
    },
  },
  {
    id: 'graphrag-bench',
    aliases: ['graphrag bench', 'graph rag bench', 'benchmark', 'bench'],
    run() {
      const base = compilePython('scripts/obsidian_cli_wrapper.py');
      if (base.status === STATUS.FAIL) return base;
      if (process.env.THISCODEX_RUN_GRAPHRAG_BENCH !== '1') {
        return skip('benchmark disabled; set THISCODEX_RUN_GRAPHRAG_BENCH=1 to run it');
      }
      return pass('benchmark prerequisites available');
    },
  },
  {
    id: 'meeting',
    aliases: ['meeting', 'meeting protocol', 'watchdog', 'thread'],
    run() {
      const missing = requireFiles([
        'docs/05-meeting-thread-protocol.md',
        'rules/meeting-protocol.md',
        'scripts/meeting_watchdog.py',
      ]);
      if (missing) return missing;
      return compilePython('scripts/meeting_watchdog.py');
    },
  },
  {
    id: 'rules',
    aliases: ['rules', 'rules system', 'meeting rules', 'index'],
    run() {
      const missing = requireFiles(['rules/INDEX.md', 'docs/rules-system.md']);
      if (missing) return missing;
      const count = countMarkdownFiles('rules');
      if (count < 5) {
        return fail(`rules directory has too few markdown files: ${count}`);
      }
      return pass(`rules directory has ${count} markdown file(s)`);
    },
  },
  {
    id: 'hooks',
    aliases: ['hooks', 'session hook', 'stop hook', 'bot session'],
    run() {
      return bashSyntax(['hooks/bot-session-init.sh', 'hooks/meeting-stop-reread.sh']);
    },
  },
  {
    id: 'install',
    aliases: ['install', 'installer', 'setup', 'manifest', 'init'],
    run() {
      const missing = requireFiles([
        'bin/thiscodex.mjs',
        'install/thiscodex.install.json',
        'scripts/lib/manifest.mjs',
        'scripts/lib/flow-runner.mjs',
      ]);
      if (missing) return missing;
      return parseJson('install/thiscodex.install.json');
    },
  },
];

function scoreFeature(feature, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  const candidates = [feature.id, ...feature.aliases].map(normalize);
  if (candidates.includes(normalizedQuery)) return 100;
  if (normalizedQuery.split(' ').includes(normalize(feature.id))) return 90;
  for (const candidate of candidates) {
    if (normalizedQuery.includes(candidate) || candidate.includes(normalizedQuery)) return 80;
    const words = candidate.split(' ').filter(Boolean);
    if (words.length > 0 && words.every((word) => normalizedQuery.includes(word))) return 60;
  }
  return 0;
}

function selectFeatures(args) {
  const includeBench = args.includes('--bench') || args.includes('all');
  const query = args.filter((arg) => arg !== '--bench').join(' ').trim();
  if (!query) {
    return FEATURES.filter((feature) => includeBench || feature.id !== 'graphrag-bench');
  }
  if (normalize(query) === 'all') {
    return FEATURES;
  }

  const ranked = FEATURES.map((feature) => ({
    feature,
    score: scoreFeature(feature, query),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.feature.id.localeCompare(b.feature.id));

  if (ranked.length === 0) {
    const known = FEATURES.map((feature) => feature.id).join(', ');
    throw new Error(`unknown feature query: "${query}". Known features: ${known}`);
  }
  return [ranked[0].feature];
}

function runSelected(features) {
  return features.map((feature) => {
    let outcome;
    try {
      outcome = feature.run();
    } catch (error) {
      outcome = fail(error instanceof Error ? error.message : String(error));
    }
    return { id: feature.id, ...outcome };
  });
}

function printResults(results) {
  for (const result of results) {
    console.log(`${result.status} ${result.id} - ${result.message}`);
  }
  const counts = {
    PASS: results.filter((result) => result.status === STATUS.PASS).length,
    FAIL: results.filter((result) => result.status === STATUS.FAIL).length,
    SKIP: results.filter((result) => result.status === STATUS.SKIP).length,
  };
  console.log(
    `Summary: PASS ${counts.PASS} / SKIP ${counts.SKIP} / FAIL ${counts.FAIL} / TOTAL ${results.length}`,
  );
  return counts.FAIL === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  let selected;
  try {
    selected = selectFeatures(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const results = runSelected(selected);
  return printResults(results);
}

process.exitCode = main();
