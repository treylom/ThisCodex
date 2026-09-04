import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_HOOKS,
  flattenHooks,
  hookTrustHash,
  hooksDocument,
  pluginTrustKey,
  renderedHooksJson,
} from './hooks-contract.mjs';

const DEFAULT_REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathFromCommand(command, name, home) {
  const quoted = new RegExp(`["']([^"']*[\\\\/]${escapeRe(name)})["']`).exec(command)?.[1];
  const unquoted = new RegExp(`(?:^|\\s)([^\\s"']*[\\\\/]${escapeRe(name)})(?=\\s|$)`).exec(command)?.[1];
  const raw = quoted || unquoted || '';
  if (!raw) return '';
  return raw;
}

function concreteLegacyPath(raw, home) {
  if (!raw || /[$%]/.test(raw)) return '';
  if (raw.startsWith('~/')) return join(home, raw.slice(2));
  return isAbsolute(raw) ? raw : resolve(raw);
}

function siblingManifestOwns(candidate, productName) {
  if (!candidate || basename(dirname(candidate)).toLowerCase() !== 'hooks') return false;
  const root = dirname(dirname(candidate));
  for (const manifest of [
    join(root, '.codex-plugin', 'plugin.json'),
    join(root, '.claude-plugin', 'plugin.json'),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
      if (String(parsed?.name || '').toLowerCase() === productName) return true;
    } catch {
      // A missing or unreadable sibling manifest is not ownership evidence.
    }
  }
  return false;
}

export function classifyLegacyCommand(command, { home = '', productName = 'thiscodex' } = {}) {
  const text = String(command || '');
  const name = REQUIRED_HOOKS.find(candidate => new RegExp(`(?:^|[\\\\/])${escapeRe(candidate)}(?=["'\\s]|$)`).test(text));
  if (!name) return { kind: 'unrelated', basename: '' };
  const path = pathFromCommand(text, name, home);
  const segments = path.split(/[\\\\/]+/).filter(Boolean);
  const normalized = text.replaceAll('\\', '/').toLowerCase();
  const wrapperOwned = normalized.includes('hooks/lib/bot-only.sh');
  const pathOwned = segments.some(segment => segment.toLowerCase() === productName.toLowerCase());
  const candidate = concreteLegacyPath(path, home);
  const manifestOwned = siblingManifestOwns(candidate, productName);
  const absentOwned = Boolean(candidate && !existsSync(candidate));
  const proofs = [
    wrapperOwned && 'bot_wrapper',
    pathOwned && 'product_path',
    manifestOwned && 'sibling_manifest',
    absentOwned && 'target_absent',
  ].filter(Boolean);
  return {
    kind: proofs.length ? 'known' : 'unknown',
    basename: name,
    path,
    provenance: proofs[0] || 'none',
    proofs,
  };
}

function scanJsonHooks(path, options) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { path, exists: false, known: [], unknown: [], ambiguous: [], invalid: null, next: null };
    }
    return { path, exists: true, known: [], unknown: [], ambiguous: [], invalid: error.message, next: null };
  }
  if (stat.isSymbolicLink()) {
    return {
      path,
      exists: true,
      known: [],
      unknown: [],
      ambiguous: [],
      invalid: 'symlink_requires_human_review',
      next: null,
    };
  }
  let source;
  try {
    source = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { path, exists: true, known: [], unknown: [], ambiguous: [], invalid: error.message, next: null };
  }
  if (!source || Array.isArray(source) || typeof source !== 'object') {
    return { path, exists: true, known: [], unknown: [], ambiguous: [], invalid: 'root_object_required', next: null };
  }
  if (source.hooks !== undefined && (!source.hooks || Array.isArray(source.hooks) || typeof source.hooks !== 'object')) {
    return { path, exists: true, known: [], unknown: [], ambiguous: [], invalid: 'hooks_object_required', next: null };
  }
  const known = [];
  const unknown = [];
  const nextHooks = Object.create(null);
  for (const [event, groups] of Object.entries(source.hooks || {})) {
    if (!Array.isArray(groups)) {
      return { path, exists: true, known: [], unknown: [], ambiguous: [], invalid: `hook_groups_array_required:${event}`, next: null };
    }
    const keptGroups = [];
    for (const [groupIndex, group] of groups.entries()) {
      if (!group || Array.isArray(group) || typeof group !== 'object' || !Array.isArray(group.hooks)) {
        return { path, exists: true, known: [], unknown: [], ambiguous: [], invalid: `hook_array_required:${event}:${groupIndex}`, next: null };
      }
      const keptHooks = [];
      group.hooks.forEach((hook, hookIndex) => {
        const finding = classifyLegacyCommand(hook?.command, options);
        const row = {
          ...finding,
          targetPath: finding.path,
          path,
          event,
          groupIndex,
          hookIndex,
          command: String(hook?.command || ''),
        };
        if (finding.kind === 'known') known.push(row);
        else {
          keptHooks.push(hook);
          if (finding.kind === 'unknown') unknown.push(row);
        }
      });
      if (group.hooks.length === 0) keptGroups.push(group);
      else if (keptHooks.length) keptGroups.push({ ...group, hooks: keptHooks });
    }
    if (keptGroups.length || groups.length === 0) nextHooks[event] = keptGroups;
  }
  return {
    path,
    exists: true,
    known,
    unknown,
    // Compatibility alias for pre-1.1.0 callers; unknown entries are warnings, not failures.
    ambiguous: unknown,
    invalid: null,
    next: { ...source, hooks: nextHooks },
  };
}

function scanInlineToml(path, options) {
  if (!existsSync(path)) return [];
  const rows = [];
  let inState = false;
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (/^\[/.test(trimmed)) inState = /^\[hooks\.state(?:\.|\])/.test(trimmed);
    if (!trimmed || trimmed.startsWith('#') || inState) return;
    const finding = classifyLegacyCommand(line, options);
    if (finding.kind !== 'unrelated') rows.push({ ...finding, path, line: index + 1 });
  });
  return rows;
}

function atomicJsonWrite(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const mode = statSync(path).mode & 0o777;
  let fd = null;
  try {
    fd = openSync(temp, 'wx', mode);
    fchmodSync(fd, mode);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temp, path);
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function backupName(path, now = new Date()) {
  return `${path}.thiscodex-${now.toISOString().replace(/[:.]/g, '-')}.bak`;
}

export function inspectLegacyHooks({ home, project, repoRoot = DEFAULT_REPO }) {
  const options = { home };
  const jsonPaths = [...new Set([
    join(home, '.codex', 'hooks.json'),
    project ? join(resolve(project), '.codex', 'hooks.json') : '',
  ].filter(Boolean))];
  const tomlPaths = [...new Set([
    join(home, '.codex', 'config.toml'),
    project ? join(resolve(project), '.codex', 'config.toml') : '',
  ].filter(Boolean))];
  return {
    json: jsonPaths.map(path => scanJsonHooks(path, options)),
    inline: tomlPaths.flatMap(path => scanInlineToml(path, options)),
  };
}

export function migrateLegacyHooks({ home, project, repoRoot = DEFAULT_REPO, apply = false, now = new Date() }) {
  const inspection = inspectLegacyHooks({ home, project, repoRoot });
  const known = inspection.json.flatMap(row => row.known);
  const unknown = inspection.json.flatMap(row => row.unknown);
  const invalid = inspection.json.filter(row => row.invalid);
  const inlineKnown = inspection.inline.filter(row => row.kind === 'known');
  const inlineUnknown = inspection.inline.filter(row => row.kind === 'unknown');
  const backups = [];
  const changed = [];
  const errors = [];
  if (apply && !invalid.length && !inlineKnown.length) {
    const prepared = [];
    const rows = inspection.json.filter(item => item.known.length);
    for (const row of rows) {
      const backup = backupName(row.path, now);
      const backupExistedBefore = existsSync(backup);
      try {
        copyFileSync(row.path, backup, constants.COPYFILE_EXCL);
        prepared.push({ row, backup });
      } catch (error) {
        errors.push({
          path: row.path,
          stage: 'backup',
          code: error?.code || 'UNKNOWN',
          message: String(error?.message || error),
        });
        if (!backupExistedBefore && existsSync(backup)) {
          try { unlinkSync(backup); } catch (cleanupError) {
            backups.push(backup);
            errors.push({
              path: backup,
              stage: 'cleanup',
              code: cleanupError?.code || 'UNKNOWN',
              message: String(cleanupError?.message || cleanupError),
            });
          }
        }
        for (const prior of prepared) {
          try { unlinkSync(prior.backup); } catch (cleanupError) {
            backups.push(prior.backup);
            errors.push({
              path: prior.backup,
              stage: 'cleanup',
              code: cleanupError?.code || 'UNKNOWN',
              message: String(cleanupError?.message || cleanupError),
            });
          }
        }
        prepared.length = 0;
        break;
      }
    }
    if (!errors.length) {
      const applied = [];
      for (const item of prepared) {
        try {
          atomicJsonWrite(item.row.path, item.row.next);
          applied.push(item);
          changed.push(item.row.path);
        } catch (error) {
          errors.push({
            path: item.row.path,
            stage: 'replace',
            code: error?.code || 'UNKNOWN',
            message: String(error?.message || error),
          });
          const retained = new Set();
          const stillChanged = [];
          for (const prior of [...applied].reverse()) {
            try {
              copyFileSync(prior.backup, prior.row.path);
            } catch (rollbackError) {
              retained.add(prior.backup);
              stillChanged.push(prior.row.path);
              errors.push({
                path: prior.row.path,
                stage: 'rollback',
                code: rollbackError?.code || 'UNKNOWN',
                message: String(rollbackError?.message || rollbackError),
              });
            }
          }
          changed.splice(0, changed.length, ...stillChanged.reverse());
          for (const candidate of prepared) {
            if (retained.has(candidate.backup)) continue;
            try {
              if (existsSync(candidate.backup)) unlinkSync(candidate.backup);
            } catch (cleanupError) {
              retained.add(candidate.backup);
              errors.push({
                path: candidate.backup,
                stage: 'cleanup',
                code: cleanupError?.code || 'UNKNOWN',
                message: String(cleanupError?.message || cleanupError),
              });
            }
          }
          backups.push(...retained);
          break;
        }
      }
      if (!errors.length) backups.push(...prepared.map(item => item.backup));
    }
  }
  const ok = invalid.length === 0 && inlineKnown.length === 0 && errors.length === 0;
  return {
    ok,
    mode: apply ? 'apply' : 'dry-run',
    known,
    unknown,
    ambiguous: unknown,
    invalid,
    inline: inspection.inline,
    inlineKnown,
    inlineUnknown,
    changed,
    backups,
    errors,
    next: errors.length
      ? `사람이 ${errors[0].path} 쓰기 권한을 확인한 뒤 다시 실행`
      : invalid.length
      ? '사람이 INVALID JSON 좌표를 고친 뒤 다시 실행'
      : inlineKnown.length
        ? '사람이 표시된 ThisCodex inline TOML 훅을 /hooks에서 검토·비활성화한 뒤 다시 실행'
        : known.length && !apply
        ? 'thiscodex hooks --apply를 실행해 provenance가 확인된 옛 JSON 항목만 제거'
        : '없음',
  };
}

const TOML_KEY_PART = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const TOML_KEY_PATH = new RegExp(`^${TOML_KEY_PART}(?:\\s*\\.\\s*${TOML_KEY_PART})*$`);

function tomlStatementWithoutComment(line) {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === '"' && char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '#') return line.slice(0, index).trim();
  }
  return line.trim();
}

function tomlValueState(value, initial = { square: 0, curly: 0, multiline: '' }) {
  const state = { ...initial };
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    if (state.multiline) {
      if (value.slice(index, index + 3) === state.multiline) {
        state.multiline = '';
        index += 2;
      }
      continue;
    }
    const char = value[index];
    if (quote) {
      if (quote === '"' && char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    const triple = value.slice(index, index + 3);
    if (triple === '"""' || triple === "'''") {
      state.multiline = triple;
      index += 2;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#') {
      break;
    } else if (char === '[') {
      state.square += 1;
    } else if (char === ']') {
      state.square -= 1;
    } else if (char === '{') {
      state.curly += 1;
    } else if (char === '}') {
      state.curly -= 1;
    }
    if (state.square < 0 || state.curly < 0) return { ...state, ok: false };
  }
  return { ...state, ok: quote === '' };
}

function tomlTableKey(statement) {
  const array = statement.startsWith('[[') && statement.endsWith(']]');
  const plain = statement.startsWith('[') && statement.endsWith(']') && !statement.startsWith('[[');
  if (!array && !plain) return '';
  const body = statement.slice(array ? 2 : 1, array ? -2 : -1).trim();
  return body && TOML_KEY_PATH.test(body) ? body : '';
}

function parseHookStates(config) {
  const states = new Map();
  let current = null;
  for (const line of config.split(/\r?\n/)) {
    const table = /^\s*\[hooks\.state\."((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
    if (table) {
      try { current = JSON.parse(`"${table[1]}"`); } catch { current = table[1]; }
      states.set(current, {});
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const enabled = /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line);
    if (enabled) states.get(current).enabled = enabled[1] === 'true';
    const hash = /^\s*trusted_hash\s*=\s*"([^"]+)"/.exec(line);
    if (hash) states.get(current).trusted_hash = hash[1];
  }
  return states;
}

function validateRelevantConfig(config) {
  let scope = '';
  let continuation = { square: 0, curly: 0, multiline: '' };
  const seenHookStates = new Set();
  for (const [index, line] of config.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (continuation.square || continuation.curly || continuation.multiline) {
      continuation = tomlValueState(line, continuation);
      if (!continuation.ok) return { ok: false, error: `invalid_toml_statement:${index + 1}` };
      continue;
    }
    const statement = tomlStatementWithoutComment(trimmed);
    if (!statement) continue;
    if (statement === '[hooks.state]') {
      scope = 'hook_parent';
      continue;
    }
    if (statement.startsWith('[hooks.state')) {
      const table = /^\[hooks\.state\."((?:[^"\\]|\\.)*)"\]$/.exec(statement);
      if (!table) return { ok: false, error: `invalid_hooks_state_table:${index + 1}` };
      let key;
      try { key = JSON.parse(`"${table[1]}"`); } catch { return { ok: false, error: `invalid_hooks_state_key:${index + 1}` }; }
      if (seenHookStates.has(key)) return { ok: false, error: `duplicate_hooks_state:${index + 1}` };
      seenHookStates.add(key);
      scope = 'hook';
      continue;
    }
    if (statement.startsWith('[plugins.')) {
      if (!/^\[plugins\.(?:"(?:[^"\\]|\\.)*"|[^\]]+)\]$/.test(statement)) {
        return { ok: false, error: `invalid_plugin_table:${index + 1}` };
      }
      scope = 'plugin';
      continue;
    }
    if (statement.startsWith('[')) {
      if (!tomlTableKey(statement)) return { ok: false, error: `invalid_toml_statement:${index + 1}` };
      scope = '';
      continue;
    }
    const assignment = /^(.*?)=(.*)$/.exec(statement);
    if (!assignment || !TOML_KEY_PATH.test(assignment[1].trim()) || !assignment[2].trim()) {
      return { ok: false, error: `invalid_toml_statement:${index + 1}` };
    }
    if (scope === 'hook' && /^trusted_hash\b/.test(statement)
      && !/^trusted_hash\s*=\s*"[^"]+"\s*$/.test(statement)) {
      return { ok: false, error: `invalid_trusted_hash:${index + 1}` };
    }
    if ((scope === 'hook' || scope === 'plugin') && /^enabled\b/.test(statement)
      && !/^enabled\s*=\s*(?:true|false)\s*$/.test(statement)) {
      return { ok: false, error: `invalid_enabled_value:${index + 1}` };
    }
    continuation = tomlValueState(assignment[2]);
    if (!continuation.ok) return { ok: false, error: `invalid_toml_statement:${index + 1}` };
  }
  if (continuation.square || continuation.curly || continuation.multiline) {
    return { ok: false, error: `invalid_toml_statement:${config.split(/\r?\n/).length}` };
  }
  return { ok: true, error: '' };
}

const PYTHON_TOML_CHECK = [
  'import sys',
  'import re',
  'try:',
  '    import tomllib',
  'except ModuleNotFoundError:',
  '    raise SystemExit(3)',
  'try:',
  '    tomllib.loads(sys.stdin.read())',
  'except tomllib.TOMLDecodeError as error:',
  '    line = getattr(error, "lineno", 0)',
  '    column = getattr(error, "colno", 0)',
  '    coordinate = re.search(r"line (\\d+), column (\\d+)", str(error))',
  '    if coordinate:',
  '        line, column = coordinate.groups()',
  '    print(f"{line}:{column}")',
  '    raise SystemExit(2)',
].join('\n');

function validateTomlSyntax(config, home) {
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['-c', PYTHON_TOML_CHECK], {
      input: config,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.error?.code === 'ENOENT' || result.status === 3) continue;
    if (result.status === 0) return { ok: true, error: '' };
    if (result.status === 2) {
      const coordinate = /^(\d+):(\d+)$/.exec(String(result.stdout || '').trim());
      return {
        ok: false,
        error: coordinate && coordinate[1] !== '0'
          ? `invalid_toml_syntax:${coordinate[1]}:${coordinate[2]}`
          : 'invalid_toml_syntax',
      };
    }
    return { ok: false, error: 'toml_parser_failed' };
  }

  const codexHome = join(home, '.codex');
  const native = spawnSync('codex', ['plugin', 'list', '--json'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: codexHome,
    },
  });
  if (native.error?.code === 'ENOENT') return { ok: false, error: 'toml_parser_unavailable' };
  if (native.status === 0) return { ok: true, error: '' };
  return { ok: false, error: 'invalid_toml_syntax:native' };
}

function enabledPluginIds(config) {
  const ids = [];
  let current = null;
  for (const line of config.split(/\r?\n/)) {
    const table = /^\s*\[plugins\.(?:"((?:[^"\\]|\\.)*)"|([^\]]+))\]\s*$/.exec(line);
    if (table) {
      const raw = table[1] || table[2] || '';
      try { current = table[1] ? JSON.parse(`"${raw}"`) : raw.trim(); } catch { current = raw; }
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }
    if (current && /^\s*enabled\s*=\s*true\s*(?:#.*)?$/.test(line)) ids.push(current);
  }
  return ids;
}

export function inspectBundle(repoRoot = DEFAULT_REPO) {
  const bundlePath = join(repoRoot, 'hooks', 'hooks.json');
  const manifestPath = join(repoRoot, '.codex-plugin', 'plugin.json');
  if (!existsSync(bundlePath) || !existsSync(manifestPath)) {
    return { ok: false, status: 'missing', bundlePath, guard: false };
  }
  if (!isRegularFile(bundlePath) || !isRegularFile(manifestPath)) {
    return { ok: false, status: 'invalid', bundlePath, guard: false };
  }
  let parsed;
  let manifest;
  try {
    parsed = JSON.parse(readFileSync(bundlePath, 'utf8'));
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { ok: false, status: 'invalid', bundlePath, error: error.message, guard: false };
  }
  const entries = flattenHooks(parsed);
  const exact = readFileSync(bundlePath, 'utf8').replace(/\r\n/g, '\n') === renderedHooksJson();
  const names = entries.map(({ hook }) => REQUIRED_HOOKS.find(name => hook.command.includes(`/hooks/${name}`))).filter(Boolean);
  const required = REQUIRED_HOOKS.every(name => names.filter(value => value === name).length === 1)
    && entries.length === REQUIRED_HOOKS.length;
  const guardPrefix = 'bash "${PLUGIN_ROOT}/hooks/lib/bot-only.sh" ';
  const guard = entries.every(({ hook }) => hook.command.startsWith(guardPrefix))
    && isRegularFile(join(repoRoot, 'hooks', 'lib', 'bot-only.sh'));
  const paths = REQUIRED_HOOKS.every(name => {
    const path = join(repoRoot, 'hooks', name);
    return isRegularFile(path);
  });
  const ok = exact && required && guard && paths && manifest.hooks === './hooks/hooks.json';
  return {
    ok,
    status: ok ? 'ok' : 'invalid',
    bundlePath,
    exact,
    required,
    guard,
    paths,
    manifest: manifest.hooks === './hooks/hooks.json',
    entries,
  };
}

export function inspectTrust({ home, repoRoot = DEFAULT_REPO, pluginId = '' }) {
  const configPath = join(home, '.codex', 'config.toml');
  if (!existsSync(configPath)) return { status: 'unknown', ok: false, pluginId: '', configPath, reason: 'config_missing' };
  const config = readFileSync(configPath, 'utf8');
  const validation = validateRelevantConfig(config);
  if (!validation.ok) {
    return {
      status: 'unknown',
      ok: false,
      pluginId: '',
      pluginEnabled: false,
      configPath,
      reason: 'config_invalid',
      error: validation.error,
    };
  }
  const syntax = validateTomlSyntax(config, home);
  if (!syntax.ok) {
    return {
      status: 'unknown',
      ok: false,
      pluginId: '',
      pluginEnabled: false,
      configPath,
      reason: 'config_invalid',
      error: syntax.error,
    };
  }
  const enabled = enabledPluginIds(config);
  const selected = pluginId || enabled.find(id => /(^|[/@])thiscodex(?:$|[/@])/i.test(id) || /^thiscodex@/i.test(id)) || '';
  const pluginEnabled = Boolean(selected && enabled.includes(selected));
  if (!selected) return { status: 'unknown', ok: false, pluginId: '', pluginEnabled: false, configPath, reason: 'plugin_id_missing' };
  const states = parseHookStates(config);
  const entries = flattenHooks(hooksDocument()).map(row => {
    const key = pluginTrustKey(selected, row.event, row.groupIndex, row.hookIndex);
    const state = states.get(key) || {};
    const expected = hookTrustHash(row.event, row.matcher, row.hook);
    return {
      key,
      enabled: state.enabled !== false,
      trusted: state.trusted_hash === expected,
      state: state.trusted_hash ? (state.trusted_hash === expected ? 'trusted' : 'modified') : 'untrusted',
    };
  });
  const ok = pluginEnabled && entries.every(row => row.enabled && row.trusted);
  return {
    status: ok ? 'ok' : 'pending',
    ok,
    pluginId: selected,
    pluginEnabled,
    configPath,
    entries,
    reason: !pluginEnabled ? 'plugin_not_enabled' : entries.find(row => !row.enabled || !row.trusted)?.state || '',
  };
}

export function verifyHooks({ home, project, repoRoot = DEFAULT_REPO, pluginId = '' }) {
  const bundle = inspectBundle(repoRoot);
  const legacy = inspectLegacyHooks({ home, project, repoRoot });
  const known = legacy.json.flatMap(row => row.known);
  const unknown = legacy.json.flatMap(row => row.unknown);
  const invalid = legacy.json.filter(row => row.invalid);
  const inlineKnown = legacy.inline.filter(row => row.kind === 'known');
  const inlineUnknown = legacy.inline.filter(row => row.kind === 'unknown');
  const trust = inspectTrust({ home, repoRoot, pluginId });
  const conflict = known.length + inlineKnown.length + invalid.length;
  const warnings = unknown.length + inlineUnknown.length;
  const ok = bundle.ok && trust.ok && conflict === 0;
  const state = !bundle.ok
    ? 'not_installed'
    : conflict
      ? 'legacy_conflict'
      : !trust.pluginEnabled
        ? 'not_installed'
        : !trust.ok
          ? 'registered_pending_trust'
          : 'active';
  let next = '없음';
  if (!bundle.ok) next = bundle.status === 'invalid'
    ? `not_installed — bundle_invalid: ${bundle.bundlePath}가 현재 플러그인 계약과 불일치하므로 ThisCodex를 다시 설치`
    : `not_installed — bundle_missing: ${bundle.bundlePath}가 없으므로 ThisCodex를 설치·활성화`;
  else if (invalid.length) next = 'legacy_conflict — 사람이 INVALID JSON 좌표를 고친 뒤 다시 실행';
  else if (inlineKnown.length) next = 'legacy_conflict — 사람이 표시된 ThisCodex inline TOML 훅을 /hooks에서 검토·비활성화한 뒤 다시 실행';
  else if (known.length) next = 'legacy_conflict — thiscodex hooks --apply로 provenance가 확인된 옛 JSON 항목을 제거';
  else if (trust.reason === 'config_invalid') next = `configuration_invalid — 사람이 ${trust.configPath}의 ${trust.error} 좌표를 고친 뒤 다시 실행`;
  else if (!trust.pluginEnabled) next = 'not_installed — /plugins에서 ThisCodex를 설치·활성화한 뒤 새 세션 시작';
  else if (!trust.ok) next = 'registered_pending_trust — /hooks에서 ThisCodex 11개 훅의 현재 정의를 검토·신뢰한 뒤 다시 실행';
  return {
    ok,
    state,
    bundle,
    trust,
    legacy: {
      known,
      unknown,
      ambiguous: unknown,
      invalid,
      inline: legacy.inline,
      inlineKnown,
      inlineUnknown,
    },
    summary: `HOOKS ${ok ? 'PASS' : 'FAIL'} bundle=${bundle.status} trust=${trust.status} legacy=${invalid.length ? 'invalid' : known.length + inlineKnown.length} warnings=${warnings} guard=${bundle.guard ? 'ok' : 'missing'} active=${ok ? 'yes' : 'no'}`,
    next,
  };
}

function option(args, name) {
  const equal = args.find(value => value.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || '' : '';
}

export function runHooksCli(args, env = process.env) {
  const modes = ['--dry-run', '--apply', '--verify'].filter(flag => args.includes(flag));
  const valued = ['--home', '--project', '--plugin-id'];
  const missingValue = valued.some(name => {
    const equal = args.find(value => value.startsWith(`${name}=`));
    if (equal !== undefined) return equal.slice(name.length + 1) === '';
    const index = args.indexOf(name);
    return index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'));
  });
  if (modes.length !== 1 || missingValue) {
    console.error('usage: thiscodex hooks --dry-run|--apply|--verify [--home <path>] [--project <path>] [--plugin-id <id>]');
    return 2;
  }
  const home = resolve(option(args, '--home') || env.HOME || env.USERPROFILE || '');
  const project = resolve(option(args, '--project') || process.cwd());
  const repoRoot = resolve(env.THISCODEX_REPO_ROOT || DEFAULT_REPO);
  const pluginId = option(args, '--plugin-id');
  if (modes[0] === '--verify') {
    const result = verifyHooks({ home, project, repoRoot, pluginId });
    console.log(result.summary);
    for (const row of result.legacy.inlineKnown) {
      console.log(`CONFLICT ${row.path}:${row.line} ${row.basename} provenance=${row.provenance}`);
    }
    for (const row of result.legacy.inlineUnknown) {
      console.log(`WARNING ${row.path}:${row.line} ${row.basename} ownership=unknown action=preserved`);
    }
    for (const row of result.legacy.unknown) {
      console.log(`WARNING ${row.path}:${row.event}:${row.groupIndex}:${row.hookIndex} ${row.basename} ownership=unknown action=preserved`);
    }
    for (const row of result.legacy.invalid) {
      console.log(`INVALID ${row.path} ${row.invalid}`);
    }
    console.log(`NEXT ${result.next}`);
    return result.ok ? 0 : 1;
  }
  const result = migrateLegacyHooks({ home, project, repoRoot, apply: modes[0] === '--apply' });
  console.log(`HOOK MIGRATION ${result.ok ? 'PASS' : 'FAIL'} mode=${result.mode} removable=${result.known.length} warnings=${result.unknown.length + result.inlineUnknown.length} conflicts=${result.inlineKnown.length + result.invalid.length + result.errors.length} changed=${result.changed.length}`);
  for (const row of result.inlineKnown) {
    console.log(`CONFLICT ${row.path}:${row.line} ${row.basename} provenance=${row.provenance}`);
  }
  for (const row of result.inlineUnknown) {
    console.log(`WARNING ${row.path}:${row.line} ${row.basename} ownership=unknown action=preserved`);
  }
  for (const row of result.unknown) {
    console.log(`WARNING ${row.path}:${row.event}:${row.groupIndex}:${row.hookIndex} ${row.basename} ownership=unknown action=preserved`);
  }
  for (const row of result.invalid) {
    console.log(`INVALID ${row.path} ${row.invalid}`);
  }
  for (const row of result.errors) {
    console.log(`ERROR ${row.path} migration_failed:${row.stage}:${row.code}`);
  }
  console.log(`NEXT ${result.next}`);
  return result.ok ? 0 : 1;
}
