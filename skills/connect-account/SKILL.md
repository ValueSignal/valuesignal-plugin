---
name: connect-account
description: Help the user connect ValueSignal to Cursor, Claude Code, or Codex by giving the valuesignal MCP server an API token. Use when the user asks to link ValueSignal, set up the plugin, or fix auth errors.
---

# Connect ValueSignal

Use a scoped API token (recommended) so you don't have to re-paste a browser
session token every few days. The token only allows capturing AI activity and
minting your own Proof of Work certification — it can't access the account,
billing, or data — and can be revoked anytime.

1. Log in at https://app.valuesignal.ai
2. Go to **Account Settings → Integrations & API tokens**
3. Name the token (e.g. "ValueSignal plugin") and click **Generate token**, then copy
   the `vs_pat_…` value (it's shown only once)
4. Give the token to the plugin:
   - **Claude Code:** paste it into the prompt Claude Code shows when the plugin
     is enabled. It is stored in the OS credential store.
   - **Cursor:** **Settings → Features → MCP → valuesignal → Edit**, add the
     environment variable `VALUESIGNAL_JWT_TOKEN` = the token, then restart MCP
     or run **Developer: Reload Window**
   - **Codex:** make `VALUESIGNAL_JWT_TOKEN` available in the environment Codex
     is launched from (see the plugin README)
5. Run the MCP tool `valuesignal_auth_status` to confirm

A short-lived session token (`sessionStorage.getItem('valueSignalToken')` from
the browser console) still works as a fallback, but it expires and must be
re-pasted — prefer the API token above.

Never paste tokens into chat logs or commit them to git.

## Once connected

Connecting is step one. Tell the user they can now ask you to capture an
exchange to their logbook (see the `capture-ai-work` skill) — capture happens
only when they ask. If they want to know how to build a meaningful profile,
explain that each captured turn becomes scored evidence and that several real
sessions produce a far better picture than one. It stays private by
default. When the user needs to prove their work to a screening partner, the
`certify-work` skill turns that evidence into a committable certification.
