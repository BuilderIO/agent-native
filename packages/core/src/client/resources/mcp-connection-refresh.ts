/**
 * Tracks the window between starting an MCP OAuth authorization and observing
 * its result, so the shared `["mcp-servers"]` list can be revalidated when the
 * user comes back.
 *
 * The OAuth callback redirects the *popup* to the app return URL and never
 * touches the opener, so without this marker the opener keeps rendering the
 * pre-authorization list forever: every consumer of `useMcpServers()` shows
 * "Connect" for an integration that is already connected. React Query's
 * `refetchOnWindowFocus` is deliberately off across this repo, so the refresh
 * has to be bounded and explicit rather than global.
 *
 * The in-memory marker is authoritative for this tab; sessionStorage only
 * extends it across a reload. A storage failure therefore degrades the window
 * to memory-only, which is never worse than not having the marker at all.
 */

import { MCP_OAUTH_FLOW_TTL_MS } from "../../shared/mcp-oauth-flow-ttl.js";

const PENDING_STORAGE_KEY = "agent-native:mcp-connection-pending";
const PENDING_TTL_MS = MCP_OAUTH_FLOW_TTL_MS;

let memoryPendingStartedAt: number | null = null;

function readStoredStartedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // coercion-ok: an unreadable store has no marker to report, and the caller reads the authoritative in-memory value first.
    return null;
  }
}

function writeStoredStartedAt(startedAt: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (startedAt === null) {
      window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(PENDING_STORAGE_KEY, String(startedAt));
    // coercion-ok: the in-memory marker set by the caller already satisfies
    // this function's contract; storage is only the cross-reload upgrade.
  } catch {
    return;
  }
}

export function markMcpConnectionPending(now = Date.now()): void {
  memoryPendingStartedAt = now;
  writeStoredStartedAt(now);
}

export function clearMcpConnectionPending(): void {
  memoryPendingStartedAt = null;
  writeStoredStartedAt(null);
}

export function hasPendingMcpConnection(now = Date.now()): boolean {
  const startedAt = memoryPendingStartedAt ?? readStoredStartedAt();
  if (startedAt === null) return false;
  if (now - startedAt > PENDING_TTL_MS) {
    clearMcpConnectionPending();
    return false;
  }
  return true;
}
