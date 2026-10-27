import { randomUUID } from 'crypto';
import { getApiBase, getJwt, getPluginClientHeader, getPluginHost } from './config.mjs';
import { redactCredentials, redactCredentialsDeep } from './redact.mjs';

const MISSING_TOKEN_ERROR =
  'VALUESIGNAL_JWT_TOKEN is not set. Generate a token at https://app.valuesignal.ai/account-settings.html (Integrations & API tokens) and paste it into MCP env (see plugin README).';

function requireToken(token = getJwt()) {
  if (!token) throw new Error(MISSING_TOKEN_ERROR);
  return token;
}

export function buildCaptureEvent({
  userId,
  workspaceId,
  sessionId,
  messageIndex = 0,
  userPrompt,
  systemResponse,
  model = null,
  provider = null,
  projectRef = null,
}) {
  const host = getPluginHost();
  const sid = sessionId || `${host}-${randomUUID()}`;

  // B3: strip credentials before the capture is ever serialized, so a secret
  // pasted into a prompt or echoed by the agent never leaves this machine.
  const prompt = redactCredentials(userPrompt || '');
  const response = redactCredentials(systemResponse || '');
  const scrubbedProjectRef = projectRef ? redactCredentialsDeep(projectRef) : null;
  const clientRedactionCount = prompt.count + response.count + (scrubbedProjectRef?.count || 0);

  return {
    eventId: `evt_${randomUUID()}`,
    idempotencyKey: `${host}-${randomUUID()}`,
    traceId: `trace_${randomUUID()}`,
    // `source` is the wire-route contract (/api/ingress/cursor) and drives the
    // server's security path; `host` is the platform actually running the
    // plugin, which the server validates and stores as the capture's source.
    source: 'cursor',
    sourceSubtype: `${host}-marketplace`,
    host,
    workspaceId,
    userId,
    sessionId: sid,
    sessionOrigin: 'client-provided',
    eventType: 'message.captured',
    messageIndex,
    capturedAt: new Date().toISOString(),
    payload: {
      userPrompt: prompt.text || '',
      systemResponse: response.text || '',
      model,
      provider: provider ?? host,
      conversationId: sid,
      // Repo identity declared by tooling at the moment of work: binds this
      // capture to the workspace's project for project-scoped certifications.
      ...(scrubbedProjectRef ? { projectRef: scrubbedProjectRef.value } : {}),
      interactionMetadata: {
        source_type: 'chat_page',
        operatorIntent: 'user_authored',
        // Audit signal only — never the redacted content itself.
        clientRedactionApplied: clientRedactionCount > 0,
        clientRedactionCount,
      },
    },
    metadata: {
      client: getPluginClientHeader(),
    },
  };
}

export async function postPluginIngress(event) {
  const jwt = requireToken();

  const apiBase = getApiBase();
  const rawPayload = JSON.stringify(event);
  // Replay protection. The plugin is open source so it ships no HMAC secret,
  // but a nonce needs none: the server consumes it once within a short TTL,
  // which stops a captured request from being replayed to inflate a profile.
  const res = await fetch(`${apiBase}/api/ingress/cursor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      'x-vs-plugin-client': getPluginClientHeader(),
      'x-vs-nonce': randomUUID(),
      'x-vs-timestamp': String(Date.now()),
    },
    body: rawPayload,
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = body?.error || body?.reason || res.statusText || `HTTP ${res.status}`;
    throw new Error(`Ingress failed (${res.status}): ${msg}`);
  }

  return body;
}

/**
 * Mint a proof-of-work certification (vs.proof.v1). Returns the server body:
 * certId, verifyUrl, publicUrl, expiry, and the `.valuesignal/` file contents
 * for the agent to write into the candidate's repo.
 */
export async function postProofCert({ scope, projectRef } = {}) {
  const jwt = requireToken();

  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/proof/cert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      'x-vs-plugin-client': getPluginClientHeader(),
    },
    body: JSON.stringify(scope === 'project' && projectRef ? { scope, projectRef } : {}),
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = body?.message || body?.error || body?.reason || res.statusText || `HTTP ${res.status}`;
    throw new Error(`Proof certification failed (${res.status}): ${msg}`);
  }

  return body;
}

export function decodeJwtSub(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
  const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  if (!payload?.sub) throw new Error('JWT missing sub');
  return payload.sub;
}

function looksLikeJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3 && !token.startsWith('vs_pat_');
}

// Per-process cache so each credential needs at most one whoami round-trip.
const accountCache = new Map();

async function fetchWhoami(token) {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/ingress/whoami`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-vs-plugin-client': getPluginClientHeader(),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not resolve account from token (${res.status}): ${text || res.statusText}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!body?.userId) throw new Error('whoami did not return a userId');
  return { userId: body.userId, email: typeof body.email === 'string' ? body.email : null };
}

/**
 * Resolve the account behind the configured credential: `{ userId, email }`.
 * Always asks the server, because only the server knows the email, and the
 * email is what a user recognizes (the web app never shows user ids). A
 * session JWT falls back to its local `sub` claim when the server is
 * unreachable; `email` is null when unknown or when the server predates it.
 */
export async function resolveAccount(token) {
  requireToken(token);
  if (accountCache.has(token)) return accountCache.get(token);

  let account;
  try {
    account = await fetchWhoami(token);
  } catch (err) {
    if (!looksLikeJwt(token)) throw err;
    account = { userId: decodeJwtSub(token), email: null };
  }
  accountCache.set(token, account);
  return account;
}

/**
 * Resolve the ValueSignal user id for the configured credential.
 *   - Session JWT: decoded locally (no network), preserving existing behavior.
 *   - Scoped PAT (`vs_pat_…`): resolved via the ingress `whoami` endpoint,
 *     since a PAT carries no decodable claims.
 */
export async function resolveUserId(token) {
  requireToken(token);
  if (looksLikeJwt(token)) {
    return decodeJwtSub(token);
  }
  return (await resolveAccount(token)).userId;
}
