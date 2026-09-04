#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderedHooksJson } from './lib/hooks-contract.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const path = resolve(repo, 'hooks', 'hooks.json');
const expected = renderedHooksJson();

if (process.argv.includes('--check')) {
  const actual = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  if (actual !== expected) {
    console.error('HOOK RENDER FAIL: hooks/hooks.json differs from scripts/lib/hooks-contract.mjs');
    process.exit(1);
  }
  console.log('HOOK RENDER PASS: static bundle equals the single hooks contract');
  console.log('Compared: hooks/hooks.json ↔ scripts/lib/hooks-contract.mjs');
} else if (process.argv.includes('--stdout')) {
  process.stdout.write(expected);
} else {
  writeFileSync(path, expected, 'utf8');
  console.log(`Rendered ${path}`);
}
