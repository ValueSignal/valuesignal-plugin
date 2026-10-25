#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const portablePath = path.join(pluginRoot, 'plugin.json');
const codexDir = path.join(pluginRoot, '.codex-plugin');
const codexPath = path.join(codexDir, 'plugin.json');
const checkOnly = process.argv.includes('--check');

const portable = JSON.parse(await readFile(portablePath, 'utf8'));
const interfaceMetadata = portable.extensions?.['com.openai']?.interface;
if (!interfaceMetadata) {
  throw new Error('plugin.json must define extensions.com.openai.interface');
}

const derived = {
  name: portable.name,
  version: portable.version,
  description: portable.description,
  author: portable.author,
  homepage: portable.homepage,
  repository: portable.repository,
  license: portable.license,
  keywords: portable.keywords,
  interface: interfaceMetadata,
};
const expected = `${JSON.stringify(derived, null, 2)}\n`;

if (checkOnly) {
  let actual = '';
  try {
    actual = await readFile(codexPath, 'utf8');
  } catch {
    // The mismatch below gives one consistent failure for missing and stale files.
  }
  if (actual !== expected) {
    console.error('.codex-plugin/plugin.json is stale; run npm run sync:codex-manifest in dev/');
    process.exit(1);
  }
  console.log('.codex-plugin/plugin.json matches portable plugin.json');
} else {
  await mkdir(codexDir, { recursive: true });
  await writeFile(codexPath, expected);
  console.log('Derived .codex-plugin/plugin.json from plugin.json');
}
