import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundlePath = path.join(pluginRoot, 'mcp', 'server.mjs');
const claudeManifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
const missingTokenMessage =
  'VALUESIGNAL_JWT_TOKEN is not set. Generate a token at https://app.valuesignal.ai/account-settings.html (Integrations & API tokens) and paste it into MCP env (see plugin README).';

const manifest = JSON.parse(await fs.readFile(claudeManifestPath, 'utf8'));
const claudeServer = manifest.mcpServers?.valuesignal;
assert.equal(claudeServer?.command, 'node');
assert.deepEqual(claudeServer?.args, ['${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs']);
console.log('PASS Claude manifest resolves the bundled server from CLAUDE_PLUGIN_ROOT');

// P-2: the token comes from a prompted, sensitive userConfig value. The manifest
// must not read a credential from the user's environment (directory review hold).
const apiToken = manifest.userConfig?.api_token;
assert.equal(apiToken?.type, 'string');
assert.equal(apiToken?.sensitive, true);
assert.equal(apiToken?.default, '');
assert.equal(claudeServer?.env?.VALUESIGNAL_PLUGIN_TOKEN, '${user_config.api_token}');
assert.ok(
  !Object.values(claudeServer?.env || {}).some((v) => /\$\{(?!user_config\.|CLAUDE_)/.test(v)),
  'Claude manifest env must not expand variables from the user environment'
);
console.log('PASS Claude manifest takes the token from a sensitive userConfig prompt');

const cleanRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'valuesignal-no-install-'));
const cleanMcpDir = path.join(cleanRoot, 'mcp');
await fs.mkdir(cleanMcpDir);
await fs.copyFile(bundlePath, path.join(cleanMcpDir, 'server.mjs'));

const env = { ...process.env };
delete env.VALUESIGNAL_JWT_TOKEN;
delete env.VALUESIGNAL_JWT;
delete env.VALUESIGNAL_PLUGIN_TOKEN;
env.VALUESIGNAL_API_BASE = 'http://127.0.0.1:1';
env.VALUESIGNAL_HOST = 'claude-code';

const child = spawn(process.execPath, ['mcp/server.mjs'], {
  cwd: cleanRoot,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');

let nextId = 1;
let stderr = '';
const pending = new Map();
const output = readline.createInterface({ input: child.stdout });
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
output.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter.resolve(message);
});

function request(method, params) {
  const id = nextId++;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}. Server stderr: ${stderr.trim()}`));
    }, 5000);
    pending.set(id, {
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return response;
}

try {
  const initialized = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'valuesignal-clean-room-test', version: '1.0.0' },
  });
  assert.equal(initialized.error, undefined, JSON.stringify(initialized.error));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const listed = await request('tools/list', {});
  assert.equal(listed.error, undefined, JSON.stringify(listed.error));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'valuesignal_auth_status'));
  console.log('PASS bundled MCP server starts and lists tools without node_modules');

  const auth = await request('tools/call', {
    name: 'valuesignal_auth_status',
    arguments: {},
  });
  assert.equal(auth.error, undefined, JSON.stringify(auth.error));
  assert.match(auth.result.content[0].text, /^Not authenticated\.\n1\. Log in at/m);
  console.log('PASS unset Claude token reaches the graceful auth-status path');

  const capture = await request('tools/call', {
    name: 'valuesignal_capture_turn',
    arguments: { userPrompt: 'hello', systemResponse: 'world' },
  });
  assert.equal(capture.error?.message, missingTokenMessage);
  console.log('PASS missing-token capture fails locally before any network request');
} finally {
  child.stdin.end();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  const [code, signal] = await exited;
  clearTimeout(timeout);
  output.close();
  await fs.rm(cleanRoot, { recursive: true, force: true });
  assert.equal(signal, null, `server was killed by ${signal}; stderr: ${stderr.trim()}`);
  assert.equal(code, 0, `server exited ${code}; stderr: ${stderr.trim()}`);
}
