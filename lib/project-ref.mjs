// Workspace project identity for project-scoped capture binding.
//
// The MCP server runs inside the host workspace (Cursor, Claude Code, or Codex), so `git remote` here is a
// machine-level assertion of which repo the captured work belongs to —
// binding method `declared_at_capture`, the strongest on the attribution
// axis. Normalization mirrors mcp-server/src/utils/projectRef.ts and
// scripts/verify-proof-cert.mjs; keep the three in sync.
import { execFile } from 'node:child_process';

/**
 * Normalize a git remote URL to canonical `host/owner/repo` form
 * (lowercase host, no protocol/credentials/port, no trailing .git).
 * Returns null when the value can't be read as a repo identity.
 */
export function normalizeProjectRef(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value || value.length > 2048) return null;

  const scpMatch = value.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (scpMatch) {
    value = `${scpMatch[1]}/${scpMatch[2]}`;
  } else {
    value = value.replace(/^[a-z+]+:\/\//i, '');
    value = value.replace(/^[^/@]+@/, '');
  }

  value = value.replace(/\.git$/i, '').replace(/\/+$/, '');

  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return null;

  const host = value.slice(0, slash).toLowerCase().replace(/:\d+$/, '');
  const path = value.slice(slash + 1);

  if (!/^[\w.-]+(\.[\w-]+)+$/.test(host)) return null;
  if (!/^[\w.~-]+(\/[\w.~-]+)+$/.test(path)) return null;

  // Whole ref lowercased: git hosts are case-insensitive for owner/repo.
  const normalized = `${host}/${path}`.toLowerCase();
  return normalized.length <= 191 ? normalized : null;
}

let cachedRef;

/**
 * Detect the current workspace's project ref from its git origin remote.
 * Cached per process (the MCP server lives inside one workspace). Returns
 * null outside a git repo or when no origin remote is configured — captures
 * then proceed unbound, never fail.
 */
export function detectWorkspaceProjectRef() {
  if (cachedRef !== undefined) return Promise.resolve(cachedRef);
  return new Promise((resolve) => {
    execFile(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { timeout: 3000, cwd: process.cwd() },
      (error, stdout) => {
        cachedRef = error ? null : normalizeProjectRef(String(stdout || ''));
        resolve(cachedRef);
      }
    );
  });
}
