const AGENT_CHAT_PATH = "/_agent-native/agent-chat";

let activeRelayBase: string | null = null;
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
  apiUrl: string | null | undefined,
): void {
  activeRelayBase = resolveDesktopChatRelayBase(apiUrl);
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

export function installDesktopChatFetchRelay(): void {
  if (typeof window === "undefined" || originalFetch) return;

  originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const relayBase = activeRelayBase;
    const requestUrl = resolveRequestUrl(input);
    if (
      !relayBase ||
      !requestUrl ||
      !requestUrl.pathname.startsWith("/_agent-native/")
    ) {
      return originalFetch!(input, init);
    }

    const relayUrl = `${relayBase}${requestUrl.pathname}${requestUrl.search}`;
    const relayInput =
      typeof Request !== "undefined" && input instanceof Request
        ? new Request(relayUrl, input)
        : relayUrl;
    return originalFetch!(relayInput, init);
  };
}
