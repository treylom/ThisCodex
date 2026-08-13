import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  browserToolPaths,
  ensureBrowserTools,
  inspectBrowserTools,
  runPlaywrightMcpE2e,
} from '../../scripts/lib/browser-tools.mjs';

function result(status = 0, stdout = '', stderr = '') {
  return { status, stdout, stderr };
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'tcx-browser-tools-'));
  const env = { HOME: root, PATH: '/fake/bin', THISCODEX_BROWSER_TOOLS_DIR: join(root, 'tools') };
  const paths = browserToolPaths(env);
  const calls = [];
  let packagesInstalled = false;
  let mcpRegistered = false;
  let browserInstalled = false;
  const exists = path => packagesInstalled && [paths.playwright, paths.playwrightMcp].includes(path);
  const which = name => ({ npm: '/fake/bin/npm', codex: '/fake/bin/codex' })[name] || null;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === '/fake/bin/npm' && args[0] === 'install') {
      packagesInstalled = true;
      return result(0, 'installed');
    }
    if (command === paths.playwright && args[0] === 'install') {
      browserInstalled = true;
      return result(0, 'chromium installed');
    }
    if (command === '/fake/bin/codex' && args.slice(0, 3).join(' ') === 'mcp get playwright') {
      return mcpRegistered
        ? result(0, `playwright\n  enabled: true\n  transport: stdio\n  command: ${paths.playwrightMcp}\n  args: --headless --isolated\n`)
        : result(1, '', "No MCP server named 'playwright' found");
    }
    if (command === '/fake/bin/codex' && args.slice(0, 3).join(' ') === 'mcp add playwright') {
      mcpRegistered = true;
      return result(0, "Added global MCP server 'playwright'.");
    }
    return result(2, '', `unexpected command: ${command} ${args.join(' ')}`);
  };
  return {
    root, env, paths, calls, run, exists, which,
    state: () => ({ packagesInstalled, mcpRegistered, browserInstalled }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('browser_tools_required=false performs no installation or E2E work', async () => {
  const h = createHarness();
  try {
    let e2eCalls = 0;
    const output = await ensureBrowserTools({
      required: false,
      automationMode: 'auto',
      env: h.env,
      run: h.run,
      exists: h.exists,
      which: h.which,
      e2e: async () => { e2eCalls += 1; return { ok: true }; },
    });
    assert.equal(output.ok, true);
    assert.equal(output.code, 'browser_tools_not_required');
    assert.equal(h.calls.length, 0);
    assert.equal(e2eCalls, 0);
  } finally {
    h.cleanup();
  }
});

test('automatic mode installs CLI and MCP, re-detects registration, and runs E2E', async () => {
  const h = createHarness();
  try {
    let e2eCommand = '';
    const output = await ensureBrowserTools({
      required: true,
      automationMode: 'auto',
      env: h.env,
      run: h.run,
      exists: h.exists,
      which: h.which,
      e2e: async ({ command }) => {
        e2eCommand = command;
        return { ok: true, code: 'playwright_mcp_e2e_pass', title: 'ThisCodex Playwright MCP E2E' };
      },
    });
    assert.equal(output.ok, true);
    assert.equal(output.code, 'browser_tools_ready');
    assert.equal(h.state().packagesInstalled, true);
    assert.equal(h.state().browserInstalled, true);
    assert.equal(h.state().mcpRegistered, true);
    assert.equal(e2eCommand, h.paths.playwrightMcp);
    assert.ok(h.calls.some(call => call[0] === '/fake/bin/npm' && call.includes('playwright@latest') && call.includes('@playwright/mcp@latest')));
    assert.ok(h.calls.some(call => call[0] === h.paths.playwright && call.slice(1).join(' ') === 'install chromium --no-progress'));
    assert.ok(h.calls.some(call => call.slice(0, 4).join(' ') === '/fake/bin/codex mcp add playwright'));
    assert.equal(output.after.ready, true);
  } finally {
    h.cleanup();
  }
});

test('manual mode never mutates a missing browser toolchain', async () => {
  const h = createHarness();
  try {
    const output = await ensureBrowserTools({
      required: true,
      automationMode: 'manual',
      env: h.env,
      run: h.run,
      exists: h.exists,
      which: h.which,
    });
    assert.equal(output.ok, false);
    assert.equal(output.code, 'manual_browser_tools_install_required');
    assert.equal(h.state().packagesInstalled, false);
    assert.equal(h.state().mcpRegistered, false);
    assert.equal(h.calls.filter(call => call.includes('install') || call.includes('add')).length, 0);
  } finally {
    h.cleanup();
  }
});

test('re-detection failure cannot be upgraded to installation success', async () => {
  const h = createHarness();
  try {
    const run = (command, args, options) => {
      if (command === '/fake/bin/codex' && args.slice(0, 3).join(' ') === 'mcp add playwright') {
        h.calls.push([command, ...args]);
        return result(0, 'claimed success without materializing registration');
      }
      return h.run(command, args, options);
    };
    const output = await ensureBrowserTools({
      required: true,
      automationMode: 'auto',
      env: h.env,
      run,
      exists: h.exists,
      which: h.which,
      e2e: async () => ({ ok: true }),
    });
    assert.equal(output.ok, false);
    assert.equal(output.code, 'playwright_mcp_registration_not_detected');
  } finally {
    h.cleanup();
  }
});

const FAKE_MCP_SERVER = String.raw`
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
let clicked = false;
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (!msg.id) return;
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } });
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [
    { name: 'browser_navigate', inputSchema: { type: 'object' } },
    { name: 'browser_snapshot', inputSchema: { type: 'object' } },
    { name: 'browser_click', inputSchema: { type: 'object', properties: { target: { type: 'string' } } } },
    { name: 'browser_close', inputSchema: { type: 'object' } },
  ] } });
  if (msg.method === 'tools/call' && msg.params.name === 'browser_navigate') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Page Title: ThisCodex Playwright MCP E2E\n- button "start" [ref=e2]' }] } });
  if (msg.method === 'tools/call' && msg.params.name === 'browser_click') { clicked = true; return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'clicked' }] } }); }
  if (msg.method === 'tools/call' && msg.params.name === 'browser_snapshot') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Page Title: ThisCodex Playwright MCP E2E\n- button "' + (clicked ? 'verified' : 'start') + '" [ref=' + (clicked ? 'e3' : 'e2') + ']' }] } });
  if (msg.method === 'tools/call' && msg.params.name === 'browser_close') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'closed' }] } });
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown' } });
});
`;

test('MCP E2E initializes, discovers tools, navigates, clicks, and observes changed DOM', async () => {
  const output = await runPlaywrightMcpE2e({
    command: process.execPath,
    args: ['-e', FAKE_MCP_SERVER],
    timeoutMs: 5000,
  });
  assert.equal(output.ok, true);
  assert.equal(output.code, 'playwright_mcp_e2e_pass');
  assert.equal(output.title, 'ThisCodex Playwright MCP E2E');
  assert.equal(output.before, 'start');
  assert.equal(output.after, 'verified');
  assert.deepEqual(output.tools, ['browser_click', 'browser_close', 'browser_navigate', 'browser_snapshot']);
});

test('inspection reports a missing MCP registration separately from installed packages', () => {
  const h = createHarness();
  try {
    h.run('/fake/bin/npm', ['install']);
    const status = inspectBrowserTools({ env: h.env, run: h.run, exists: h.exists, which: h.which });
    assert.equal(status.playwright_cli, true);
    assert.equal(status.playwright_mcp_binary, true);
    assert.equal(status.codex_mcp_registered, false);
    assert.equal(status.ready, false);
  } finally {
    h.cleanup();
  }
});
