/**
 * Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
 *
 * Replaces @modelcontextprotocol/sdk in the shipped bundle (backlog H-8): the
 * SDK and its validators were ~550 KB of the 582 KB bundle, over the Anthropic
 * directory's 256 KiB per-file review threshold. This server only needs
 * initialize, ping, tools/list, and tools/call, so it implements exactly that.
 *
 * Behaviour matches the SDK's low-level Server as recorded before the switch:
 *   - initialize echoes a supported protocolVersion, else answers with the latest
 *   - unknown methods return -32601; a throwing handler returns -32603 with its message
 *   - notifications and responses get no reply
 *   - malformed lines (invalid JSON, batches, non-2.0) are dropped without a reply
 * One deliberate difference: tools/call without a string `name` returns -32602.
 *
 * stdout carries protocol messages only. Diagnostics go to stderr and never
 * include message content, which can hold user prompts.
 */

export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

// A capture carries one prompt and one response; 16 MiB is far above any real
// turn and stops an unterminated stream from growing the buffer without bound.
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export const ErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
};

export class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isValidId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

/**
 * @param {object} options
 * @param {{name: string, version: string}} options.serverInfo
 * @param {() => Promise<{tools: object[]}>} options.listTools
 * @param {(params: {name: string, arguments?: object}) => Promise<object>} options.callTool
 */
export function createMcpServer({ serverInfo, listTools, callTool }) {
  const methods = new Map([
    ['initialize', async (params) => {
      const requested = isObject(params) ? params.protocolVersion : undefined;
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      };
    }],
    ['ping', async () => ({})],
    ['tools/list', async () => listTools()],
    ['tools/call', async (params) => {
      if (!isObject(params) || typeof params.name !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid params: tools/call requires a string params.name');
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid params: tools/call params.arguments must be an object');
      }
      return callTool({ name: params.name, arguments: params.arguments });
    }],
  ]);

  /** Handle one parsed message. Returns the response object, or null when no reply is due. */
  async function handle(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0') return null;
    if (typeof message.method !== 'string') return null; // a response to a request we never send
    if (!('id' in message)) return null; // notification: initialized, cancelled, and the rest
    if (!isValidId(message.id)) {
      return { jsonrpc: '2.0', id: null, error: { code: ErrorCode.InvalidRequest, message: 'Invalid Request' } };
    }
    const { id } = message;
    const method = methods.get(message.method);
    if (!method) {
      return { jsonrpc: '2.0', id, error: { code: ErrorCode.MethodNotFound, message: 'Method not found' } };
    }
    try {
      const result = await method(message.params);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      const code = Number.isInteger(error?.code) ? error.code : ErrorCode.InternalError;
      return { jsonrpc: '2.0', id, error: { code, message: String(error?.message ?? 'Internal error') } };
    }
  }

  /** Read newline-delimited messages from `input` and write responses to `output`. */
  function listen(input = process.stdin, output = process.stdout) {
    let buffer = '';
    let discarding = false;
    const write = (response) => {
      if (response) output.write(`${JSON.stringify(response)}\n`);
    };
    const dispatch = (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write('valuesignal: ignored a malformed message\n');
        return;
      }
      handle(message).then(write, (error) => {
        process.stderr.write(`valuesignal: handler failure: ${error?.message ?? error}\n`);
      });
    };

    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (discarding) {
          discarding = false;
          continue;
        }
        if (line.trim()) dispatch(line);
      }
      // String length (UTF-16 units) is a cheap lower bound on bytes; checking it
      // per chunk avoids re-encoding a large buffer on every read.
      if (buffer.length > MAX_MESSAGE_BYTES) {
        process.stderr.write('valuesignal: dropped a message over the size limit\n');
        buffer = '';
        discarding = true;
      }
    });
  }

  return { handle, listen };
}
