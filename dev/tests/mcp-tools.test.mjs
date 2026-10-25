/**
 * B1 — every tool must advertise a title and all four annotation hints.
 * Run (from dev/): node tests/mcp-tools.test.mjs
 *
 * Both the Anthropic and OpenAI submission rubrics require these fields, and a
 * host uses the hints to decide whether a call is safe to retry or to run
 * without asking. This drives the real MCP client over stdio rather than
 * reading the source, so it asserts what a host actually receives — the same
 * thing a reviewer will test.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRED_HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

/** What each tool must keep promising. Changing a value here changes what we
 *  tell a host about side effects, so it should be a deliberate edit. */
const EXPECTED = {
  valuesignal_auth_status:   { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
  valuesignal_capture_turn:  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  valuesignal_dashboard_url: { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
  valuesignal_build_proof:   { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true  },
};

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL ${msg}`); };

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['mcp/server.mjs'],
  cwd: PLUGIN_ROOT,
  stderr: 'pipe',
});
const client = new Client({ name: 'mcp-tools-test', version: '1' }, { capabilities: {} });

let tools;
try {
  await client.connect(transport);
  ({ tools } = await client.listTools());
} catch (error) {
  console.error('Could not reach the MCP server over stdio.');
  console.error(`  ${error.message}`);
  const err = transport.stderr;
  if (err) {
    const chunks = [];
    err.on('data', (d) => chunks.push(d));
    await new Promise((r) => setTimeout(r, 250));
    if (chunks.length) console.error('  server stderr:\n' + Buffer.concat(chunks).toString().trim());
  }
  process.exit(1);
}

console.log(`tools/list returned ${tools.length} tool(s)\n`);

const seen = new Set();
for (const tool of tools) {
  seen.add(tool.name);
  const a = tool.annotations || {};
  const before = failures;

  if (!tool.title && !a.title) fail(`${tool.name}: no title on the tool or its annotations`);
  for (const hint of REQUIRED_HINTS) {
    if (typeof a[hint] !== 'boolean') fail(`${tool.name}: annotations.${hint} is ${JSON.stringify(a[hint])}, expected a boolean`);
  }
  const expected = EXPECTED[tool.name];
  if (!expected) {
    fail(`${tool.name}: tool has no declared expectation — add it to EXPECTED`);
  } else {
    for (const [hint, want] of Object.entries(expected)) {
      if (a[hint] !== want) fail(`${tool.name}: ${hint} is ${a[hint]}, expected ${want}`);
    }
  }

  if (failures === before) {
    console.log(`PASS ${tool.name}`);
    console.log(`       "${tool.title || a.title}" — readOnly=${a.readOnlyHint} destructive=${a.destructiveHint} idempotent=${a.idempotentHint} openWorld=${a.openWorldHint}`);
  }
}

for (const name of Object.keys(EXPECTED)) {
  if (!seen.has(name)) fail(`${name}: declared in EXPECTED but absent from tools/list`);
}

await client.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll tools advertise a title and all four annotation hints.');
