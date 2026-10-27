// Source entrypoint for the committed, install-free mcp/server.mjs bundle.
// Run `npm run build:mcp` after changing this file or anything under lib/.
import { createMcpServer } from '../lib/mcp-stdio.mjs';
import { buildCaptureEvent, resolveAccount, resolveUserId, postPluginIngress, postProofCert } from '../lib/ingress-client.mjs';
import { getApiBase, getJwt, getPluginHost } from '../lib/config.mjs';
import { detectWorkspaceProjectRef, normalizeProjectRef } from '../lib/project-ref.mjs';

const serverInfo = { name: 'valuesignal', version: '1.0.17' };

// TOOL ANNOTATIONS
// `title` and `annotations` are required fields in both the Anthropic and
// OpenAI submission rubrics; the hints tell a host whether a call is safe to
// retry or to run without confirmation, so they must describe real behaviour.
//
//   capture_turn      writes, and is NOT idempotent — buildCaptureEvent mints a
//                     fresh idempotencyKey per call, so two identical calls
//                     create two events. Claiming otherwise would be a lie a
//                     reviewer can catch in one test.
//   build_proof       writes AND publishes a public verify URL — the one open-world tool.
//   capture_turn      writes to the user's private logbook: a known store, not the
//                     open internet. Closed world under the MCP spec (web search is
//                     open; a memory store is not) and under OpenAI's rubric, which
//                     defines openWorldHint as "affects publicly visible state".
//   auth_status       reads the local credential and asks ValueSignal which account
//                     owns it; reads nothing else and changes nothing, hence openWorld false.
//   dashboard_url     returns a string; no I/O at all.
//
// Nothing here is destructive: no tool deletes or overwrites user data.
const listTools = async () => ({
  tools: [
    {
      name: 'valuesignal_auth_status',
      title: 'Check ValueSignal connection',
      annotations: {
        title: 'Check ValueSignal connection',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'Check whether a ValueSignal API token is configured, which ValueSignal account (email) it belongs to, and which API base is used.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'valuesignal_capture_turn',
      title: 'Log an AI turn to ValueSignal',
      annotations: {
        title: 'Log an AI turn to ValueSignal',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Send one AI turn (user prompt + assistant response, credentials redacted first) to the user\'s private ValueSignal logbook for scoring. Also sends the workspace git remote as host/owner/repo, when there is one, to bind the capture to its project.',
      inputSchema: {
        type: 'object',
        properties: {
          userPrompt: { type: 'string', description: "The user's message, verbatim (not a summary or paraphrase)" },
          systemResponse: { type: 'string', description: 'Assistant response text (a faithful summary is acceptable for long responses)' },
          sessionId: {
            type: 'string',
            description: 'Optional stable session id for this conversation',
          },
          messageIndex: {
            type: 'number',
            description: 'Turn index within session (default 0)',
          },
        },
        required: ['userPrompt', 'systemResponse'],
      },
    },
    {
      name: 'valuesignal_dashboard_url',
      title: 'Open the ValueSignal dashboard',
      annotations: {
        title: 'Open the ValueSignal dashboard',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description: 'Return the URL of your ValueSignal dashboard (skill signals and recent sessions) to open in the browser. Makes no network request.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'valuesignal_build_proof',
      title: 'Mint a Proof of Work certification',
      annotations: {
        title: 'Mint a Proof of Work certification',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      description:
        'Mint a verifiable ValueSignal Proof of Work certification (vs.proof.v1) from your captured AI work. Returns the .valuesignal/ folder file contents to commit into a repo plus a public verify URL a screening partner can check. By default certifies the whole profile; pass scope "project" to certify only work bound to this workspace\u2019s repo (detected from the git origin remote) — the cert then discloses only project-relevant signal and the verifier enforces repo identity.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['whole_profile', 'project'],
            description: 'Certification scope (default whole_profile)',
          },
          projectRef: {
            type: 'string',
            description:
              'Repo to bind a project-scoped cert to (git remote URL or host/owner/repo). Defaults to this workspace\u2019s origin remote.',
          },
        },
      },
    },
  ],
});

const callTool = async ({ name, arguments: args }) => {

  if (name === 'valuesignal_auth_status') {
    const jwt = getJwt();
    const apiBase = getApiBase();
    if (!jwt) {
      return {
        content: [
          {
            type: 'text',
            text: [
              'Not authenticated.',
              '1. Log in at https://app.valuesignal.ai',
              '2. Account Settings → Integrations & API tokens → Generate token',
              getPluginHost() === 'claude-code'
                ? '3. Enter it in the prompt Claude Code shows when you enable the plugin, or set VALUESIGNAL_JWT_TOKEN in the environment Claude Code runs in'
                : '3. Set VALUESIGNAL_JWT_TOKEN in your Cursor, Claude Code, or Codex MCP environment',
            ].join('\n'),
          },
        ],
      };
    }
    let account = { userId: 'unknown', email: null };
    try {
      account = await resolveAccount(jwt);
    } catch {
      /* ignore: report what we can */
    }
    return {
      content: [
        {
          type: 'text',
          text: [
            'Configured.',
            `Account: ${account.email || 'email unavailable (check the token was created in the account you use)'}`,
            `API: ${apiBase}`,
            `Account id: ${account.userId}`,
          ].join('\n'),
        },
      ],
    };
  }

  if (name === 'valuesignal_dashboard_url') {
    const base = getApiBase().replace(/\/api$/, '');
    const web =
      base.includes('app.valuesignal.ai') || base.includes('valuesignal.ai')
        ? 'https://app.valuesignal.ai/user-dashboard.html'
        : `${base}/user-dashboard.html`;
    return {
      content: [{ type: 'text', text: web }],
    };
  }

  if (name === 'valuesignal_capture_turn') {
    const jwt = getJwt();
    const userId = await resolveUserId(jwt);
    const projectRef = await detectWorkspaceProjectRef();
    const event = buildCaptureEvent({
      userId,
      workspaceId: userId,
      sessionId: args?.sessionId,
      messageIndex: Number.isFinite(args?.messageIndex) ? args.messageIndex : 0,
      userPrompt: String(args?.userPrompt || ''),
      systemResponse: String(args?.systemResponse || ''),
      projectRef,
    });
    const result = await postPluginIngress(event);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              status: result.accepted ? 'accepted' : result.status || result,
              duplicate: Boolean(result.duplicate),
              traceId: result.traceId,
              sessionId: event.sessionId,
              capturedAt: event.capturedAt,
              evidenceType: result.evidenceType,
              trustTier: result.trustTier,
              scoresPersisted: result.scoresPersisted ?? null,
              projectRef: event.payload.projectRef || null,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'valuesignal_build_proof') {
    let scope = args?.scope === 'project' ? 'project' : 'whole_profile';
    let projectRef = null;
    if (scope === 'project') {
      projectRef = normalizeProjectRef(args?.projectRef) || (await detectWorkspaceProjectRef());
      if (!projectRef) {
        return {
          content: [
            {
              type: 'text',
              text: 'Project-scoped certification needs a repo identity, but this workspace has no git origin remote and no projectRef was provided. Pass projectRef (e.g. github.com/owner/repo) or run from a repo with a remote — or mint with scope "whole_profile".',
            },
          ],
        };
      }
    }
    const result = await postProofCert({ scope, projectRef });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              certId: result.certId,
              schemaVersion: result.schemaVersion,
              issuedAt: result.issuedAt,
              expiresAt: result.expiresAt,
              verifyUrl: result.verifyUrl,
              publicUrl: result.publicUrl,
              scope: result.proof?.scope || scope,
              project: result.proof?.project || null,
              summary: {
                proofType: result.proof?.proofType,
                overallSignal: result.proof?.overallSignal,
                sessions: result.proof?.sessions,
                signals: result.proof?.signals,
                domains: (result.proof?.topDomains || []).map((d) => d.label),
              },
              files: result.files,
              nextStep:
                'Write each entry in `files` to the repo (paths are relative to the repo root), then commit VERIFICATION.md and the .valuesignal/ folder. The verifyUrl lets any screening partner confirm this certification is authentic, unrevoked, and fresh.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
};

createMcpServer({ serverInfo, listTools, callTool }).listen();
