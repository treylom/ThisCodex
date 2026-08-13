import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { codexHome, whichSync } from './detect.mjs';

const REQUIRED_MCP_TOOLS = [
  'browser_click',
  'browser_close',
  'browser_navigate',
  'browser_snapshot',
];

function executableName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

export function browserToolPaths(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const root = env.THISCODEX_BROWSER_TOOLS_DIR || join(home, '.thiscodex', 'browser-tools');
  const bin = join(root, 'node_modules', '.bin');
  return {
    root,
    playwright: join(bin, executableName('playwright')),
    playwrightMcp: join(bin, executableName('playwright-mcp')),
  };
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function firstExisting(candidates, exists = existsSync) {
  return candidates.find(candidate => candidate && exists(candidate)) || '';
}

function parseMcpRegistration(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const command = text.match(/^\s*command:\s*(.+?)\s*$/mi)?.[1] || '';
  const args = text.match(/^\s*args:\s*(.*?)\s*$/mi)?.[1] || '';
  return {
    registered: result.status === 0 && /^\s*enabled:\s*true\s*$/mi.test(text),
    command,
    args,
    detail: text.trim(),
  };
}

function registrationMatches(registration, expectedMcp) {
  if (!registration.registered) return false;
  if (registration.command === expectedMcp) {
    return /(?:^|\s)--headless(?:\s|$)/.test(registration.args)
      && /(?:^|\s)--isolated(?:\s|$)/.test(registration.args);
  }
  return basename(registration.command).startsWith('npx')
    && /@playwright\/mcp(?:@latest)?/.test(registration.args);
}

export function inspectBrowserTools({
  env = process.env,
  run = runCommand,
  exists = existsSync,
  which = whichSync,
} = {}) {
  const paths = browserToolPaths(env);
  const playwrightPath = firstExisting([
    env.THISCODEX_PLAYWRIGHT_CLI,
    paths.playwright,
    which('playwright', env),
  ], exists);
  const playwrightMcpPath = firstExisting([
    env.THISCODEX_PLAYWRIGHT_MCP,
    paths.playwrightMcp,
    which('playwright-mcp', env),
  ], exists);
  const codex = which('codex', env) || '';
  const registration = codex
    ? parseMcpRegistration(run(codex, ['mcp', 'get', 'playwright'], { env, timeoutMs: 15_000 }))
    : { registered: false, command: '', args: '', detail: 'codex executable missing' };
  const registrationMatchesInstalled = registrationMatches(registration, playwrightMcpPath || paths.playwrightMcp);
  return {
    playwright_cli: Boolean(playwrightPath),
    playwright_cli_path: playwrightPath,
    playwright_mcp_binary: Boolean(playwrightMcpPath),
    playwright_mcp_path: playwrightMcpPath,
    codex_cli: Boolean(codex),
    codex_path: codex,
    codex_mcp_registered: registration.registered,
    codex_mcp_matches_install: registrationMatchesInstalled,
    codex_mcp_command: registration.command,
    codex_mcp_args: registration.args,
    ready: Boolean(playwrightPath && playwrightMcpPath && codex && registrationMatchesInstalled),
  };
}

function backupCodexConfig(env, exists = existsSync) {
  const config = join(codexHome(env), 'config.toml');
  if (!exists(config)) return '';
  const backup = `${config}.thiscodex.browser-tools.bak`;
  copyFileSync(config, backup);
  return backup;
}

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

export async function ensureBrowserTools({
  required,
  automationMode,
  env = process.env,
  run = runCommand,
  exists = existsSync,
  which = whichSync,
  e2e = runPlaywrightMcpE2e,
} = {}) {
  if (!required) return { ok: true, code: 'browser_tools_not_required', changed: [] };

  const before = inspectBrowserTools({ env, run, exists, which });
  if (automationMode !== 'auto' && !before.ready) {
    return failure(
      'manual_browser_tools_install_required',
      'manual mode requires Playwright CLI/MCP installation before onboarding can continue',
      { before, changed: [] },
    );
  }

  const changed = [];
  const paths = browserToolPaths(env);
  const npm = which('npm', env) || '';
  const codex = which('codex', env) || '';
  if (!before.playwright_cli || !before.playwright_mcp_binary) {
    if (!npm) return failure('npm_required_for_playwright_install', 'npm executable missing', { before, changed });
    mkdirSync(paths.root, { recursive: true });
    const install = run(npm, [
      'install', '--prefix', paths.root, '--no-audit', '--no-fund', '--save=false',
      'playwright@latest', '@playwright/mcp@latest',
    ], { env, timeoutMs: 300_000 });
    if (install.status !== 0) {
      return failure('playwright_packages_install_failed', install.stderr || install.stdout, { before, changed });
    }
    changed.push('playwright_packages_installed');
  }

  const afterPackages = inspectBrowserTools({ env, run, exists, which });
  const playwright = afterPackages.playwright_cli_path || paths.playwright;
  const playwrightMcp = afterPackages.playwright_mcp_path || paths.playwrightMcp;
  if (!afterPackages.playwright_cli || !afterPackages.playwright_mcp_binary) {
    return failure('playwright_packages_not_detected', 'package installation completed but CLI/MCP binaries were not detected', {
      before, after: afterPackages, changed,
    });
  }

  const browserInstall = run(playwright, ['install', 'chromium', '--no-progress'], { env, timeoutMs: 300_000 });
  if (browserInstall.status !== 0) {
    return failure('playwright_chromium_install_failed', browserInstall.stderr || browserInstall.stdout, {
      before, after: afterPackages, changed,
    });
  }
  changed.push('playwright_chromium_verified');

  if (!codex) return failure('codex_required_for_playwright_mcp', 'codex executable missing', { before, changed });
  if (!afterPackages.codex_mcp_matches_install) {
    const backup = backupCodexConfig(env, exists);
    if (afterPackages.codex_mcp_registered) {
      const removed = run(codex, ['mcp', 'remove', 'playwright'], { env, timeoutMs: 15_000 });
      if (removed.status !== 0) {
        return failure('playwright_mcp_remove_failed', removed.stderr || removed.stdout, { before, changed, backup });
      }
      changed.push('stale_playwright_mcp_removed');
    }
    const added = run(codex, [
      'mcp', 'add', 'playwright', '--', playwrightMcp, '--headless', '--isolated',
    ], { env, timeoutMs: 30_000 });
    if (added.status !== 0) {
      return failure('playwright_mcp_registration_failed', added.stderr || added.stdout, { before, changed, backup });
    }
    changed.push('playwright_mcp_registered');
    if (backup) changed.push('codex_config_backed_up');
  }

  const after = inspectBrowserTools({ env, run, exists, which });
  if (!after.codex_mcp_registered || !after.codex_mcp_matches_install) {
    return failure('playwright_mcp_registration_not_detected', 'Codex did not report the expected Playwright MCP after registration', {
      before, after, changed,
    });
  }
  if (!after.ready) {
    return failure('browser_tools_redetection_failed', 'Playwright CLI/MCP did not pass post-install detection', {
      before, after, changed,
    });
  }

  const e2eResult = await e2e({
    command: after.playwright_mcp_path,
    args: ['--headless', '--isolated'],
    env,
  });
  if (!e2eResult.ok) {
    return failure('playwright_mcp_e2e_failed', e2eResult.message || e2eResult.code, {
      before, after, changed, e2e: e2eResult,
    });
  }
  changed.push('playwright_mcp_e2e_passed');
  return { ok: true, code: 'browser_tools_ready', before, after, changed, e2e: e2eResult };
}

function contentText(result) {
  return (result?.content || [])
    .filter(item => item?.type === 'text')
    .map(item => item.text || '')
    .join('\n');
}

function e2ePageUrl() {
  const html = '<title>ThisCodex Playwright MCP E2E</title>'
    + '<button onclick="this.textContent=\'verified\'">start</button>';
  return `data:text/html,${encodeURIComponent(html)}`;
}

export async function runPlaywrightMcpE2e({
  command,
  args = [],
  env = process.env,
  timeoutMs = 30_000,
  spawnImpl = spawn,
  outputDir = '',
} = {}) {
  if (!command) return failure('playwright_mcp_command_missing', 'Playwright MCP command missing');
  const ownsOutputDir = !outputDir && basename(command).startsWith('playwright-mcp');
  const e2eOutputDir = outputDir || (ownsOutputDir ? mkdtempSync(join(tmpdir(), 'thiscodex-playwright-e2e-')) : '');
  const childArgs = e2eOutputDir && !args.includes('--output-dir')
    ? [...args, '--output-dir', e2eOutputDir]
    : args;
  const child = spawnImpl(command, childArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdoutBuffer = '';
  let stderr = '';
  let sequence = 0;
  const pending = new Map();
  let exited = false;

  const rejectAll = error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.on('error', rejectAll);
  child.on('exit', (code, signal) => {
    exited = true;
    if (pending.size) rejectAll(new Error(`Playwright MCP exited early (code=${code}, signal=${signal})`));
  });
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || 'MCP request failed'));
      else waiter.resolve(message.result);
    }
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Playwright MCP E2E timed out after ${timeoutMs}ms`)), timeoutMs).unref();
  });

  const scenario = async () => {
    const initialized = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'thiscodex-browser-e2e', version: '1' },
    });
    if (!initialized?.protocolVersion) throw new Error('Playwright MCP initialize response missing protocolVersion');
    notify('notifications/initialized', {});

    const listed = await request('tools/list', {});
    const tools = [...(listed?.tools || [])].map(tool => tool.name).sort();
    const missing = REQUIRED_MCP_TOOLS.filter(name => !tools.includes(name));
    if (missing.length) throw new Error(`Playwright MCP tools missing: ${missing.join(', ')}`);

    const navigate = await request('tools/call', {
      name: 'browser_navigate',
      arguments: { url: e2ePageUrl() },
    });
    if (navigate?.isError) throw new Error(contentText(navigate) || 'browser_navigate failed');
    const navigateText = contentText(navigate);
    if (!/Page Title:\s*ThisCodex Playwright MCP E2E/.test(navigateText)) {
      throw new Error(`browser_navigate did not expose the expected title: ${navigateText.slice(0, 1200)}`);
    }

    const beforeSnapshot = await request('tools/call', { name: 'browser_snapshot', arguments: {} });
    if (beforeSnapshot?.isError) throw new Error(contentText(beforeSnapshot) || 'browser_snapshot failed before click');
    const beforeText = contentText(beforeSnapshot);
    const ref = beforeText.match(/\[ref=([^\]]+)\]/)?.[1] || '';
    if (!/button "start"/.test(beforeText) || !ref) {
      throw new Error(`browser_snapshot did not expose the expected button and reference: ${beforeText.slice(0, 1200)}`);
    }

    const clickTool = listed.tools.find(tool => tool.name === 'browser_click');
    const clickArgs = { element: 'ThisCodex E2E verification button' };
    if (clickTool?.inputSchema?.properties?.target) clickArgs.target = ref;
    else clickArgs.ref = ref;
    const clicked = await request('tools/call', { name: 'browser_click', arguments: clickArgs });
    if (clicked?.isError) throw new Error(contentText(clicked) || 'browser_click failed');

    const snapshot = await request('tools/call', { name: 'browser_snapshot', arguments: {} });
    if (snapshot?.isError) throw new Error(contentText(snapshot) || 'browser_snapshot failed');
    const afterText = contentText(snapshot);
    if (!/button "verified"/.test(afterText)) throw new Error('browser click did not change the DOM to verified');

    await request('tools/call', { name: 'browser_close', arguments: {} });
    return {
      ok: true,
      code: 'playwright_mcp_e2e_pass',
      title: 'ThisCodex Playwright MCP E2E',
      before: 'start',
      after: 'verified',
      tools: REQUIRED_MCP_TOOLS,
    };
  };

  try {
    return await Promise.race([scenario(), timeout]);
  } catch (error) {
    return failure('playwright_mcp_e2e_error', error.message, { stderr });
  } finally {
    rejectAll(new Error('Playwright MCP E2E closed'));
    if (!exited) child.kill();
    if (ownsOutputDir) rmSync(e2eOutputDir, { recursive: true, force: true });
  }
}
