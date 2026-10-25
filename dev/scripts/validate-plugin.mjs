#!/usr/bin/env node
/**
 * Validate plugin layout: every host manifest, plus the Cursor marketplace template rules for .cursor-plugin/.
 * Usage (from dev/): node scripts/validate-plugin.mjs [repo-root]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));

const errors = [];
const warnings = [];

const pluginNamePattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const marketplaceNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function addError(message) {
  errors.push(message);
}
function addWarning(message) {
  warnings.push(message);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath, context) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    addError(`${context} is missing: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(`${context} contains invalid JSON (${filePath}): ${error.message}`);
    return null;
  }
}

async function readTextFile(filePath, context) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    addError(`${context} is missing: ${filePath}`);
    return null;
  }
}

async function validateVersionConsistency(pluginDir, entry, pluginManifest, marketplace) {
  const portableManifest = await readJsonFile(
    path.join(pluginDir, 'plugin.json'),
    `${entry.name} portable plugin.json`
  );
  const codexManifest = await readJsonFile(
    path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    `${entry.name} Codex plugin.json`
  );
  const packageManifest = await readJsonFile(
    path.join(pluginDir, 'dev', 'package.json'),
    `${entry.name} dev/package.json`
  );
  const claudeManifest = await readJsonFile(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    `${entry.name} Claude plugin.json`
  );
  const packageLock = await readJsonFile(
    path.join(pluginDir, 'dev', 'package-lock.json'),
    `${entry.name} dev/package-lock.json`
  );
  const configSource = await readTextFile(
    path.join(pluginDir, 'lib', 'config.mjs'),
    `${entry.name} config.mjs`
  );
  const serverBundle = await readTextFile(
    path.join(pluginDir, 'mcp', 'server.mjs'),
    `${entry.name} MCP server`
  );
  const serverSource = await readTextFile(
    path.join(pluginDir, 'mcp', 'server.source.mjs'),
    `${entry.name} MCP server source`
  );

  const matchVersion = (source, pattern) => source?.match(pattern)?.[1] || null;
  const sites = {
    'marketplace.plugins[].version': entry.version,
    'plugin.json': portableManifest?.version,
    '.codex-plugin/plugin.json': codexManifest?.version,
    '.cursor-plugin/plugin.json': pluginManifest.version,
    '.claude-plugin/plugin.json': claudeManifest?.version,
    'dev/package.json': packageManifest?.version,
    'dev/package-lock.json': packageLock?.version,
    'dev/package-lock.json packages[""]': packageLock?.packages?.['']?.version,
    'lib/config.mjs': matchVersion(configSource, /PLUGIN_VERSION\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?)['"]/),
    'mcp/server.source.mjs': matchVersion(serverSource, /version\s*:\s*['"]([0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?)['"]/),
    'mcp/server.mjs': matchVersion(serverBundle, /version\s*:\s*['"]([0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?)['"]/),
  };

  if (marketplace.metadata?.version !== undefined) {
    sites['marketplace.metadata.version'] = marketplace.metadata.version;
  }

  for (const [site, version] of Object.entries(sites)) {
    if (typeof version !== 'string' || !version.length) {
      addError(`${entry.name}: version is missing or unreadable in ${site}`);
    }
  }

  const versions = [...new Set(Object.values(sites).filter((value) => typeof value === 'string' && value.length))];
  if (versions.length > 1) {
    addError(
      `${entry.name}: version mismatch: ${Object.entries(sites)
        .map(([site, version]) => `${site}=${version || 'UNREADABLE'}`)
        .join(', ')}`
    );
  }
}

async function validatePortablePackaging(pluginDir, pluginName) {
  const portable = await readJsonFile(
    path.join(pluginDir, 'plugin.json'),
    `${pluginName} portable plugin.json`
  );
  const codex = await readJsonFile(
    path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    `${pluginName} Codex plugin.json`
  );
  const mcp = await readJsonFile(
    path.join(pluginDir, 'mcp.json'),
    `${pluginName} portable mcp.json`
  );
  const agentMarketplace = await readJsonFile(
    path.join(pluginDir, '.agents', 'plugins', 'marketplace.json'),
    `${pluginName} Agent Plugins marketplace.json`
  );
  if (!portable || !codex || !mcp || !agentMarketplace) return;

  const pluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
  const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
  if (portable.$schema !== pluginSchema) {
    addError(`${pluginName}: plugin.json must target ${pluginSchema}`);
  }
  if (portable.name !== pluginName) {
    addError(`${pluginName}: portable plugin.json name mismatch`);
  }

  const portableInterface = portable.extensions?.['com.openai']?.interface;
  if (!portableInterface || typeof portableInterface !== 'object') {
    addError(`${pluginName}: plugin.json must define extensions.com.openai.interface`);
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
    interface: portableInterface,
  };
  if (JSON.stringify(codex) !== JSON.stringify(derived)) {
    addError(`${pluginName}: .codex-plugin/plugin.json is not derived from plugin.json`);
  }

  if (mcp.$schema !== mcpSchema) {
    addError(`${pluginName}: mcp.json must target ${mcpSchema}`);
  }
  if (Object.keys(mcp).some((key) => !['$schema', 'mcpServers'].includes(key))) {
    addError(`${pluginName}: mcp.json contains a non-portable top-level field`);
  }
  const server = mcp.mcpServers?.valuesignal;
  if (server?.type !== 'stdio' || server?.command !== 'node') {
    addError(`${pluginName}: portable valuesignal MCP server must use stdio with command "node"`);
  }
  if (JSON.stringify(server?.args) !== JSON.stringify(['mcp/server.mjs'])) {
    addError(`${pluginName}: portable MCP args must resolve the committed bundle from plugin root`);
  }
  if (server?.env?.VALUESIGNAL_HOST !== undefined) {
    addError(`${pluginName}: portable mcp.json must let the runtime detect the host`);
  }
  if (server?.env?.VALUESIGNAL_JWT_TOKEN !== undefined) {
    addError(`${pluginName}: portable mcp.json must not embed or interpolate a credential`);
  }

  const agentEntry = agentMarketplace.plugins?.find((candidate) => candidate?.name === pluginName);
  if (!agentEntry) {
    addError(`${pluginName}: .agents marketplace is missing the plugin entry`);
  } else {
    if (agentEntry.source?.source !== 'local' || agentEntry.source?.path !== './') {
      addError(`${pluginName}: .agents marketplace source must resolve from the public repo root`);
    }
    if (
      agentEntry.policy?.installation !== 'AVAILABLE' ||
      agentEntry.policy?.authentication !== 'ON_INSTALL'
    ) {
      addError(`${pluginName}: .agents marketplace must declare installation and auth policy`);
    }
  }
}

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex === -1) return null;
  const fields = {};
  for (const line of normalized.slice(4, closingIndex).split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

async function walkFiles(dirPath) {
  const files = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

async function validateFrontmatterFile(filePath, componentName, requiredKeys, pluginName) {
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = parseFrontmatter(content);
  const relativeFile = path.relative(repoRoot, filePath);
  if (!parsed) {
    addError(`${pluginName}: ${componentName} missing YAML frontmatter: ${relativeFile}`);
    return;
  }
  for (const key of requiredKeys) {
    if (!parsed[key]?.length) {
      addError(`${pluginName}: ${componentName} missing "${key}" in frontmatter: ${relativeFile}`);
    }
  }
}

async function validateComponentFrontmatter(pluginDir, pluginName) {
  for (const [subdir, component, keys, match] of [
    ['rules', 'rule', ['description'], (f) => /\.(md|mdc|markdown)$/i.test(f)],
    ['skills', 'skill', ['name', 'description'], (f) => path.basename(f) === 'SKILL.md'],
    ['commands', 'command', ['name', 'description'], (f) => /\.(md|mdc|markdown|txt)$/i.test(f)],
  ]) {
    const dir = path.join(pluginDir, subdir);
    if (!(await pathExists(dir))) continue;
    for (const file of await walkFiles(dir)) {
      if (!match(file)) continue;
      await validateFrontmatterFile(file, component, keys, pluginName);
    }
  }
}

async function main() {
  console.log(`Validating: ${repoRoot}\n`);

  const marketplacePath = path.join(repoRoot, '.cursor-plugin', 'marketplace.json');
  const marketplace = await readJsonFile(marketplacePath, 'Marketplace manifest');
  if (!marketplace) {
    summarize();
    return;
  }

  if (typeof marketplace.name !== 'string' || !marketplaceNamePattern.test(marketplace.name)) {
    addError('Marketplace "name" must be lowercase kebab-case.');
  }
  if (!marketplace.owner?.name) {
    addError('Marketplace "owner.name" is required.');
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError('Marketplace "plugins" must be a non-empty array.');
    summarize();
    return;
  }

  for (const [index, entry] of marketplace.plugins.entries()) {
    const label = `plugins[${index}]`;
    if (!entry?.name || !pluginNamePattern.test(entry.name)) {
      addError(`${label}.name invalid`);
      continue;
    }
    const pluginDir = path.resolve(repoRoot, entry.source || '.');
    if (!(await pathExists(pluginDir))) {
      addError(`${label}: plugin directory missing: ${entry.source}`);
      continue;
    }

    const manifestPath = path.join(pluginDir, '.cursor-plugin', 'plugin.json');
    const pluginManifest = await readJsonFile(manifestPath, `${entry.name} plugin.json`);
    if (!pluginManifest) continue;

    if (pluginManifest.name !== entry.name) {
      addError(`${entry.name}: marketplace name !== plugin.json name ("${pluginManifest.name}")`);
    }

    await validateVersionConsistency(pluginDir, entry, pluginManifest, marketplace);
    await validatePortablePackaging(pluginDir, entry.name);

    if (pluginManifest.logo && !pluginManifest.logo.startsWith('http')) {
      const logoPath = path.join(pluginDir, pluginManifest.logo);
      if (!(await pathExists(logoPath))) {
        addError(`${entry.name}: logo missing at ${pluginManifest.logo}`);
      }
    }

    const mcpPath = path.join(pluginDir, 'mcp.json');
    if (!(await pathExists(mcpPath))) {
      addWarning(`${entry.name}: no mcp.json`);
    } else {
      const serverPath = path.join(pluginDir, 'mcp', 'server.mjs');
      if (!(await pathExists(serverPath))) {
        addError(`${entry.name}: mcp/server.mjs missing`);
      }
    }

    await validateComponentFrontmatter(pluginDir, entry.name);
  }

  summarize();
}

function summarize() {
  if (warnings.length) {
    console.log('Warnings:');
    warnings.forEach((w) => console.log(`  - ${w}`));
    console.log('');
  }
  if (errors.length) {
    console.error('Validation FAILED:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('Validation passed.');
}

await main();
