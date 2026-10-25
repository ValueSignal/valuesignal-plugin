const PLUGIN_VERSION = '1.0.16';

/**
 * Host platforms the plugin knows how to declare. Must stay in sync with the
 * server's pluginHostPlatforms (mcp-server/src/ingress/types.ts) — an
 * unrecognized value is ignored server-side and the capture falls back to the
 * ingress route's source.
 */
const KNOWN_HOSTS = new Set(['cursor', 'codex', 'claude-code']);

/**
 * Which agent host is running this MCP server. The wire route and security
 * behaviour do not change with the host — this only determines what the
 * capture is stored and badged as.
 *
 *   1. VALUESIGNAL_HOST, when a host-specific manifest declares it
 *      (claude-code in .claude-plugin/plugin.json);
 *   2. the CLAUDECODE env var Claude Code sets for its child processes, for
 *      installs whose manifest predates VALUESIGNAL_HOST;
 *   3. CODEX_THREAD_ID, set by Codex for its task processes;
 *   4. cursor, the historical default.
 */
export function getPluginHost() {
  const declared = process.env.VALUESIGNAL_HOST?.trim().toLowerCase();
  if (declared && KNOWN_HOSTS.has(declared)) return declared;
  if (process.env.CLAUDECODE) return 'claude-code';
  if (process.env.CODEX_THREAD_ID) return 'codex';
  return 'cursor';
}

const DEFAULT_API_BASE = 'https://app.valuesignal.ai';

/** Hosts the plugin will talk to over plain HTTP — local development only. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Production domain suffix. Anything else must be opted into explicitly. */
const ALLOWED_SUFFIX = '.valuesignal.ai';
const ALLOWED_APEX = 'valuesignal.ai';

function extraAllowedHosts() {
  // Escape hatch for self-hosted / staging deployments. Comma-separated
  // hostnames, e.g. VALUESIGNAL_API_ALLOWED_HOSTS="vs.internal.acme.com".
  return (process.env.VALUESIGNAL_API_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * S4: validate VALUESIGNAL_API_BASE before any credential is attached to a
 * request. The MCP env is editable by anything that can write the workspace's
 * mcp.json, so an unvalidated base URL is a bearer-token exfiltration path:
 * point it at http://attacker.example and the plugin posts the user's PAT
 * there in an Authorization header, in cleartext.
 *
 * Rules:
 *   - must parse as a URL
 *   - http:// only for loopback hosts
 *   - https:// otherwise, and the host must be valuesignal.ai, a subdomain of
 *     it, or explicitly listed in VALUESIGNAL_API_ALLOWED_HOSTS
 */
export function assertAllowedApiBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `VALUESIGNAL_API_BASE is not a valid URL: ${JSON.stringify(raw)}. ` +
        `Remove it to use the default (${DEFAULT_API_BASE}).`
    );
  }

  const host = url.hostname.toLowerCase();
  const isLocal = LOCAL_HOSTS.has(host);

  if (url.protocol === 'http:') {
    if (!isLocal) {
      throw new Error(
        `VALUESIGNAL_API_BASE must use https:// (got ${url.protocol}//${host}). ` +
          'Plain HTTP would send your API token in cleartext. ' +
          'http:// is permitted only for localhost during development.'
      );
    }
    return url;
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      `VALUESIGNAL_API_BASE must use https:// (got ${url.protocol}). ` +
        `Remove it to use the default (${DEFAULT_API_BASE}).`
    );
  }

  const allowed =
    isLocal ||
    host === ALLOWED_APEX ||
    host.endsWith(ALLOWED_SUFFIX) ||
    extraAllowedHosts().includes(host);

  if (!allowed) {
    throw new Error(
      `VALUESIGNAL_API_BASE points at an unrecognized host (${host}). ` +
        'The plugin sends your API token to this address, so it will only talk to ' +
        `${ALLOWED_APEX} by default. If this host is intentional (self-hosted or ` +
        `staging), add it to VALUESIGNAL_API_ALLOWED_HOSTS.`
    );
  }

  return url;
}

export function getApiBase() {
  const raw = (process.env.VALUESIGNAL_API_BASE || DEFAULT_API_BASE).trim();
  assertAllowedApiBase(raw);
  return raw.replace(/\/$/, '').replace(/\/api$/, '');
}

/** An env value, or '' when unset or left as an unexpanded `${...}` placeholder. */
function envValue(name) {
  const value = process.env[name]?.trim() || '';
  return value.startsWith('${') ? '' : value;
}

/**
 * The API token, in precedence order:
 *   VALUESIGNAL_PLUGIN_TOKEN  Claude Code's prompted userConfig.api_token (stored in the
 *                             OS credential store, passed only to this server)
 *   VALUESIGNAL_JWT_TOKEN     the user's environment (Cursor, Codex, CLI shells)
 *   VALUESIGNAL_JWT           legacy name
 * The Claude manifest passes the prompted token under its own name so an empty
 * prompt never overrides a token the user already exports.
 */
export function getJwt() {
  return envValue('VALUESIGNAL_PLUGIN_TOKEN') || envValue('VALUESIGNAL_JWT_TOKEN') || envValue('VALUESIGNAL_JWT');
}

export function getPluginClientHeader() {
  // Host-neutral client id (1.0.13+). The server's plugin HMAC-exemption check
  // accepts this alongside the legacy Cursor-only client id from 1.0.12 and earlier.
  return `valuesignal-plugin/${PLUGIN_VERSION} (${getPluginHost()})`;
}
