export function normalizeProtectedPreviewOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function authorizeProtectedPreviewLaunch(
  requestedUrl: unknown,
  configuredOrigin: unknown,
): string | null {
  const requestedOrigin = normalizeProtectedPreviewOrigin(requestedUrl);
  const trustedOrigin = normalizeProtectedPreviewOrigin(configuredOrigin);
  return requestedOrigin && requestedOrigin === trustedOrigin
    ? requestedOrigin
    : null;
}

function normalizeLoopbackBrokerUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const isLoopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      url.protocol !== "http:" ||
      !isLoopback ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizeLoopbackAppOrigin(value: unknown): URL | null {
  const url = normalizeLoopbackBrokerUrl(value);
  if (!url || (url.pathname !== "/" && url.pathname !== "")) return null;
  return url;
}

function isSafeOAuthFlowId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{8,128}$/.test(value));
}

export interface ProtectedPreviewOAuthRelay {
  starterUrl: string;
  exchangeUrl: string;
  flowId: string;
}

/**
 * Bind one protected preview's native Google sign-in flow to a trusted local
 * app gateway. Only the exact starter route is relayed, and the flow result is
 * redeemed from that same loopback app base before Desktop installs it on the
 * exact preview origin.
 */
export function resolveProtectedPreviewOAuthRelay(input: {
  requestUrl: string;
  configuredOrigin: string;
  doorwayOrigin: string;
  exchangeOrigin: string;
}): ProtectedPreviewOAuthRelay | null {
  const configuredOrigin = normalizeProtectedPreviewOrigin(
    input.configuredOrigin,
  );
  const doorwayOrigin = normalizeLoopbackAppOrigin(input.doorwayOrigin);
  const exchangeOrigin = normalizeLoopbackAppOrigin(input.exchangeOrigin);
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.requestUrl);
  } catch {
    return null;
  }

  if (
    !configuredOrigin ||
    !doorwayOrigin ||
    !exchangeOrigin ||
    requestUrl.origin !== configuredOrigin ||
    requestUrl.pathname !== "/_agent-native/google/auth-url" ||
    requestUrl.searchParams.get("desktop") !== "1" ||
    requestUrl.searchParams.get("redirect") !== "1"
  ) {
    return null;
  }

  const flowId = requestUrl.searchParams.get("flow_id")?.trim() ?? null;
  if (!isSafeOAuthFlowId(flowId)) return null;

  const starterUrl = new URL(
    "/_agent-native/google/auth-url",
    doorwayOrigin.origin,
  );
  starterUrl.search = requestUrl.search;
  const exchangeUrl = new URL(
    "/_agent-native/auth/desktop-exchange",
    exchangeOrigin.origin,
  );
  exchangeUrl.searchParams.set("flow_id", flowId);

  return {
    starterUrl: starterUrl.toString(),
    exchangeUrl: exchangeUrl.toString(),
    flowId,
  };
}

export function resolveFrameOAuthCallbackTarget(input: {
  appBaseUrl: string;
  callbackUrl: string;
  framePort?: number;
}): string | null {
  let appBaseUrl: URL;
  let callbackUrl: URL;
  try {
    appBaseUrl = new URL(input.appBaseUrl);
    callbackUrl = new URL(input.callbackUrl);
  } catch {
    return null;
  }

  if (
    (appBaseUrl.protocol !== "http:" && appBaseUrl.protocol !== "https:") ||
    appBaseUrl.username ||
    appBaseUrl.password
  ) {
    return null;
  }
  const framePort = String(input.framePort ?? 3334);
  const isFrameOrigin =
    (callbackUrl.hostname === "localhost" ||
      callbackUrl.hostname === "127.0.0.1") &&
    callbackUrl.protocol === "http:" &&
    callbackUrl.port === framePort;
  const isGoogleCallback =
    callbackUrl.pathname.startsWith("/api/google/") ||
    callbackUrl.pathname.startsWith("/_agent-native/google/");
  if (!isFrameOrigin || !isGoogleCallback) return null;

  return new URL(
    `${callbackUrl.pathname.replace(/^\/+/, "")}${callbackUrl.search}`,
    `${appBaseUrl.toString().replace(/\/+$/, "")}/`,
  ).toString();
}
