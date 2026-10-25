import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(pluginRoot, relativePath), 'utf8'));

const portable = await readJson('plugin.json');
const codex = await readJson('.codex-plugin/plugin.json');
const mcp = await readJson('mcp.json');
const marketplace = await readJson('.agents/plugins/marketplace.json');

assert.equal(
  portable.$schema,
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
);
assert.equal(portable.name, 'valuesignal');
assert.equal(codex.version, portable.version);
assert.deepEqual(codex.interface, portable.extensions?.['com.openai']?.interface);
for (const field of [
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
]) {
  assert.deepEqual(codex[field], portable[field], `.codex-plugin ${field} must be derived`);
}
console.log('PASS portable and Codex manifests share one identity and interface');

assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
const server = mcp.mcpServers?.valuesignal;
assert.equal(server?.type, 'stdio');
assert.equal(server?.command, 'node');
assert.deepEqual(server?.args, ['mcp/server.mjs']);
assert.equal(server?.env?.VALUESIGNAL_API_BASE, 'https://app.valuesignal.ai');
assert.equal('VALUESIGNAL_HOST' in (server?.env || {}), false);
assert.equal('VALUESIGNAL_JWT_TOKEN' in (server?.env || {}), false);
await fs.access(path.join(pluginRoot, 'mcp', 'server.mjs'));
console.log('PASS portable MCP config launches the bundled server without embedding credentials');

assert.equal(marketplace.name, 'valuesignal');
assert.equal(marketplace.interface?.displayName, 'ValueSignal');
assert.equal(marketplace.plugins?.length, 1);
const entry = marketplace.plugins[0];
assert.equal(entry.name, portable.name);
assert.deepEqual(entry.source, { source: 'local', path: './' });
assert.deepEqual(entry.policy, {
  installation: 'AVAILABLE',
  authentication: 'ON_INSTALL',
});
assert.equal(entry.category, 'Productivity');
console.log('PASS repo marketplace resolves the plugin from the public repository root');

for (const asset of [
  portable.extensions['com.openai'].interface.composerIcon,
  portable.extensions['com.openai'].interface.logo,
]) {
  await fs.access(path.join(pluginRoot, asset));
}
console.log('PASS Codex interface assets are packaged');
