# ValueSignal for Cursor, Claude Code, and Codex

Turn real AI-assisted work into a verified builder profile: measured skill signals in a private logbook, with verifiable proof of work when you choose to share it.

## What you are building

Every turn you capture is evidence. Over multiple real sessions, that evidence compounds into a profile that reflects how you work with AI:

1. **Capture** — submit meaningful AI turns to ValueSignal when you choose, using `valuesignal_capture_turn`.
2. **Accumulate signals** — each capture is scored into skill and behavior signals.
3. **Build your profile** — signals roll up into your strongest domains and skill signature.
4. **Create proof** — mint a verifiable Proof of Work certification (`vs.proof.v1`) for your whole profile or for one repository.

When the host runs in a workspace with a Git remote, the plugin binds captures to that repository identity. This supports project-scoped certifications that disclose only the relevant validated work.

ValueSignal is private by default. Nothing is shared until you choose to create or publish an artifact.

## Requirements

- A [ValueSignal account](https://app.valuesignal.ai)
- Node.js 18 or newer available to the host
- A scoped ValueSignal API token

Marketplace installs include the bundled MCP runtime and do not require `npm install`. The server has no runtime dependencies. Development tooling (build script, tests, and their dependencies) lives in `dev/` and is not used by the installed plugin.

## Create an API token

1. Log in at [app.valuesignal.ai](https://app.valuesignal.ai).
2. Open **Account Settings → Integrations & API tokens**.
3. Generate a token and copy the `vs_pat_…` value. It is shown once.

The token permits ValueSignal activity capture and is revocable. It does not grant account or billing access. A short-lived browser session token still works as a fallback, but the scoped API token is recommended.

## Install in Cursor

Install or enable the ValueSignal marketplace plugin, then open:

**Cursor → Settings → Features → Model Context Protocol → valuesignal → Edit**

Set:

- `VALUESIGNAL_JWT_TOKEN` to the token you generated
- Optionally, `VALUESIGNAL_API_BASE` to `https://app.valuesignal.ai`

Enable the MCP server and run **Developer: Reload Window**.

## Install in Claude Code

Install from the public marketplace:

```bash
claude plugin marketplace add ValueSignal/valuesignal-plugin
claude plugin install valuesignal@valuesignal
```

When the plugin is enabled, Claude Code asks for your **ValueSignal API token**. Paste the `vs_pat_…` value; Claude Code keeps it in your operating system's credential store and passes it only to the ValueSignal MCP server. If you leave the prompt empty, the server falls back to a `VALUESIGNAL_JWT_TOKEN` exported in the environment Claude Code runs in.

Start a new Claude Code session and confirm that `/mcp` shows `valuesignal` connected.

## Install in Codex

Make the token available to Codex, add the public marketplace, and install the plugin:

```bash
export VALUESIGNAL_JWT_TOKEN='<your-vs_pat-token>'
codex plugin marketplace add ValueSignal/valuesignal-plugin
codex plugin add valuesignal@valuesignal
```

Start a new Codex task so the plugin and its MCP tools load from the installed package.

The portable Agent Plugins manifest does not embed credentials. Codex receives `VALUESIGNAL_JWT_TOKEN` from the environment used to launch it. A first-class install-time credential prompt is tracked separately from the 1.0.14 packaging release.

## MCP tools

| Tool | Purpose |
|---|---|
| `valuesignal_auth_status` | Verify the configured credential and API base |
| `valuesignal_capture_turn` | Send one user/assistant turn to ingress and bind it to the current Git remote when available |
| `valuesignal_dashboard_url` | Return the ValueSignal dashboard URL |
| `valuesignal_build_proof` | Mint a whole-profile or project-scoped Proof of Work certification |

## Local development

```bash
cd plugin/dev   # dev/ in the standalone repo
npm ci
npm run sync:codex-manifest
npm run build:mcp
npm run validate
npm run test:codex
```

To start the bundled server directly:

```bash
VALUESIGNAL_JWT_TOKEN='<your-vs_pat-token>' node mcp/server.mjs
```

## Security and data handling

- **Open source package:** The MCP server, skills, rules, commands, manifests, and tests are published. The ValueSignal scoring backend remains proprietary.
- **Credentials:** Claude Code prompts for the API token when the plugin is enabled and keeps it in the OS credential store. Cursor and Codex read `VALUESIGNAL_JWT_TOKEN` from the MCP environment. Tokens are never stored in the repository or manifests.
- **Capture control:** The plugin captures only when the user asks. Credential-like content is redacted on this machine before anything is sent.
- **Details:** See [SECURITY.md](./SECURITY.md).

### What the plugin runs, sends, and fetches

Nothing runs at startup beyond the MCP server itself, and the server makes no request until a tool is called. There is no telemetry.

| Tool | Runs locally | Network request (only to `VALUESIGNAL_API_BASE`, default `https://app.valuesignal.ai`) | Data sent |
|---|---|---|---|
| `valuesignal_auth_status` | none | `GET /api/ingress/whoami` when the token is a `vs_pat_` API token; none otherwise | the token, as the `Authorization` header |
| `valuesignal_capture_turn` | `git config --get remote.origin.url` in the workspace (3 s timeout; skipped silently outside a repo) | `POST /api/ingress/cursor` (plus `whoami` once per process for a `vs_pat_` token) | the user prompt and assistant response you asked to capture, after credential redaction; session id, message index, timestamp; the workspace's git remote normalized to `host/owner/repo` with credentials removed; host name (Cursor, Claude Code, or Codex) and plugin version; random event ids; the count of redactions (never the redacted values) |
| `valuesignal_build_proof` | the same `git` command, only for `scope: "project"` without a `projectRef` | `POST /api/proof/cert` | the scope and, for a project cert, the normalized repo identity. The response contains certificate files that the agent writes to your repository only if you ask it to |
| `valuesignal_dashboard_url` | none | none | none |

Not sent, ever: file contents, repository code, environment variables, other tools' output, or anything from other MCP servers. `VALUESIGNAL_API_BASE` must be HTTPS on `valuesignal.ai` or a host listed in `VALUESIGNAL_API_ALLOWED_HOSTS` (plain HTTP is accepted only for `localhost` development); any other value is rejected before a request is made.

## Privacy

Do not capture secrets, tokens, passwords, `.env` contents, or other credentials. Review each capture before submitting it.

## Validation

The package validators check the Cursor, Claude Code, Agent Plugins, and Codex manifests; version consistency; the generated MCP bundle; install-free startup; and tool contracts. The export script applies the same checks to the standalone public repository.

## License

MIT for the plugin package. ValueSignal scoring services and capture semantics are proprietary.
