export const PROTECTED_PREVIEW_BYPASS_HEADER = "x-vercel-protection-bypass";
export const PROTECTED_PREVIEW_COOKIE_HEADER = "x-vercel-set-bypass-cookie";
export const PROTECTED_PREVIEW_ORIGIN_HEADER =
  "x-agent-native-protected-preview-origin";

type HeaderValue = string | string[];
export type RequestHeaders = Record<string, HeaderValue>;
type RequestHeadersInput = Record<string, HeaderValue | undefined>;

function copyHeaders(headers: RequestHeadersInput): RequestHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, HeaderValue] => entry[1] !== undefined,
    ),
  );
}

function deleteHeader(headers: RequestHeaders, name: string): void {
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) delete headers[key];
  }
}

function readHeader(headers: RequestHeadersInput, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  }
  return null;
}

function stripProtectedPreviewHeaders(headers: RequestHeaders): void {
  deleteHeader(headers, PROTECTED_PREVIEW_BYPASS_HEADER);
  deleteHeader(headers, PROTECTED_PREVIEW_COOKIE_HEADER);
  deleteHeader(headers, PROTECTED_PREVIEW_ORIGIN_HEADER);
}

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

function isFrameProxyRequest(requestUrl: URL): boolean {
  const isLoopback =
    requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";
  if (!isLoopback || requestUrl.port !== "3334") return false;
  return (
    requestUrl.pathname.startsWith("/_agent-native/") ||
    requestUrl.pathname.startsWith("/api/google/")
  );
}

/**
 * Build Electron request headers for one exact protected preview target.
 * Caller-supplied bypass headers are always removed before trusted values are
 * added, so renderer code cannot steer a stored credential to another origin.
 */
export function authorizeProtectedPreviewRequest(input: {
  requestUrl: string;
  requestHeaders: RequestHeadersInput;
  configuredOrigin: string;
  bypassSecret: string;
}): RequestHeaders {
  const headers = copyHeaders(input.requestHeaders);
  stripProtectedPreviewHeaders(headers);

  const configuredOrigin = normalizeProtectedPreviewOrigin(
    input.configuredOrigin,
  );
  const bypassSecret = input.bypassSecret.trim();
  if (!configuredOrigin || !bypassSecret) return headers;

  let requestUrl: URL;
  try {
    requestUrl = new URL(input.requestUrl);
  } catch {
    return headers;
  }

  if (requestUrl.origin === configuredOrigin) {
    headers[PROTECTED_PREVIEW_BYPASS_HEADER] = bypassSecret;
    headers[PROTECTED_PREVIEW_COOKIE_HEADER] = "samesitenone";
    return headers;
  }

  if (isFrameProxyRequest(requestUrl)) {
    headers[PROTECTED_PREVIEW_BYPASS_HEADER] = bypassSecret;
    headers[PROTECTED_PREVIEW_COOKIE_HEADER] = "samesitenone";
    headers[PROTECTED_PREVIEW_ORIGIN_HEADER] = configuredOrigin;
  }

  return headers;
}

/**
 * Keep protected-preview headers only when Desktop declared the exact HTTPS
 * origin the Frame proxy is about to contact. The internal binding header is
 * never forwarded to the candidate.
 */
export function authorizeProtectedPreviewProxy(input: {
  targetUrl: string;
  requestHeaders: RequestHeadersInput;
}): RequestHeaders {
  const headers = copyHeaders(input.requestHeaders);
  const declaredOrigin = readHeader(headers, PROTECTED_PREVIEW_ORIGIN_HEADER);
  const bypassSecret = readHeader(headers, PROTECTED_PREVIEW_BYPASS_HEADER);
  const cookieMode = readHeader(headers, PROTECTED_PREVIEW_COOKIE_HEADER);
  stripProtectedPreviewHeaders(headers);

  const targetOrigin = normalizeProtectedPreviewOrigin(input.targetUrl);
  if (
    !targetOrigin ||
    declaredOrigin !== targetOrigin ||
    !bypassSecret?.trim()
  ) {
    return headers;
  }

  headers[PROTECTED_PREVIEW_BYPASS_HEADER] = bypassSecret;
  if (cookieMode === "samesitenone") {
    headers[PROTECTED_PREVIEW_COOKIE_HEADER] = cookieMode;
  }
  return headers;
}
