import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_START_PATH,
  EMBED_TARGET_HEADER,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";

let installed = false;
let memoryToken: string | null = null;
let mcpChatBridgeActive = false;
let mcpChatBridgeScope: string | null = null;
const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";
const MCP_CHAT_BRIDGE_STORAGE_KEY = "agent-native:mcp-chat-bridge";

const AUTH_FAILURE_COOLDOWN_MS = 60_000;
const GUARDED_METHODS = new Set(["GET", "HEAD"]);
const AUTH_FAILURE_HEADER = "x-agent-native-auth-circuit-breaker";
const MCP_CHAT_BRIDGE_VIEWPORT_STYLE_ID =
  "agent-native-mcp-chat-bridge-viewport";
const MCP_CHAT_BRIDGE_VIEWPORT_HEIGHT = 560;

type AuthFailureRecord = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string | null;
  expiresAt: number;
};

const authFailureCache = new Map<string, AuthFailureRecord>();
let embedAuthFailure: AuthFailureRecord | null = null;

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function currentUrl(win: Window): URL | null {
  try {
    return new URL(win.location.href);
  } catch {
    try {
      return new URL(
        `${win.location.pathname || "/"}${win.location.search || ""}${win.location.hash || ""}`,
        win.location.origin || "http://agent-native.invalid",
      );
    } catch {
      return null;
    }
  }
}

function readTokenFromUrl(win: Window): string | null {
  return currentUrl(win)?.searchParams.get(EMBED_TOKEN_QUERY_PARAM) ?? null;
}

export function readEmbedMcpChatBridgeFlagFromUrl(): boolean {
  const win = browserWindow();
  if (!win) return false;
  const value = currentUrl(win)?.searchParams.get(
    MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
  );
  return value === "1" || value === "true";
}

function currentMcpChatBridgeScope(win: Window): string | null {
  return readTokenFromUrl(win) ?? memoryToken ?? storedToken(win);
}

function clearMcpChatBridge(win: Window): void {
  mcpChatBridgeActive = false;
  mcpChatBridgeScope = null;
  try {
    win.sessionStorage?.removeItem(MCP_CHAT_BRIDGE_STORAGE_KEY);
  } catch {
    // ignore unavailable session storage
  }
}

export function markEmbedMcpChatBridgeActive(): void {
  const win = browserWindow();
  const scope = win ? currentMcpChatBridgeScope(win) : null;
  mcpChatBridgeActive = true;
  mcpChatBridgeScope = scope;
  try {
    if (scope) {
      win?.sessionStorage?.setItem(MCP_CHAT_BRIDGE_STORAGE_KEY, scope);
    } else {
      win?.sessionStorage?.removeItem(MCP_CHAT_BRIDGE_STORAGE_KEY);
    }
  } catch {
    // Session storage may be unavailable in some sandboxed hosts. The
    // in-memory fallback still covers the normal single-page boot path.
  }
}

export function isEmbedMcpChatBridgeActive(): boolean {
  const win = browserWindow();
  if (!win) return false;
  if (!isEmbedAuthActive()) {
    clearMcpChatBridge(win);
    return false;
  }
  if (readEmbedMcpChatBridgeFlagFromUrl()) {
    markEmbedMcpChatBridgeActive();
    return true;
  }
  const scope = currentMcpChatBridgeScope(win);
  // Once we've enrolled in MCP bridge mode in this page, trust the in-memory
  // flag. A null scope (because the URL token was stripped after enroll AND
  // sessionStorage is denied — Safari private mode, third-party-cookie-blocked
  // iframes, strict ChatGPT/Claude sandboxes) is NOT evidence of de-enrollment.
  // Only an actual auth-scope CHANGE (a different non-null embed token) means
  // we should clear the bridge.
  if (mcpChatBridgeActive) {
    if (scope == null) return true;
    if (mcpChatBridgeScope == null || mcpChatBridgeScope === scope) {
      // Capture the scope now that we have one; future calls can compare.
      mcpChatBridgeScope = scope;
      return true;
    }
    clearMcpChatBridge(win);
    return false;
  }
  try {
    const storedScope = win.sessionStorage?.getItem(
      MCP_CHAT_BRIDGE_STORAGE_KEY,
    );
    if (storedScope && (scope == null || storedScope === scope)) {
      // Promote the persisted enrollment into in-memory state so subsequent
      // reads survive sessionStorage becoming unavailable later in the session.
      mcpChatBridgeActive = true;
      mcpChatBridgeScope = storedScope;
      return true;
    }
    if (storedScope && scope != null && storedScope !== scope) {
      win.sessionStorage?.removeItem(MCP_CHAT_BRIDGE_STORAGE_KEY);
    }
    return false;
  } catch {
    return false;
  }
}

function storedToken(win: Window): string | null {
  try {
    return win.sessionStorage?.getItem(EMBED_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeToken(token: string, win: Window): void {
  memoryToken = token;
  try {
    win.sessionStorage?.setItem(EMBED_TOKEN_STORAGE_KEY, token);
  } catch {
    // Session storage may be unavailable in some sandboxed hosts. The
    // in-memory fallback still covers the normal single-page boot path.
  }
}

export function getEmbedAuthToken(): string | null {
  const win = browserWindow();
  if (!win) return null;
  const fromUrl = readTokenFromUrl(win);
  if (fromUrl) {
    storeToken(fromUrl, win);
    return fromUrl;
  }
  return memoryToken ?? storedToken(win);
}

export function isEmbedAuthActive(): boolean {
  const win = browserWindow();
  if (!win) return false;
  if (getEmbedAuthToken()) return true;
  const mode = currentUrl(win)?.searchParams.get(EMBED_MODE_QUERY_PARAM);
  return mode === "1" || mode === "true";
}

function ensureMcpChatBridgeViewportClamp(win: Window): void {
  if (!isEmbedMcpChatBridgeActive()) return;
  const doc = win.document;
  if (!doc?.head) return;
  if (!doc.getElementById(MCP_CHAT_BRIDGE_VIEWPORT_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = MCP_CHAT_BRIDGE_VIEWPORT_STYLE_ID;
    const height = `${MCP_CHAT_BRIDGE_VIEWPORT_HEIGHT}px`;
    style.textContent = `
html,
body {
  min-height: 0 !important;
  height: ${height} !important;
  max-height: ${height} !important;
  overflow: hidden !important;
}

#root,
#__next,
[data-agent-native-app-root] {
  min-height: 0 !important;
  height: ${height} !important;
  max-height: ${height} !important;
  overflow: hidden !important;
}
`;
    doc.head.appendChild(style);
  }
  notifyMcpChatBridgeViewportHeight(win);
}

function notifyMcpChatBridgeViewportHeight(win: Window): void {
  const height = MCP_CHAT_BRIDGE_VIEWPORT_HEIGHT;
  const notify = () => {
    try {
      const openai = (
        win as Window & {
          openai?: {
            notifyIntrinsicHeight?: (payload: { height: number }) => void;
          };
        }
      ).openai;
      openai?.notifyIntrinsicHeight?.({ height });
    } catch {
      // Host bridge availability varies by client; sizing is best-effort.
    }

    try {
      if (win.parent && win.parent !== win) {
        win.parent.postMessage(
          {
            jsonrpc: "2.0",
            method: "ui/notifications/size-changed",
            params: { height },
          },
          "*",
        );
      }
    } catch {
      // Cross-host embeds can deny parent messaging in tests or strict sandboxes.
    }
  };

  notify();
  try {
    win.requestAnimationFrame?.(() => notify());
    win.setTimeout?.(notify, 250);
    win.setTimeout?.(notify, 1000);
  } catch {
    // Timers are a progressive enhancement for late host bridge initialization.
  }
}

/** Internal test helper. Do not use in app code. */
export function _resetEmbedAuthForTests(): void {
  installed = false;
  memoryToken = null;
  mcpChatBridgeActive = false;
  mcpChatBridgeScope = null;
  authFailureCache.clear();
  embedAuthFailure = null;
}

/**
 * True when this document runs in an opaque-origin (`origin === "null"`)
 * browsing context — e.g. a `sandbox="allow-scripts"` iframe without
 * `allow-same-origin`, which is how MCP App embeds always load (the outer host
 * iframe's sandbox propagates to nested frames).
 *
 * It matters for auth: the embed session cookie is keyed to the real app origin
 * and is NOT delivered to an opaque context, so a full document reload here
 * arrives with neither cookie nor — once stripped — URL token, and the server
 * auth guard serves the sign-in page. In that case the URL token is the only
 * credential that survives a reload, so it must stay in the URL.
 */
function isOpaqueOriginFrame(win: Window): boolean {
  try {
    return win.location.origin === "null";
  } catch {
    // A thrown access is itself a signal of an opaque/cross-origin context.
    return true;
  }
}

function stripTokenFromUrl(win: Window): void {
  // Keep the token in the URL for opaque-origin frames — see
  // isOpaqueOriginFrame. Stripping it there breaks re-auth on any document
  // reload. Referrer-Policy is set to no-referrer on embed responses, so the
  // retained token does not leak via the Referer header.
  if (isOpaqueOriginFrame(win)) return;
  try {
    const url = currentUrl(win);
    if (!url) return;
    if (!url.searchParams.has(EMBED_TOKEN_QUERY_PARAM)) return;
    url.searchParams.delete(EMBED_TOKEN_QUERY_PARAM);
    win.history.replaceState(
      win.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // best effort only
  }
}

function currentEmbedTarget(win: Window): string {
  return `${win.location.pathname}${win.location.search}`;
}

function currentAppOrigin(win: Window): string | null {
  const url = currentUrl(win);
  if (url?.origin && url.origin !== "null") return url.origin;
  try {
    const origin = win.location.origin;
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

function inputUrl(input: RequestInfo | URL, win: Window): URL | null {
  try {
    return input instanceof Request
      ? new URL(input.url)
      : new URL(String(input), currentUrl(win)?.href ?? win.location.href);
  } catch {
    return null;
  }
}

function sameOrigin(input: RequestInfo | URL, win: Window): boolean {
  const url = inputUrl(input, win);
  const origin = currentAppOrigin(win);
  return !!url && !!origin && url.origin === origin;
}

function isAgentNativeRuntimePath(pathname: string): boolean {
  return (
    pathname === "/_agent-native" ||
    pathname.endsWith("/_agent-native") ||
    pathname.includes("/_agent-native/")
  );
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ??
    (input instanceof Request ? input.method : undefined) ??
    "GET"
  ).toUpperCase();
}

function authFailureKey(method: string, url: URL): string {
  return `${method} ${url.href}`;
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function shouldGuardAuthFailure(method: string, url: URL): boolean {
  if (!GUARDED_METHODS.has(method)) return false;
  if (url.pathname === EMBED_START_PATH) return false;
  if (url.pathname === "/_agent-native/sign-in") return false;
  return true;
}

function activeAuthFailure(
  record: AuthFailureRecord | null | undefined,
): AuthFailureRecord | null {
  if (!record) return null;
  if (record.expiresAt > Date.now()) return record;
  return null;
}

function getCachedAuthFailure(
  key: string,
  useEmbedWideFailure: boolean,
): AuthFailureRecord | null {
  const cached = activeAuthFailure(authFailureCache.get(key));
  if (cached) return cached;
  authFailureCache.delete(key);

  if (!useEmbedWideFailure) return null;
  const embedCached = activeAuthFailure(embedAuthFailure);
  if (embedCached) return embedCached;
  embedAuthFailure = null;
  return null;
}

function authFailureResponse(record: AuthFailureRecord): Response {
  const headers = new Headers(record.headers);
  headers.set(AUTH_FAILURE_HEADER, "1");
  if (!headers.has("retry-after")) {
    headers.set(
      "retry-after",
      String(Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000))),
    );
  }
  return new Response(record.body, {
    status: record.status,
    statusText: record.statusText,
    headers,
  });
}

async function recordAuthFailure(
  key: string,
  response: Response,
  useEmbedWideFailure: boolean,
): Promise<void> {
  let body: string | null = null;
  try {
    body = await response.clone().text();
  } catch {
    body = null;
  }

  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      lower === "content-encoding" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      return;
    }
    headers.push([name, value]);
  });

  const record: AuthFailureRecord = {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    expiresAt: Date.now() + AUTH_FAILURE_COOLDOWN_MS,
  };
  authFailureCache.set(key, record);
  if (useEmbedWideFailure) embedAuthFailure = record;
}

function clearAuthFailure(key: string, useEmbedWideFailure: boolean): void {
  authFailureCache.delete(key);
  if (useEmbedWideFailure) embedAuthFailure = null;
}

function withEmbedAuthHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
  win: Window,
): [RequestInfo | URL, RequestInit | undefined] {
  const method = requestMethod(input, init);
  const url = inputUrl(input, win);
  if (
    url &&
    sameOrigin(input, win) &&
    GUARDED_METHODS.has(method) &&
    isAgentNativeRuntimePath(url.pathname)
  ) {
    url.searchParams.set(EMBED_TOKEN_QUERY_PARAM, token);
    return [url.toString(), init];
  }

  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has(EMBED_TARGET_HEADER)) {
    headers.set(EMBED_TARGET_HEADER, currentEmbedTarget(win));
  }

  if (input instanceof Request) {
    return [new Request(input, { ...init, headers }), undefined];
  }
  return [input, { ...init, headers }];
}

function requestUrlAndKey(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  win: Window,
):
  | {
      key: string;
      shouldGuard: boolean;
    }
  | undefined {
  const url = inputUrl(input, win);
  const origin = currentAppOrigin(win);
  if (!url || !origin || url.origin !== origin) return undefined;
  const method = requestMethod(input, init);
  return {
    key: authFailureKey(method, url),
    shouldGuard: shouldGuardAuthFailure(method, url),
  };
}

export function ensureEmbedAuthFetchInterceptor(): void {
  const win = browserWindow();
  if (!win) return;

  if (readEmbedMcpChatBridgeFlagFromUrl()) markEmbedMcpChatBridgeActive();

  const urlToken = readTokenFromUrl(win);
  if (urlToken) {
    storeToken(urlToken, win);
    stripTokenFromUrl(win);
  }
  ensureMcpChatBridgeViewportClamp(win);

  if (installed) return;
  if (typeof win.fetch !== "function") return;
  installed = true;

  const originalFetch = win.fetch.bind(win);
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = requestUrlAndKey(input, init, win);
    const embedMode = isEmbedAuthActive();
    if (request?.shouldGuard) {
      const cached = getCachedAuthFailure(request.key, embedMode);
      if (cached) return authFailureResponse(cached);
    }

    const token = getEmbedAuthToken();
    let fetchInput = input;
    let fetchInit = init;
    if (token && sameOrigin(input, win)) {
      [fetchInput, fetchInit] = withEmbedAuthHeaders(input, init, token, win);
    }

    const response = await originalFetch(fetchInput as any, fetchInit as any);
    if (request?.shouldGuard && isAuthFailureStatus(response.status)) {
      await recordAuthFailure(request.key, response, embedMode || !!token);
    } else if (request?.shouldGuard && response.ok) {
      clearAuthFailure(request.key, embedMode || !!token);
    }
    return response;
  }) as typeof fetch;
}
