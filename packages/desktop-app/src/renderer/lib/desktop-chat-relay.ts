import { createContext, useContext } from "react";

const AGENT_CHAT_PATH = "/_agent-native/agent-chat";
const FRAMEWORK_PREFIX = "/_agent-native/";

// Surface tabs keep every opened app mounted and merely hide the inactive ones,
// so several chat shells run at once. A single process-wide base would let the
// last shell to mount steer another shell's agent turns and action calls into
// its own app server, under that app's session.
const relayBaseByAppId = new Map<string, string>();

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
  if (base) relayBaseByAppId.set(appId, base);
  else relayBaseByAppId.delete(appId);
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
    if (
      !requestUrl ||
      !requestUrl.pathname.startsWith(FRAMEWORK_PREFIX) ||
      relayBaseByAppId.size === 0
    ) {
      return originalFetch!(input, init);
    }

    const bases = [...relayBaseByAppId.entries()];
    if (bases.length > 1) {
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
