import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  REQUIRED_HOOKS,
  flattenHooks,
  hookTrustHash,
  hooksDocument,
  pluginTrustKey,
} from '../../scripts/lib/hooks-contract.mjs';
import {
  classifyLegacyCommand,
  inspectBundle,
  inspectTrust,
  migrateLegacyHooks,
  verifyHooks,
} from '../../scripts/lib/hooks-install.mjs';

const REPO = process.cwd();

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function trustedConfig(pluginId = 'thiscodex@test') {
  const chunks = [`[plugins."${pluginId}"]`, 'enabled = true', '', '[hooks.state]', ''];
  for (const row of flattenHooks(hooksDocument())) {
    const key = pluginTrustKey(pluginId, row.event, row.groupIndex, row.hookIndex);
    chunks.push(
      `[hooks.state."${key}"]`,
      `trusted_hash = "${hookTrustHash(row.event, row.matcher, row.hook)}"`,
      '',
    );
  }
  return `${chunks.join('\n')}\n`;
}

function tempHome(prefix = 'tcx-hooks-home-') {
  const home = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(home, '.codex'), { recursive: true });
  return home;
}

function copyBundle() {
  const root = mkdtempSync(join(tmpdir(), 'tcx-hooks-repo-'));
  mkdirSync(join(root, 'hooks', 'lib'), { recursive: true });
  mkdirSync(join(root, '.codex-plugin'), { recursive: true });
  copyFileSync(join(REPO, 'hooks', 'hooks.json'), join(root, 'hooks', 'hooks.json'));
  copyFileSync(join(REPO, 'hooks', 'lib', 'bot-only.sh'), join(root, 'hooks', 'lib', 'bot-only.sh'));
  copyFileSync(join(REPO, '.codex-plugin', 'plugin.json'), join(root, '.codex-plugin', 'plugin.json'));
  for (const name of REQUIRED_HOOKS) copyFileSync(join(REPO, 'hooks', name), join(root, 'hooks', name));
  return root;
}

test('bundle inspection accepts only the rendered 11-handler guarded contract', () => {
  assert.equal(inspectBundle(REPO).ok, true);
  const root = copyBundle();
  try {
    const document = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8'));
    document.hooks.Stop[0].hooks.pop();
    writeJson(join(root, 'hooks', 'hooks.json'), document);
    const result = inspectBundle(root);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'invalid');
    assert.equal(result.exact, false);
    assert.equal(result.required, false);

    const bypassed = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8'));
    bypassed.hooks.SessionStart[0].hooks[0].command = 'bash "${PLUGIN_ROOT}/hooks/bot-session-init.sh"';
    writeJson(join(root, 'hooks', 'hooks.json'), bypassed);
    const wrapperResult = inspectBundle(root);
    assert.equal(wrapperResult.ok, false);
    assert.equal(wrapperResult.guard, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy provenance is exact basename plus wrapper, product path, sibling manifest, or absent target', () => {
  const home = tempHome();
  const copied = join(home, 'vendor', 'reply-gate.sh');
  const altered = join(home, 'other', 'reply-gate.sh');
  const siblingRoot = join(home, 'other-checkout');
  const siblingTarget = join(siblingRoot, 'hooks', 'kst-timestamp.sh');
  const liveVariableTarget = join(home, 'live', 'hooks', 'completion-gate.sh');
  const substringTarget = join(home, 'my-thiscodex-notes', 'hooks', 'completion-gate.sh');
  mkdirSync(dirname(copied), { recursive: true });
  mkdirSync(dirname(altered), { recursive: true });
  mkdirSync(dirname(siblingTarget), { recursive: true });
  mkdirSync(join(siblingRoot, '.codex-plugin'), { recursive: true });
  mkdirSync(dirname(liveVariableTarget), { recursive: true });
  mkdirSync(dirname(substringTarget), { recursive: true });
  copyFileSync(join(REPO, 'hooks', 'reply-gate.sh'), copied);
  writeFileSync(altered, '# different provenance\n');
  writeFileSync(siblingTarget, '# sibling manifest provenance\n');
  writeJson(join(siblingRoot, '.codex-plugin', 'plugin.json'), { name: 'thiscodex' });
  writeFileSync(liveVariableTarget, '# live variable target\n');
  writeFileSync(substringTarget, '# operator-owned notes hook\n');
  try {
    const product = classifyLegacyCommand('bash "/opt/ThisCodex/hooks/reply-gate.sh"', { home });
    assert.equal(product.kind, 'known');
    assert.equal(product.provenance, 'product_path');
    const wrapper = classifyLegacyCommand('bash "${PLUGIN_ROOT}/hooks/lib/bot-only.sh" legacy "${VENDOR_ROOT}/hooks/reply-gate.sh"', { home });
    assert.equal(wrapper.kind, 'known');
    assert.equal(wrapper.provenance, 'bot_wrapper');
    const sibling = classifyLegacyCommand(`bash "${siblingTarget}"`, { home });
    assert.equal(sibling.kind, 'known');
    assert.equal(sibling.provenance, 'sibling_manifest');
    const absent = classifyLegacyCommand(`python3 "${join(home, 'dead', 'hooks', 'dispatch-room-gate.py')}"`, { home });
    assert.equal(absent.kind, 'known');
    assert.equal(absent.provenance, 'target_absent');
    const copiedCurrentBundle = classifyLegacyCommand(`bash "${copied}"`, { home });
    assert.equal(copiedCurrentBundle.kind, 'unknown');
    assert.equal(copiedCurrentBundle.provenance, 'none');
    const generic = classifyLegacyCommand(`bash "${altered}"`, { home, repoRoot: REPO });
    assert.equal(generic.kind, 'unknown');
    assert.equal(generic.provenance, 'none');
    assert.equal(
      classifyLegacyCommand('bash "${THISCODEX_ROOT}/hooks/reply-gate.sh"', { home }).kind,
      'unknown',
      'an unresolved variable name is not a concrete product path segment',
    );
    assert.equal(
      classifyLegacyCommand('bash "$HOME/live/hooks/completion-gate.sh"', { home }).kind,
      'unknown',
    );
    assert.equal(classifyLegacyCommand('bash /tmp/reply-gate.sh.extra', { home }).kind, 'unrelated');
    assert.equal(
      classifyLegacyCommand(`bash "${substringTarget}"`, { home }).kind,
      'unknown',
      'a path segment that merely contains the product name is not ownership evidence',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('apply backs up and removes only proven JSON hooks, preserves third-party data, and is idempotent', () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  const unknownTarget = join(home, 'vendor', 'reply-gate.sh');
  mkdirSync(dirname(unknownTarget), { recursive: true });
  writeFileSync(unknownTarget, '# operator-owned hook\n');
  writeJson(hooksPath, {
    owner: 'keep-me',
    hooks: {
      Stop: [{ matcher: 'anything', hooks: [
        { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
        { type: 'command', command: `bash "${unknownTarget}"` },
        { type: 'command', command: 'bash "/opt/vendor/third-party-stop.sh"' },
      ] }],
    },
  });
  if (process.platform !== 'win32') chmodSync(hooksPath, 0o600);
  try {
    const dry = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: false });
    assert.equal(dry.ok, true);
    assert.equal(dry.known.length, 1);
    assert.equal(dry.unknown.length, 1);
    assert.equal(dry.changed.length, 0);
    const before = readFileSync(hooksPath, 'utf8');
    const beforeMode = statSync(hooksPath).mode & 0o777;
    const applied = migrateLegacyHooks({
      home, project, repoRoot: REPO, apply: true, now: new Date('2026-09-03T00:00:00.000Z'),
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.changed.length, 1);
    assert.equal(applied.backups.length, 1);
    assert.equal(readFileSync(applied.backups[0], 'utf8'), before);
    if (process.platform !== 'win32') assert.equal(statSync(hooksPath).mode & 0o777, beforeMode);
    const after = readFileSync(hooksPath, 'utf8');
    const parsed = JSON.parse(after);
    assert.equal(parsed.owner, 'keep-me');
    assert.equal(parsed.hooks.Stop[0].matcher, 'anything');
    assert.deepEqual(parsed.hooks.Stop[0].hooks, [
      { type: 'command', command: `bash "${unknownTarget}"` },
      { type: 'command', command: 'bash "/opt/vendor/third-party-stop.sh"' },
    ]);
    const mtime = statSync(hooksPath).mtimeMs;
    const again = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
    assert.equal(again.ok, true);
    assert.equal(again.changed.length, 0);
    assert.equal(again.backups.length, 0);
    assert.equal(readFileSync(hooksPath, 'utf8'), after);
    assert.equal(statSync(hooksPath).mtimeMs, mtime);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('migration preserves empty third-party groups and empty event arrays', () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  const protoEvent = [{ matcher: 'third-party-proto', custom: { keep: 'proto' }, hooks: [] }];
  writeJson(hooksPath, {
    owner: 'keep-me',
    hooks: {
      Stop: [
        { matcher: 'thiscodex', hooks: [
          { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
        ] },
        { matcher: 'third-party', custom: { keep: true }, hooks: [] },
      ],
      Notification: [],
      ['__proto__']: protoEvent,
    },
  });
  try {
    const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
    assert.equal(result.ok, true);
    assert.equal(result.changed.length, 1);
    const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
    assert.deepEqual(parsed.hooks.Stop, [
      { matcher: 'third-party', custom: { keep: true }, hooks: [] },
    ]);
    assert.deepEqual(parsed.hooks.Notification, []);
    assert.equal(Object.hasOwn(parsed.hooks, '__proto__'), true);
    assert.deepEqual(parsed.hooks['__proto__'], protoEvent);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('malformed or structurally invalid hooks.json fails closed and is never rewritten', () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  try {
    for (const bytes of ['{"hooks":', '{"hooks":[]}\n', '{"hooks":{"Stop":{}}}\n']) {
      writeFileSync(hooksPath, bytes);
      const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
      assert.equal(result.ok, false);
      assert.equal(result.invalid.length, 1);
      assert.equal(result.invalid[0].path, hooksPath);
      assert.equal(result.changed.length, 0);
      assert.equal(result.backups.length, 0);
      assert.equal(readFileSync(hooksPath, 'utf8'), bytes);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('ownership-unknown JSON and inline TOML are preserved warnings and do not fail migration', () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  const configPath = join(home, '.codex', 'config.toml');
  const ambiguousTarget = join(home, 'legacy', 'reply-gate.sh');
  const inlineTarget = join(home, 'legacy', 'completion-gate.sh');
  mkdirSync(dirname(ambiguousTarget), { recursive: true });
  writeFileSync(ambiguousTarget, '# not the bundle\n');
  writeFileSync(inlineTarget, '# also operator owned\n');
  writeJson(hooksPath, { hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'bash "/opt/ThisCodex/hooks/kst-timestamp.sh"' },
    { type: 'command', command: `bash "${ambiguousTarget}"` },
  ] }] } });
  writeFileSync(configPath, [
    'model = "gpt-5"',
    `notify = ["bash", "${inlineTarget}"]`,
    '',
  ].join('\n'));
  try {
    const beforeJson = readFileSync(hooksPath, 'utf8');
    const beforeToml = readFileSync(configPath, 'utf8');
    const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
    assert.equal(result.ok, true);
    assert.equal(result.known.length, 1);
    assert.equal(result.unknown.length, 1);
    assert.equal(result.inline.length, 1);
    assert.equal(result.inlineUnknown.length, 1);
    assert.equal(result.inline[0].line, 2);
    assert.equal(result.changed.length, 1);
    assert.equal(result.backups.length, 1);
    assert.notEqual(readFileSync(hooksPath, 'utf8'), beforeJson);
    const migrated = JSON.parse(readFileSync(hooksPath, 'utf8'));
    assert.equal(migrated.hooks.Stop[0].hooks.length, 1);
    assert.equal(migrated.hooks.Stop[0].hooks[0].command, `bash "${ambiguousTarget}"`);
    assert.equal(readFileSync(configPath, 'utf8'), beforeToml);

    const cli = spawnSync(process.execPath, [
      'bin/thiscodex.mjs', 'hooks', '--apply', '--home', home, '--project', project,
    ], { cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO } });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, new RegExp(`WARNING ${configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:2 completion-gate\\.sh ownership=unknown action=preserved`));
    assert.match(cli.stdout, /warnings=2/);
    assert.match(cli.stdout, /^NEXT 없음$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('proven ThisCodex inline TOML is a coordinate-bearing conflict and blocks JSON migration', () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  const configPath = join(home, '.codex', 'config.toml');
  writeJson(hooksPath, { hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'bash "/opt/ThisCodex/hooks/kst-timestamp.sh"' },
  ] }] } });
  writeFileSync(configPath, 'notify = ["bash", "/opt/ThisCodex/hooks/completion-gate.sh"]\n');
  try {
    const before = readFileSync(hooksPath, 'utf8');
    const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
    assert.equal(result.ok, false);
    assert.equal(result.inlineKnown.length, 1);
    assert.equal(result.inlineKnown[0].line, 1);
    assert.equal(result.changed.length, 0);
    assert.equal(result.backups.length, 0);
    assert.equal(readFileSync(hooksPath, 'utf8'), before);

    const cli = spawnSync(process.execPath, [
      'bin/thiscodex.mjs', 'hooks', '--apply', '--home', home, '--project', project,
    ], { cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO } });
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stdout, new RegExp(`CONFLICT ${configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:1 completion-gate\\.sh`));
    assert.match(cli.stdout, /NEXT .*사람/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a symlinked hooks.json is never replaced by migration', { skip: process.platform === 'win32' }, () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const target = join(home, 'operator-hooks.json');
  const link = join(home, '.codex', 'hooks.json');
  writeJson(target, { hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
  ] }] } });
  symlinkSync(target, link);
  try {
    const before = readFileSync(target, 'utf8');
    const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
    assert.equal(result.ok, false);
    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0].invalid, /symlink/);
    assert.equal(result.changed.length, 0);
    assert.equal(readFileSync(target, 'utf8'), before);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('trust inspection requires the enabled plugin and exact hashes for all 11 handlers', () => {
  const home = tempHome();
  const configPath = join(home, '.codex', 'config.toml');
  try {
    writeFileSync(configPath, trustedConfig());
    const trusted = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(trusted.ok, true);
    assert.equal(trusted.entries.length, 11);
    assert.equal(trusted.entries.every(row => row.state === 'trusted'), true);
    const verified = verifyHooks({ home, project: home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(verified.ok, true);
    assert.equal(verified.state, 'active');

    writeFileSync(configPath, `features = [\n  "hooks",\n]\n${trustedConfig()}`);
    const multiline = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(multiline.ok, true, 'valid multiline TOML values must not be rejected');

    const changed = readFileSync(configPath, 'utf8').replace(/sha256:[a-f0-9]{64}/, `sha256:${'0'.repeat(64)}`);
    writeFileSync(configPath, changed);
    const modified = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(modified.ok, false);
    assert.equal(modified.status, 'pending');
    assert.equal(modified.entries.filter(row => row.state === 'modified').length, 1);

    writeFileSync(configPath, trustedConfig().replace('enabled = true', 'enabled = false'));
    const disabled = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(disabled.ok, false);
    assert.equal(disabled.reason, 'plugin_not_enabled');

    writeFileSync(configPath, `[plugins."thiscodex@test"\nenabled = true\n${trustedConfig()}`);
    const malformed = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.status, 'unknown');
    assert.equal(malformed.reason, 'config_invalid');
    assert.match(malformed.error, /^invalid_plugin_table:/);
    const malformedVerify = verifyHooks({ home, project: home, repoRoot: REPO, pluginId: 'thiscodex@test' });
    assert.equal(malformedVerify.ok, false);
    assert.match(malformedVerify.summary, /trust=unknown/);
    assert.match(malformedVerify.next, /configuration_invalid/);
    assert.match(malformedVerify.next, /invalid_plugin_table/);

    for (const invalidConfig of [
      trustedConfig().replace('[hooks.state]\n', '[hooks.state]\n<<<<<<< ours\n'),
      `${trustedConfig()}not a toml statement\n`,
    ]) {
      writeFileSync(configPath, invalidConfig);
      const invalidStatement = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
      assert.equal(invalidStatement.ok, false);
      assert.equal(invalidStatement.reason, 'config_invalid');
      assert.match(invalidStatement.error, /^invalid_toml_statement:/);
    }

    for (const invalidConfig of [
      trustedConfig().replace('enabled = true', 'enabled = true\nenabled = false'),
      trustedConfig().replace(/trusted_hash = "([^"]+)"/, 'trusted_hash = "$1"\ntrusted_hash = "$1"'),
      trustedConfig().replace('hooks/hooks.json', 'hooks\\/hooks.json'),
      `${trustedConfig()}poison = [,,]\n`,
      `${trustedConfig()}poison = 1 2\n`,
      `${trustedConfig()}poison = {x=bar}\n`,
      `${trustedConfig()}poison = "\\q"\n`,
    ]) {
      writeFileSync(configPath, invalidConfig);
      const invalidSyntax = inspectTrust({ home, repoRoot: REPO, pluginId: 'thiscodex@test' });
      assert.equal(invalidSyntax.ok, false);
      assert.equal(invalidSyntax.status, 'unknown');
      assert.equal(invalidSyntax.reason, 'config_invalid');
      assert.match(invalidSyntax.error, /^invalid_toml_syntax:/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('hooks CLI uses exit 0/1/2 for pass, failed contract, and invalid invocation', () => {
  const home = tempHome();
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  try {
    writeFileSync(join(home, '.codex', 'config.toml'), trustedConfig());
    const pass = spawnSync(process.execPath, [
      'bin/thiscodex.mjs', 'hooks', '--verify', '--home', home, '--project', project,
      '--plugin-id', 'thiscodex@test',
    ], { cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO } });
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /^HOOKS PASS /m);
    assert.match(pass.stdout, /^NEXT 없음$/m);

    const warningTarget = join(home, 'operator', 'hooks', 'reply-gate.sh');
    mkdirSync(dirname(warningTarget), { recursive: true });
    writeFileSync(warningTarget, '# operator owned\n');
    writeJson(join(home, '.codex', 'hooks.json'), { hooks: { Stop: [{ hooks: [
      { type: 'command', command: `bash "${warningTarget}"` },
    ] }] } });
    const warningOnly = spawnSync(process.execPath, [
      'bin/thiscodex.mjs', 'hooks', '--verify', '--home', home, '--project', project,
      '--plugin-id', 'thiscodex@test',
    ], { cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO } });
    assert.equal(warningOnly.status, 0, warningOnly.stdout + warningOnly.stderr);
    assert.match(warningOnly.stdout, /^HOOKS PASS .*warnings=1 .*active=yes$/m);
    assert.match(
      warningOnly.stdout,
      new RegExp(`WARNING ${join(home, '.codex', 'hooks.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:Stop:0:0 reply-gate\\.sh ownership=unknown action=preserved`),
    );
    assert.match(warningOnly.stdout, /^NEXT 없음$/m);

    writeFileSync(join(home, '.codex', 'config.toml'), '[plugins."thiscodex@test"]\nenabled = true\n');
    const fail = spawnSync(process.execPath, [
      'bin/thiscodex.mjs', 'hooks', '--verify', '--home', home, '--project', project,
      '--plugin-id', 'thiscodex@test',
    ], { cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO } });
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /^HOOKS FAIL /m);
    assert.match(fail.stdout, /registered_pending_trust/);

    const invalid = spawnSync(process.execPath, ['bin/thiscodex.mjs', 'hooks'], {
      cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO },
    });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /usage:/);

    const missingValue = spawnSync(process.execPath, ['bin/thiscodex.mjs', 'hooks', '--verify', '--home'], {
      cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO },
      timeout: 5000,
    });
    assert.equal(missingValue.status, 2);
    assert.match(missingValue.stderr, /usage:/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('invalid bundle has a distinct human-readable diagnostic from a missing install', () => {
  const home = tempHome();
  const root = copyBundle();
  try {
    const document = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8'));
    document.hooks.Stop[0].hooks.pop();
    writeJson(join(root, 'hooks', 'hooks.json'), document);
    writeFileSync(join(home, '.codex', 'config.toml'), trustedConfig());
    const broken = verifyHooks({ home, project: home, repoRoot: root, pluginId: 'thiscodex@test' });
    assert.equal(broken.ok, false);
    assert.equal(broken.bundle.status, 'invalid');
    assert.match(broken.next, /bundle_invalid/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing bundle with a missing required handler is invalid, not missing', () => {
  const home = tempHome();
  const root = copyBundle();
  try {
    rmSync(join(root, 'hooks', REQUIRED_HOOKS[0]));
    writeFileSync(join(home, '.codex', 'config.toml'), trustedConfig());
    const broken = verifyHooks({ home, project: home, repoRoot: root, pluginId: 'thiscodex@test' });
    assert.equal(broken.ok, false);
    assert.equal(broken.bundle.paths, false);
    assert.equal(broken.bundle.status, 'invalid');
    assert.match(broken.next, /bundle_invalid/);
    assert.doesNotMatch(broken.next, /hooks\/hooks\.json가 없다/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('bundle inspection rejects handler directories and symlinks as invalid', {
  skip: process.platform === 'win32',
}, () => {
  const root = copyBundle();
  const handler = join(root, 'hooks', REQUIRED_HOOKS[0]);
  try {
    rmSync(handler);
    mkdirSync(handler);
    const directory = inspectBundle(root);
    assert.equal(directory.ok, false);
    assert.equal(directory.status, 'invalid');
    assert.equal(directory.paths, false);

    rmSync(handler, { recursive: true });
    symlinkSync(join(root, 'hooks', REQUIRED_HOOKS[1]), handler);
    const symlink = inspectBundle(root);
    assert.equal(symlink.ok, false);
    assert.equal(symlink.status, 'invalid');
    assert.equal(symlink.paths, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unwritable migration target fails with summary and NEXT without backup residue', {
  skip: process.platform === 'win32',
}, () => {
  const home = tempHome('tcx-hooks-readonly-');
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const codexDir = join(home, '.codex');
  const hooksPath = join(codexDir, 'hooks.json');
  writeJson(hooksPath, { hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
  ] }] } });
  chmodSync(codexDir, 0o500);
  try {
    const result = spawnSync(process.execPath, [
      'bin/thiscodex.mjs', 'hooks', '--apply', '--home', home, '--project', project,
    ], { cwd: REPO, encoding: 'utf8', env: { ...process.env, THISCODEX_REPO_ROOT: REPO } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^HOOK MIGRATION FAIL /m);
    assert.match(result.stdout, /^ERROR .*migration_failed:/m);
    assert.match(result.stdout, /^NEXT .*권한.*다시 실행$/m);
    assert.doesNotMatch(result.stderr, /(?:node:fs|\n\s+at )/);
    assert.equal(readdirSync(codexDir).filter(name => name.endsWith('.bak')).length, 0);
  } finally {
    chmodSync(codexDir, 0o700);
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a later backup failure leaves earlier legacy files byte-identical and backup-free', {
  skip: process.platform === 'win32',
}, () => {
  const home = tempHome('tcx-hooks-transaction-');
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const projectCodex = join(project, '.codex');
  const homePath = join(home, '.codex', 'hooks.json');
  const projectPath = join(projectCodex, 'hooks.json');
  const legacy = { hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
  ] }] } };
  writeJson(homePath, legacy);
  writeJson(projectPath, legacy);
  const homeBefore = readFileSync(homePath, 'utf8');
  const projectBefore = readFileSync(projectPath, 'utf8');
  chmodSync(projectCodex, 0o500);
  try {
    const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true });
    assert.equal(result.ok, false);
    assert.equal(result.changed.length, 0);
    assert.equal(result.backups.length, 0);
    assert.equal(readFileSync(homePath, 'utf8'), homeBefore);
    assert.equal(readFileSync(projectPath, 'utf8'), projectBefore);
    assert.equal(readdirSync(join(home, '.codex')).filter(name => name.endsWith('.bak')).length, 0);
    assert.equal(readdirSync(projectCodex).filter(name => name.endsWith('.bak')).length, 0);
  } finally {
    chmodSync(projectCodex, 0o700);
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('a pre-existing timestamp backup collision is preserved and fails closed', () => {
  const home = tempHome('tcx-hooks-backup-collision-');
  const project = mkdtempSync(join(tmpdir(), 'tcx-hooks-project-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  const now = new Date('2026-09-04T00:00:00.000Z');
  const backup = `${hooksPath}.thiscodex-2026-09-04T00-00-00-000Z.bak`;
  writeJson(hooksPath, { hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'bash "/opt/ThisCodex/hooks/reply-gate.sh"' },
  ] }] } });
  writeFileSync(backup, 'operator-owned prior backup\n');
  const before = readFileSync(hooksPath, 'utf8');
  try {
    const result = migrateLegacyHooks({ home, project, repoRoot: REPO, apply: true, now });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'EEXIST');
    assert.equal(result.changed.length, 0);
    assert.equal(readFileSync(hooksPath, 'utf8'), before);
    assert.equal(readFileSync(backup, 'utf8'), 'operator-owned prior backup\n');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('known legacy hook list remains exactly the approved 11 basenames', () => {
  assert.equal(REQUIRED_HOOKS.length, 11);
  assert.equal(new Set(REQUIRED_HOOKS).size, 11);
  assert.deepEqual(
    readdirSync(join(REPO, 'hooks')).filter(name => REQUIRED_HOOKS.includes(name)).sort(),
    [...REQUIRED_HOOKS].sort(),
  );
  assert.equal(existsSync(join(REPO, 'hooks', 'lib', 'bot-only.sh')), true);
});
