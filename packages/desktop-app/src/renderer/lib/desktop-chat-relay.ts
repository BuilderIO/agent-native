import { createContext, useContext } from "react";

const AGENT_CHAT_PATH = "/_agent-native/agent-chat";
const FRAMEWORK_PREFIX = "/_agent-native/";

// Surface tabs keep every opened app mounted and merely hide the inactive ones,
// so several chat shells run at once. A single process-wide base would let the
// last shell to mount steer another shell's agent turns and action calls into
// its own app server, under that app's session.
const relayBaseByAppId = new Map<string, string>();
const activeRelayAppIds = new Set<string>();

let originalFetch: typeof window.fetch | null = null;

export function resolveDesktopChatRelayBase(
  apiUrl: string | null | undefined,
): string | null {
  if (!apiUrl) return null;
  const markerIndex = apiUrl.indexOf(AGENT_CHAT_PATH);
  if (markerIndex < 0) return null;
  return apiUrl.slice(0, markerIndex).replace(/\/$/, "") || null;
}

export function setDesktopChatRelayBase(
  appId: string,
  apiUrl: string | null | undefined,
): void {
  const base = resolveDesktopChatRelayBase(apiUrl);
  if (base) {
    relayBaseByAppId.set(appId, base);
    noBaseBackoffAttempts.clear();
  } else {
    relayBaseByAppId.delete(appId);
    activeRelayAppIds.delete(appId);
  }
}

export function setDesktopChatRelayActive(
  appId: string,
  active: boolean,
): void {
  if (!relayBaseByAppId.has(appId)) {
    activeRelayAppIds.delete(appId);
    return;
  }
  if (active) activeRelayAppIds.add(appId);
  else activeRelayAppIds.delete(appId);
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  try {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
    return new URL(rawUrl, window.location.href);
  } catch {
    // coercion-ok: malformed fetch input cannot produce a relay request.
    return null;
  }
}

function relayRequest(
  base: string,
  requestUrl: URL,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const relayUrl = `${base}${requestUrl.pathname}${requestUrl.search}`;
  const relayInput =
    typeof Request !== "undefined" && input instanceof Request
      ? new Request(relayUrl, input)
      : relayUrl;
  // The relayed URL still starts with /_agent-native/, so the patched global
  // fetch would prefix it a second time.
  return (originalFetch ?? window.fetch)(relayInput, init);
}

/**
 * Fetch bound to one app's relay base. Requests already carry their app, so
 * they stay correct no matter how many shells are mounted.
 */
export function createDesktopChatRelayFetch(appId: string): typeof fetch {
  return (input, init) => {
    const requestUrl = resolveRequestUrl(input);
    if (!requestUrl?.pathname.startsWith(FRAMEWORK_PREFIX)) {
      return (originalFetch ?? window.fetch)(input, init);
    }
    const base = relayBaseByAppId.get(appId);
    if (!base) {
      throw new Error(
        `Desktop chat relay has no base for app "${appId}"; refusing to send ${requestUrl.pathname} to another app.`,
      );
    }
    return relayRequest(base, requestUrl, input, init);
  };
}

/**
 * Thrown when a framework-prefixed request has no relay base to reach —
 * no desktop app chat shell has resolved its `apiUrl` yet. Distinct from a
 * network failure so callers (and tests) can tell "nothing to talk to" apart
 * from "the request failed", instead of the renderer's file:// origin
 * silently eating the request as an indistinguishable ERR_FILE_NOT_FOUND.
 */
export class DesktopChatRelayUnavailableError extends Error {
  constructor(pathname: string) {
    super(
      `Desktop chat relay has no app mounted; refusing to route ${pathname} to file://.`,
    );
    this.name = "DesktopChatRelayUnavailableError";
  }
}

// Growing delay before rejecting a request with no relay base, so any caller
// that retries immediately on rejection is throttled by the wait instead of
// free-running — this is what used to fire ~350 req/s against file:// with
// no backoff. Resets once a base resolves (setDesktopChatRelayBase above).
const NO_BASE_BACKOFF_BASE_MS = 250;
const NO_BASE_BACKOFF_MAX_MS = 10_000;
// Per pathname, so one endpoint that retries in a tight loop cannot push a
// different endpoint's first attempt out to the 10s ceiling.
const noBaseBackoffAttempts = new Map<string, number>();

function rejectUnavailable(
  pathname: string,
  signal?: AbortSignal | null,
): Promise<Response> {
  const attempts = noBaseBackoffAttempts.get(pathname) ?? 0;
  noBaseBackoffAttempts.set(pathname, attempts + 1);
  const delay = Math.min(
    NO_BASE_BACKOFF_BASE_MS * 2 ** attempts,
    NO_BASE_BACKOFF_MAX_MS,
  );
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DesktopChatRelayUnavailableError(pathname));
    }, delay);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const DesktopChatRelayAppContext = createContext<string | null>(null);

export function useDesktopChatRelayFetch(): typeof fetch {
  const appId = useContext(DesktopChatRelayAppContext);
  if (!appId) {
    throw new Error(
      "useDesktopChatRelayFetch must be used inside a DesktopAppChatShell.",
    );
  }
  return createDesktopChatRelayFetch(appId);
}

export function installDesktopChatFetchRelay(): void {
  if (typeof window === "undefined" || originalFetch) return;

  originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const requestUrl = resolveRequestUrl(input);
    if (!requestUrl || !requestUrl.pathname.startsWith(FRAMEWORK_PREFIX)) {
      return originalFetch!(input, init);
    }
    if (relayBaseByAppId.size === 0) {
      // No app has resolved a relay base yet. The renderer itself is served
      // from file://, so handing this to the real fetch can never succeed —
      // it would just resolve the relative path against file:// and reject
      // with an opaque ERR_FILE_NOT_FOUND indistinguishable from any other
      // failure. Fail closed with a typed, backed-off rejection instead.
      return rejectUnavailable(requestUrl.pathname, init?.signal);
    }

    const bases = [...relayBaseByAppId.entries()];
    if (bases.length > 1) {
      const activeBases = bases.filter(([appId]) =>
        activeRelayAppIds.has(appId),
      );
      if (activeBases.length === 1) {
        return relayRequest(activeBases[0]![1], requestUrl, input, init);
      }
      throw new Error(
        `Unattributed ${requestUrl.pathname} request with ${bases.length} desktop app chat shells mounted (${bases
          .map(([appId]) => appId)
          .join(
            ", ",
          )}); use useDesktopChatRelayFetch() so the request names its app.`,
      );
    }
    return relayRequest(bases[0]![1], requestUrl, input, init);
  };
}
