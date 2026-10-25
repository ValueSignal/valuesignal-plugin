/**
 * H-8 — the hand-written stdio MCP layer that replaced the SDK in the bundle.
 * Run: node tests/mcp-stdio.test.mjs
 *
 * mcp-tools.test.mjs proves a real SDK client can talk to the bundle. This file
 * covers the edges a well-behaved client never sends: unknown versions, bad
 * ids, notifications, malformed lines, and oversized input.
 */
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  createMcpServer,
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  McpError,
} from '../../lib/mcp-stdio.mjs';

const serverInfo = { name: 'test', version: '0.0.0' };
const server = createMcpServer({
  serverInfo,
  listTools: async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }),
  callTool: async ({ name, arguments: args }) => {
    if (name === 'echo') return { content: [{ type: 'text', text: JSON.stringify(args ?? null) }] };
    if (name === 'typed') throw new McpError(ErrorCode.InvalidParams, 'bad input');
    throw new Error(`Unknown tool: ${name}`);
  },
});
const req = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

await test('initialize echoes a supported version', async () => {
  const r = await server.handle(req(1, 'initialize', { protocolVersion: '2025-06-18' }));
  assert.deepEqual(r.result, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo });
});

await test('initialize answers an unknown version with the latest', async () => {
  const r = await server.handle(req(1, 'initialize', { protocolVersion: '1999-01-01' }));
  assert.equal(r.result.protocolVersion, LATEST_PROTOCOL_VERSION);
});

await test('ping, tools/list, tools/call', async () => {
  assert.deepEqual((await server.handle(req('a', 'ping'))).result, {});
  assert.equal((await server.handle(req(2, 'tools/list'))).result.tools[0].name, 'echo');
  const r = await server.handle(req(3, 'tools/call', { name: 'echo', arguments: { x: 1 } }));
  assert.equal(r.result.content[0].text, '{"x":1}');
});

await test('notifications and responses get no reply', async () => {
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await server.handle({ jsonrpc: '2.0', id: 9, result: {} }), null);
});

await test('non-2.0 and non-object messages are dropped', async () => {
  assert.equal(await server.handle({ id: 1, method: 'ping' }), null);
  assert.equal(await server.handle([req(1, 'ping')]), null);
  assert.equal(await server.handle('ping'), null);
});

await test('null or object ids are Invalid Request', async () => {
  for (const id of [null, {}, NaN]) {
    const r = await server.handle(req(id, 'ping'));
    assert.equal(r.error.code, ErrorCode.InvalidRequest);
    assert.equal(r.id, null);
  }
});

await test('unknown method, including inherited names, is Method not found', async () => {
  for (const method of ['resources/list', 'constructor', '__proto__', 'toString']) {
    const r = await server.handle(req(4, method));
    assert.equal(r.error.code, ErrorCode.MethodNotFound, method);
  }
});

await test('tools/call param validation', async () => {
  assert.equal((await server.handle(req(5, 'tools/call', {}))).error.code, ErrorCode.InvalidParams);
  assert.equal((await server.handle(req(5, 'tools/call'))).error.code, ErrorCode.InvalidParams);
  assert.equal((await server.handle(req(5, 'tools/call', { name: 'echo', arguments: [1] }))).error.code, ErrorCode.InvalidParams);
});

await test('handler errors keep their code or map to Internal error', async () => {
  const typed = await server.handle(req(6, 'tools/call', { name: 'typed' }));
  assert.deepEqual(typed.error, { code: ErrorCode.InvalidParams, message: 'bad input' });
  const plain = await server.handle(req(7, 'tools/call', { name: 'nope' }));
  assert.deepEqual(plain.error, { code: ErrorCode.InternalError, message: 'Unknown tool: nope' });
});

// Stream-level behaviour: drive listen() through in-memory streams.
const run = async (chunks) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  output.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
  const stderrWrite = process.stderr.write;
  process.stderr.write = () => true; // keep expected diagnostics out of the test log
  try {
    server.listen(input, output);
    for (const c of chunks) input.write(c);
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.stderr.write = stderrWrite;
  }
  return lines.map((l) => JSON.parse(l));
};

await test('listen: split chunks, CRLF, blank and malformed lines', async () => {
  const msg = JSON.stringify(req(1, 'ping'));
  const out = await run([msg.slice(0, 10), `${msg.slice(10)}\r\n`, '\n', 'not json\n', `${JSON.stringify(req(2, 'ping'))}\n`]);
  assert.deepEqual(out.map((r) => r.id).sort(), [1, 2]);
});

await test('listen: an oversized message is dropped and the stream recovers', async () => {
  const big = 'x'.repeat(MAX_MESSAGE_BYTES + 1);
  const out = await run([big, 'still the same line\n', `${JSON.stringify(req(3, 'ping'))}\n`]);
  assert.deepEqual(out.map((r) => r.id), [3]);
});

console.log(`\n${passed} passed`);
