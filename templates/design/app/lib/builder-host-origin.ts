import { getEmbedAuthToken } from "@agent-native/core/client/host";

/**
 * The parent origin the Builder handshake arrived from, recorded once a
 * `design:init` message passes the host check.
 *
 * Origin sniffing cannot confirm a Builder running on localhost — every local
 * dev session — so the handshake is the only signal that works in both.
 */
let verifiedBuilderHostOrigin: string | null = null;

export function rememberBuilderHostOrigin(origin: string): void {
  if (origin) verifiedBuilderHostOrigin = origin;
}

export function getVerifiedBuilderHostOrigin(): string | null {
  return verifiedBuilderHostOrigin;
}

const BUILDER_HOST_SCOPE_PREFIX = "builder-host:design:";
const STORAGE_KEY_PREFIX = "agent-native:builder-host-embed:";

/** Scoped to the framed design, so one embed cannot set it for the next. */
function storageKey(win: Window): string {
  const match = /\/(?:visual-edit|design)\/([^/?#]+)/.exec(
    win.location.pathname,
  );
  return `${STORAGE_KEY_PREFIX}${match?.[1] ?? "unscoped"}`;
}

function scopeFromToken(): string | null {
  const payload = getEmbedAuthToken()?.split(".")[0];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const scope = (JSON.parse(json) as { scope?: unknown }).scope;
    return typeof scope === "string" ? scope : null;
    // coercion-ok: an undecodable token names no scope, which is not a match.
  } catch {
    return null;
  }
}

let cachedKey: string | null = null;
let isHost = false;
let serverConfirmedKey: string | null = null;

/**
 * Set from the loaded design's own linkage, which is server data and does not
 * depend on the token still being in the URL. Recorded against the design it
 * confirmed: an SPA navigation to another design must not inherit it.
 */
export function markBuilderHostEmbed(value: boolean): void {
  if (!value || typeof window === "undefined") return;
  serverConfirmedKey = storageKey(window);
}

/**
 * True when this embed session was minted by the Builder partner handshake.
 *
 * Sticky: the token is readable only on first load, after which the server has
 * swapped it for a cookie and cleaned the URL. Signature unchecked — the server
 * re-verifies every request, so this picks chrome, never access.
 */
export function isBuilderHostEmbed(): boolean {
  if (typeof window === "undefined") return false;
  const key = storageKey(window);
  if (serverConfirmedKey === key) return true;
  if (cachedKey === key) return isHost;
  cachedKey = key;

  if (scopeFromToken()?.startsWith(BUILDER_HOST_SCOPE_PREFIX)) {
    isHost = true;
    try {
      window.sessionStorage?.setItem(key, "1");
      // coercion-ok: sandboxed hosts refuse session storage.
    } catch {}
    return true;
  }

  try {
    isHost = window.sessionStorage?.getItem(key) === "1";
  } catch {
    isHost = false;
  }
  return isHost;
}

export function _resetBuilderHostEmbedForTests(): void {
  cachedKey = null;
  isHost = false;
  serverConfirmedKey = null;
  verifiedBuilderHostOrigin = null;
}
