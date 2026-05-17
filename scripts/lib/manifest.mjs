import { readFileSync } from 'node:fs';

const REQUIRED = ['id', 'order', 'action', 'when', 'reason', 'safety', 'verify', 'on_fail'];
const ACTIONS = new Set(['detect', 'prompt', 'check', 'apply', 'generate', 'guide']);
const SAFETY = new Set(['none', 'consent-gated', 'user-confirmed-path', 'dry-run-only']);

export function parseManifestJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid install manifest JSON: ${error.message}`);
  }
}

export function validateManifest(manifest) {
  if (manifest.product !== 'thiscodex') throw new Error('manifest product must be thiscodex');
  if (!Array.isArray(manifest.steps) || !manifest.steps.length) throw new Error('manifest steps missing');
  const ids = new Set();
  for (const step of manifest.steps) {
    for (const key of REQUIRED) {
      if (step[key] === undefined) throw new Error(`${step.id || '<unknown>'} missing ${key}`);
    }
    if (ids.has(step.id)) throw new Error(`duplicate step id: ${step.id}`);
    ids.add(step.id);
    if (!Number.isInteger(step.order)) throw new Error(`${step.id} order must be integer`);
    if (!ACTIONS.has(step.action)) throw new Error(`${step.id} action invalid: ${step.action}`);
    if (!SAFETY.has(step.safety)) throw new Error(`${step.id} safety invalid: ${step.safety}`);
    if (!step.verify.type) throw new Error(`${step.id} verify.type missing`);
    if (!step.on_fail.next_command) throw new Error(`${step.id} on_fail.next_command missing`);
  }
  return manifest;
}

export function sortSteps(steps) {
  return [...steps].sort((a, b) => a.order - b.order);
}

export function loadManifest(path = 'install/thiscodex.install.json') {
  return validateManifest(parseManifestJson(readFileSync(path, 'utf8')));
}
