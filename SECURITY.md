# Security — ValueSignal plugin

## Scope

This repository contains the **open-source ValueSignal plugin for Cursor, Claude Code, and Codex** only (MCP client, skills, rules, commands). The ValueSignal scoring backend, web application, and capture pipeline are **not** included here.

## Network behavior

| Direction | Endpoint | When |
|-----------|----------|------|
| Outbound HTTPS | `VALUESIGNAL_API_BASE` (default `https://app.valuesignal.ai`) | Only when the user invokes MCP tools that post capture events or when checking auth |

No other hosts are contacted by this package. There is no telemetry SDK in the plugin repo.

## Secrets

- **API token**: in Claude Code, a prompted `userConfig` value marked `sensitive` (stored in the OS credential store, passed to the server as `VALUESIGNAL_PLUGIN_TOKEN`). In Cursor and Codex, the MCP environment variable `VALUESIGNAL_JWT_TOKEN`, configured by the user. The Claude manifest does not read credentials from the user's environment; the server itself falls back to `VALUESIGNAL_JWT_TOKEN` when no prompted token is set.
- Secrets are **never** committed to this repository.
- The privacy rule (`rules/valuesignal-privacy.mdc`) instructs the agent not to send API keys, passwords, or `.env` contents via capture tools.

## Dependencies

- Runtime dependencies: none. `mcp/server.mjs` is a single readable file built from `mcp/server.source.mjs` and `lib/`, including a minimal MCP stdio layer (`lib/mcp-stdio.mjs`).
- Development dependencies (`@modelcontextprotocol/sdk` for the contract tests, `esbuild` for the build) install via `npm ci` from the committed `package-lock.json` and are not part of the running server.

## Reporting

Report security issues to **security@valuesignal.ai** or **support@valuesignal.ai**.
