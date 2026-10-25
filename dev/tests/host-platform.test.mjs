import assert from 'node:assert/strict';
import { getJwt, getPluginClientHeader, getPluginHost } from '../../lib/config.mjs';
import { buildCaptureEvent } from '../../lib/ingress-client.mjs';

const originalHost = process.env.VALUESIGNAL_HOST;
const originalClaudeCode = process.env.CLAUDECODE;
const originalCodexThreadId = process.env.CODEX_THREAD_ID;

function setOptionalEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setHostEnvironment(host, claudeCode, codexThreadId) {
  setOptionalEnv('VALUESIGNAL_HOST', host);
  setOptionalEnv('CLAUDECODE', claudeCode);
  setOptionalEnv('CODEX_THREAD_ID', codexThreadId);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

try {
  check('Cursor is the backward-compatible default host', () => {
    setHostEnvironment(undefined, undefined);
    assert.equal(getPluginHost(), 'cursor');
    assert.equal(getPluginClientHeader(), 'valuesignal-plugin/1.0.16 (cursor)');
  });

  check('Claude Code is detected from its process environment', () => {
    setHostEnvironment(undefined, '1');
    assert.equal(getPluginHost(), 'claude-code');
  });

  check('Codex is detected from its task environment', () => {
    setHostEnvironment(undefined, undefined, 'thread-1');
    assert.equal(getPluginHost(), 'codex');
    assert.equal(getPluginClientHeader(), 'valuesignal-plugin/1.0.16 (codex)');
  });

  check('an explicit known host takes precedence', () => {
    setHostEnvironment('codex', '1');
    assert.equal(getPluginHost(), 'codex');
    assert.equal(getPluginClientHeader(), 'valuesignal-plugin/1.0.16 (codex)');
  });

  check('unknown explicit hosts cannot escape the supported platform set', () => {
    setHostEnvironment('unknown-agent', undefined);
    assert.equal(getPluginHost(), 'cursor');
  });

  check('capture events keep the shared wire route and declare the actual host', () => {
    setHostEnvironment('claude-code', undefined);
    const event = buildCaptureEvent({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      userPrompt: 'Plan the migration',
      systemResponse: 'Here is the plan',
    });

    assert.equal(event.source, 'cursor');
    assert.equal(event.host, 'claude-code');
    assert.equal(event.sourceSubtype, 'claude-code-marketplace');
    assert.equal(event.payload.provider, 'claude-code');
    assert.match(event.sessionId, /^claude-code-/);
    assert.match(event.idempotencyKey, /^claude-code-/);
    assert.equal(event.metadata.client, 'valuesignal-plugin/1.0.16 (claude-code)');
    assert.equal('validationMode' in event.payload.interactionMetadata, false);
  });
} finally {
  setOptionalEnv('VALUESIGNAL_HOST', originalHost);
  setOptionalEnv('CLAUDECODE', originalClaudeCode);
  setOptionalEnv('CODEX_THREAD_ID', originalCodexThreadId);
}

// P-2: token precedence. The prompted Claude token wins; an empty prompt or an
// unexpanded placeholder never hides a token the user exports.
const TOKEN_VARS = ['VALUESIGNAL_PLUGIN_TOKEN', 'VALUESIGNAL_JWT_TOKEN', 'VALUESIGNAL_JWT'];
const originalTokens = Object.fromEntries(TOKEN_VARS.map((n) => [n, process.env[n]]));
const setTokens = (plugin, jwtToken, jwt) => {
  setOptionalEnv('VALUESIGNAL_PLUGIN_TOKEN', plugin);
  setOptionalEnv('VALUESIGNAL_JWT_TOKEN', jwtToken);
  setOptionalEnv('VALUESIGNAL_JWT', jwt);
};
try {
  check('prompted Claude token takes precedence', () => {
    setTokens(' vs_pat_prompt ', 'vs_pat_env', 'legacy');
    assert.equal(getJwt(), 'vs_pat_prompt');
  });
  check('empty prompt falls back to the exported token', () => {
    setTokens('', 'vs_pat_env', undefined);
    assert.equal(getJwt(), 'vs_pat_env');
  });
  check('unexpanded placeholders count as unset', () => {
    setTokens('${user_config.api_token}', '${VALUESIGNAL_JWT_TOKEN}', 'legacy');
    assert.equal(getJwt(), 'legacy');
  });
  check('no token anywhere is empty', () => {
    setTokens(undefined, undefined, undefined);
    assert.equal(getJwt(), '');
  });
} finally {
  for (const [n, v] of Object.entries(originalTokens)) setOptionalEnv(n, v);
}

console.log(`\n${passed} host-platform tests passed.`);
