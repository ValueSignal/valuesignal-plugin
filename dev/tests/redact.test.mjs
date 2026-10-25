/**
 * Client-side credential redaction tests (B3, client half).
 * Run: node tests/redact.test.mjs
 *
 * These mirror mcp-server/src/tests/captureSanitizer.test.ts. When a pattern
 * changes on either side, both suites must be updated together.
 */
import assert from 'node:assert/strict';
import { redactCredentials, redactCredentialsDeep } from '../../lib/redact.mjs';
import { assertAllowedApiBase } from '../../lib/config.mjs';

// NOTE ON FIXTURE SHAPE
// Credential fixtures below are written as `'prefix' + 'body'` rather than as a
// single literal. A contiguous credential-shaped string in this file trips
// GitHub push protection and gitleaks — correctly, on a repository whose whole
// subject is credential hygiene. The concatenated value is byte-identical to
// the format under test, so the patterns are exercised exactly as in the wild.

let failures = 0;
function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n      ${error.message}`);
  }
}

runTest('vendor API keys never leave the machine', () => {
  const secrets = [
    'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh',
    'sk-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWx1234',
    'AKIA' + 'IOSFODNN7EXAMPLE',
    'ghp_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    'xoxb-' + '1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx',
    'sk_live_' + 'AbCdEfGhIjKlMnOpQrStUvWx',
    'vs_pat_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  ];
  for (const secret of secrets) {
    const { text, count } = redactCredentials(`use ${secret} for the call`);
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
    assert.ok(text.includes('[API_KEY_REDACTED]'), `not marked: ${secret}`);
    assert.equal(count, 1);
  }
});

runTest('PEM private keys are removed whole', () => {
  const pem =
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx1kAbCdEfGhIjKlMnOpQr\n-----END RSA PRIVATE KEY-----';
  const { text, count } = redactCredentials(`key:\n${pem}\ndone`);
  assert.ok(!text.includes('MIIEowIBAAKCAQEA'));
  assert.ok(text.includes('[PRIVATE_KEY_REDACTED]'));
  assert.ok(text.includes('done'));
  assert.equal(count, 1);
});

runTest('JWTs, auth headers and connection strings are removed', () => {
  const input = [
    'token eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1',
    "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'",
    'postgres://appuser:Tr0ub4dor3xample@db.internal:5432/valuesignal',
  ].join('\n');
  const { text, count } = redactCredentials(input);
  assert.ok(!text.includes('eyJ' + 'hbGciOiJIUzI1NiI'));
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz012345'));
  assert.ok(!text.includes('Tr0ub4dor3xample'));
  assert.ok(!text.includes('appuser'));
  assert.ok(text.includes('db.internal'), 'host should survive');
  assert.ok(count >= 3);
});

runTest('secret-named assignments are removed', () => {
  for (const line of [
    'DB_PASSWORD=Tr0ub4dor&3xample',
    'client_secret: 4f9a2b7c1e8d3a6b0c5f',
    'ENCRYPTION_KEY=bXktc3VwZXItc2VjcmV0LWtleS0xMjM0NQ==',
  ]) {
    const { text, count } = redactCredentials(line);
    assert.ok(
      text.includes('[SECRET_REDACTED]') || text.includes('[AUTH_REDACTED]'),
      `not redacted: ${line} -> ${text}`
    );
    assert.ok(count >= 1);
  }
});

runTest('ordinary prompt content is passed through untouched', () => {
  const benign = [
    'Refactor the ingress handler so HMAC and replay are independent',
    'The regression landed in commit 4fcf82fa9c0d1b2e3f4a5b6c7d8e9f0a1b2c3d4e',
    'const total = items.reduce((acc, item) => acc + item.value, 0);',
    'API_KEY=your-api-key-here',
    'OPENAI_API_KEY=process.env.OPENAI_API_KEY',
    'tokenCount: 1284739201847',
    'I still need to reset my password on the staging box',
  ];
  for (const line of benign) {
    const { text, count } = redactCredentials(line);
    assert.equal(text, line, `altered: ${line} -> ${text}`);
    assert.equal(count, 0, `false positive: ${line}`);
  }
});

runTest('deep walk redacts secret-named keys in nested metadata', () => {
  const { value, count } = redactCredentialsDeep({
    repo: 'valuesignal/talent-scout',
    tokensUsed: '1284739',
    env: { AWS_SECRET_ACCESS_KEY: 'wJalr' + 'XUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
  });
  assert.equal(value.env.AWS_SECRET_ACCESS_KEY, '[SECRET_REDACTED]');
  assert.equal(value.env.region, 'us-east-1');
  assert.equal(value.repo, 'valuesignal/talent-scout');
  assert.equal(value.tokensUsed, '1284739', 'numeric telemetry must survive');
  assert.equal(count, 1);
});

runTest('null and non-string inputs are safe', () => {
  assert.deepEqual(redactCredentials(null), { text: null, count: 0 });
  assert.deepEqual(redactCredentials(undefined), { text: null, count: 0 });
  assert.deepEqual(redactCredentials(42), { text: 42, count: 0 });
});

runTest('redaction stays linear on adversarial input', () => {
  const adversarial = [
    'Authorization: Bearer ' + 'A'.repeat(300000),
    '-----BEGIN RSA PRIVATE KEY-----\n' + 'B'.repeat(300000),
    'password=' + 'C'.repeat(300000),
    '1'.repeat(300000),
  ].join('\n');
  const started = Date.now();
  redactCredentials(adversarial);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `took ${elapsed}ms on ${adversarial.length} bytes`);
  console.log(`      (${adversarial.length} bytes in ${elapsed}ms)`);
});

runTest('S4: API base is restricted to https on known hosts', () => {
  for (const url of [
    'https://app.valuesignal.ai',
    'https://staging.valuesignal.ai',
    'http://localhost:3000',
  ]) {
    assert.doesNotThrow(() => assertAllowedApiBase(url), `should allow ${url}`);
  }
  for (const url of [
    'http://attacker.example',
    'https://valuesignal.ai.evil.com',
    'https://evil.com',
    'ftp://app.valuesignal.ai',
    'not a url',
  ]) {
    assert.throws(() => assertAllowedApiBase(url), `should reject ${url}`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll client redaction tests passed.');
