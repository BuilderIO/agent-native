import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_START_PATH,
  EMBED_TARGET_HEADER,
  EMBED_TARGET_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
  MCP_DIRECTORY_WIDGET_SESSION_EXPIRED_HEADER,
} from "../shared/embed-auth.js";
import {
  isMcpDirectoryWidgetReadCapabilityScope,
  isMcpDirectoryWidgetWriteCapabilityScope,
} from "../shared/embed-auth.js";
import { FRAMEWORK_INTERNAL_ROUTE_PREFIX } from "../shared/framework-route-prefix.js";
import { MCP_APP_HOST_FILL_ATTRIBUTE } from "../shared/mcp-app-display.js";
import {
  EMBED_TOKEN_STORAGE_KEY,
  MCP_CHAT_BRIDGE_STORAGE_KEY,
} from "../shared/mcp-app-widget-embed.js";
import {
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
} from "../shared/sign-in-journey.js";
import { frameworkRoutePrefix } from "./api-path.js";

let installed = false;
let memoryToken: string | null = null;
let renewedFromUrlToken: string | null = null;
let pendingWidgetSessionRenewal: Promise<boolean> | null = null;
let widgetSessionRenewalRequestId = 0;
let mcpChatBridgeActive = false;
let mcpChatBridgeScope: string | null = null;

const AUTH_FAILURE_COOLDOWN_MS = 60_000;
const GUARDED_METHODS = new Set(["GET", "HEAD"]);
const AUTH_FAILURE_HEADER = "x-agent-native-auth-circuit-breaker";
const EMBED_TOKEN_RENEWED_FROM_STORAGE_KEY = `${EMBED_TOKEN_STORAGE_KEY}:renewed-from`;
const EMBED_SESSION_RENEWAL_TIMEOUT_MS = 15_000;
const MCP_CHAT_BRIDGE_VIEWPORT_STYLE_ID =
  "agent-native-mcp-chat-bridge-viewport";
const MCP_CHAT_BRIDGE_VIEWPORT_HEIGHT = 560;
let pendingMcpChatBridgeViewportNotification: {
  win: Window;
  animationFrameId: number | null;
  timeoutIds: number[];
} | null = null;

type AuthFailureRecord = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string | null;
  expiresAt: number;
};

const authFailureCache = new Map<string, AuthFailureRecord>();

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
  return getEmbedAuthToken() ?? memoryToken ?? storedToken(win);
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
    let renewedFrom = renewedFromUrlToken;
    if (!renewedFrom) {
      try {
        renewedFrom =
          win.sessionStorage?.getItem(EMBED_TOKEN_RENEWED_FROM_STORAGE_KEY) ??
          null;
      } catch {
        renewedFrom = null;
      }
    }
    if (renewedFrom === fromUrl) {
      const refreshed = memoryToken ?? storedToken(win);
      if (refreshed && refreshed !== fromUrl) return refreshed;
    }
    if (renewedFrom && renewedFrom !== fromUrl) {
      renewedFromUrlToken = null;
      try {
        win.sessionStorage?.removeItem(EMBED_TOKEN_RENEWED_FROM_STORAGE_KEY);
      } catch {
        // coercion-ok: cleanup is best-effort; the refreshed URL token still supersedes this marker.
      }
    }
    storeToken(fromUrl, win);
    return fromUrl;
  }
  return memoryToken ?? storedToken(win);
}

function readEmbedTokenScope(token: string): string | undefined {
  const payload = token.split(".")[0] ?? "";
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(
      atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
      (char) => char.charCodeAt(0),
    );
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      scope?: unknown;
    };
    return typeof claims.scope === "string" ? claims.scope : undefined;
    // coercion-ok: an unreadable token reads as a normal session; the server still enforces the real scope on every request.
  } catch {
    return undefined;
  }
}

let widgetScopeCache: {
  token: string;
  readOnly: boolean;
  writable: boolean;
} | null = null;

/**
 * True when the embed credential is a directory-widget read capability, which
 * only the MCP App widget flows mint. It stays readable after a client
 * navigation drops the URL params, so it identifies a widget document without
 * the chat-bridge flag. The token's claims are only a UI hint (the signature
 * is checked server-side), so this decides what not to attempt, never what is
 * allowed.
 */
export function hasMcpDirectoryWidgetCapabilityToken(): boolean {
  const token = getEmbedAuthToken();
  if (!token) return false;
  if (widgetScopeCache?.token !== token) {
    const scope = readEmbedTokenScope(token);
    widgetScopeCache = {
      token,
      readOnly: isMcpDirectoryWidgetReadCapabilityScope(scope),
      writable: isMcpDirectoryWidgetWriteCapabilityScope(scope),
    };
  }
  return widgetScopeCache.readOnly || widgetScopeCache.writable;
}

export function hasMcpDirectoryWidgetWriteCapabilityToken(): boolean {
  const token = getEmbedAuthToken();
  if (!token) return false;
  if (widgetScopeCache?.token !== token) {
    const scope = readEmbedTokenScope(token);
    widgetScopeCache = {
      token,
      readOnly: isMcpDirectoryWidgetReadCapabilityScope(scope),
      writable: isMcpDirectoryWidgetWriteCapabilityScope(scope),
    };
  }
  return widgetScopeCache.writable;
}

/**
 * True when this document is the app nested in an MCP App widget shell (the
 * chat bridge is active) on a directory-widget read capability, which the
 * server limits to the widget's own resource reads.
 */
export function isMcpDirectoryWidgetReadOnlyEmbed(): boolean {
  const token = getEmbedAuthToken();
  if (!token) return false;
  if (widgetScopeCache?.token !== token) {
    const scope = readEmbedTokenScope(token);
    widgetScopeCache = {
      token,
      readOnly: isMcpDirectoryWidgetReadCapabilityScope(scope),
      writable: isMcpDirectoryWidgetWriteCapabilityScope(scope),
    };
  }
  return widgetScopeCache.readOnly && isEmbedMcpChatBridgeActive();
}

export function isMcpDirectoryWidgetWriteEmbed(): boolean {
  return (
    hasMcpDirectoryWidgetWriteCapabilityToken() && isEmbedMcpChatBridgeActive()
  );
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
    // An inline card sizes itself to this document, so `100vh` must not follow
    // the frame. A host that owns the frame's height (see
    // mcpAppHostFillsContainer) sets the fill attribute and the clamp lifts.
    const inline = `html:not([${MCP_APP_HOST_FILL_ATTRIBUTE}])`;
    style.textContent = `
${inline},
${inline} body {
  min-height: 0 !important;
  height: ${height} !important;
  max-height: ${height} !important;
  overflow: hidden !important;
}

${inline} #root,
${inline} #__next,
${inline} [data-agent-native-app-root] {
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

  const pending = pendingMcpChatBridgeViewportNotification;
  pendingMcpChatBridgeViewportNotification = null;
  if (pending) {
    if (pending.animationFrameId !== null) {
      pending.win.cancelAnimationFrame?.(pending.animationFrameId);
    }
    for (const id of pending.timeoutIds) pending.win.clearTimeout(id);
  }

  notify();
  const nextPending = {
    win,
    animationFrameId: null as number | null,
    timeoutIds: [] as number[],
  };
  pendingMcpChatBridgeViewportNotification = nextPending;
  const notifyIfCurrent = () => {
    if (pendingMcpChatBridgeViewportNotification !== nextPending) return;
    notify();
  };
  try {
    if (win.requestAnimationFrame) {
      nextPending.animationFrameId = win.requestAnimationFrame(notifyIfCurrent);
    }
    if (win.setTimeout) {
      nextPending.timeoutIds.push(win.setTimeout(notifyIfCurrent, 250));
      nextPending.timeoutIds.push(win.setTimeout(notifyIfCurrent, 1000));
    }
  } catch {
    // Timers are a progressive enhancement for late host bridge initialization.
  }
}

export function _resetEmbedAuthForTests(): void {
  if (pendingMcpChatBridgeViewportNotification) {
    const pending = pendingMcpChatBridgeViewportNotification;
    pendingMcpChatBridgeViewportNotification = null;
    if (pending.animationFrameId !== null) {
      pending.win.cancelAnimationFrame?.(pending.animationFrameId);
    }
    for (const id of pending.timeoutIds) pending.win.clearTimeout(id);
  }
  installed = false;
  memoryToken = null;
  renewedFromUrlToken = null;
  pendingWidgetSessionRenewal = null;
  widgetSessionRenewalRequestId = 0;
  widgetScopeCache = null;
  mcpChatBridgeActive = false;
  mcpChatBridgeScope = null;
  authFailureCache.clear();
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
    return true;
  }
}

function stripTokenFromUrl(win: Window): void {
  // Keep the token in the URL for opaque-origin frames — see
  // isOpaqueOriginFrame. Stripping it there breaks re-auth on any document
  // reload. Embed responses now use Referrer-Policy: same-origin, but that
  // never leaks the retained token here: an opaque origin never equals any
  // other origin (including its own), so "same-origin" requests from this
  // document never qualify and no Referer is sent at all.
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
  return [FRAMEWORK_INTERNAL_ROUTE_PREFIX, frameworkRoutePrefix()].some(
    (prefix) =>
      pathname === prefix ||
      pathname.endsWith(prefix) ||
      pathname.includes(`${prefix}/`),
  );
}

// What a read-only widget session is refused whatever it asks for: the agent
// state it can never write.
function isReadOnlyWidgetRefusedPath(pathname: string): boolean {
  return [FRAMEWORK_INTERNAL_ROUTE_PREFIX, frameworkRoutePrefix()].some(
    (prefix) =>
      pathname.endsWith(`${prefix}/application-state`) ||
      pathname.includes(`${prefix}/application-state/`),
  );
}

// The refusal the server's auth guard already sends such a session, answered
// locally so each caller takes the error path it takes today without the
// request or its console error.
function readOnlyWidgetRefusal(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    statusText: "Unauthorized",
    headers: { "Content-Type": "application/json" },
  });
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
  // Only an embed replays refusals, so a missing or expired embed token can't
  // set off a retry storm. Elsewhere a refusal can lift mid-session, as when
  // someone shares the page, and a replayed one would hide that for a minute.
  if (!isEmbedAuthActive()) return false;
  if (!GUARDED_METHODS.has(method)) return false;
  if (url.pathname === EMBED_START_PATH) return false;
  if (
    url.pathname.endsWith(SIGN_IN_ENTRY_PATH) ||
    url.pathname.endsWith(SIGN_IN_LEGACY_ENTRY_PATH)
  ) {
    return false;
  }
  return true;
}

function activeAuthFailure(
  record: AuthFailureRecord | null | undefined,
): AuthFailureRecord | null {
  if (!record) return null;
  if (record.expiresAt > Date.now()) return record;
  return null;
}

function getCachedAuthFailure(key: string): AuthFailureRecord | null {
  const cached = activeAuthFailure(authFailureCache.get(key));
  if (cached) return cached;
  authFailureCache.delete(key);
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
}

function clearAuthFailure(key: string): void {
  authFailureCache.delete(key);
}

/**
 * Forgets every replayed refusal. Call it when access is known to have
 * changed, such as a link's status turning `allowed`: a refusal recorded
 * before then would otherwise fail the next read for up to a minute.
 */
export function forgetAuthFailures(): void {
  authFailureCache.clear();
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
    url.searchParams.set(EMBED_TARGET_QUERY_PARAM, currentEmbedTarget(win));
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

function requestWidgetSessionRenewal(win: Window): Promise<boolean> {
  if (pendingWidgetSessionRenewal) return pendingWidgetSessionRenewal;
  if (!win.parent || win.parent === win) return Promise.resolve(false);

  widgetSessionRenewalRequestId += 1;
  const requestId = `embed-renewal-${Date.now()}-${widgetSessionRenewalRequestId}`;
  const renewal = new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;
    const finish = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) win.clearTimeout(timeoutId);
      win.removeEventListener("message", onMessage);
      resolve(succeeded);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win.parent) return;
      const message = event.data;
      const data = message && typeof message === "object" ? message.data : null;
      if (
        message?.type !== "agentNative.embedSessionRenewed" ||
        data?.requestId !== requestId
      ) {
        return;
      }
      if (data.ok !== true) {
        finish(false);
        return;
      }
      try {
        win.parent.postMessage(
          { type: "agentNative.embedSessionRenewalApplied", requestId },
          "*",
        );
      } catch (error) {
        console.warn(
          "[agent-native] could not acknowledge embedded session renewal",
          error,
        );
      }
      finish(true);
    };

    win.addEventListener("message", onMessage);
    timeoutId = win.setTimeout(
      () => finish(false),
      EMBED_SESSION_RENEWAL_TIMEOUT_MS,
    );
    try {
      win.parent.postMessage(
        {
          type: "agentNative.embedSessionExpired",
          data: { requestId },
        },
        "*",
      );
    } catch {
      finish(false);
    }
  }).finally(() => {
    pendingWidgetSessionRenewal = null;
  });

  pendingWidgetSessionRenewal = renewal;
  return renewal;
}

export function ensureEmbedAuthFetchInterceptor(): void {
  const win = browserWindow();
  if (!win) return;

  if (readEmbedMcpChatBridgeFlagFromUrl()) markEmbedMcpChatBridgeActive();

  const urlToken = readTokenFromUrl(win);
  if (urlToken) {
    getEmbedAuthToken();
    stripTokenFromUrl(win);
  }
  ensureMcpChatBridgeViewportClamp(win);

  if (installed) return;
  if (typeof win.fetch !== "function") return;
  const originalFetch = win.fetch.bind(win);
  const patchedFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    if (isMcpDirectoryWidgetReadOnlyEmbed() && sameOrigin(input, win)) {
      const url = inputUrl(input, win);
      if (url && isReadOnlyWidgetRefusedPath(url.pathname)) {
        return readOnlyWidgetRefusal();
      }
    }
    const request = requestUrlAndKey(input, init, win);
    if (request?.shouldGuard) {
      const cached = getCachedAuthFailure(request.key);
      if (cached) return authFailureResponse(cached);
    }

    const token = getEmbedAuthToken();
    let fetchInput = input;
    let fetchInit = init;
    if (token && sameOrigin(input, win)) {
      [fetchInput, fetchInit] = withEmbedAuthHeaders(input, init, token, win);
    }

    const canRenewWidgetSession =
      Boolean(token) &&
      isMcpDirectoryWidgetWriteEmbed() &&
      request &&
      sameOrigin(input, win);
    let replayRequest: Request | null = null;
    let firstRequest: Request | null = null;
    if (canRenewWidgetSession) {
      try {
        firstRequest = new Request(fetchInput as RequestInfo, fetchInit);
        replayRequest = firstRequest.clone();
      } catch {
        // coercion-ok: non-cloneable streamed writes retain their original response and are not replayed.
      }
    }

    let response = firstRequest
      ? await originalFetch(firstRequest)
      : await originalFetch(fetchInput as any, fetchInit as any);
    if (response.status === 401 && canRenewWidgetSession) {
      const sessionExpired =
        response.headers.get(MCP_DIRECTORY_WIDGET_SESSION_EXPIRED_HEADER) ===
        "1";
      if (sessionExpired && replayRequest && token) {
        const renewed = await requestWidgetSessionRenewal(win);
        if (renewed) {
          const [retryInput, retryInit] = withEmbedAuthHeaders(
            replayRequest,
            undefined,
            token,
            win,
          );
          response = await originalFetch(retryInput as any, retryInit as any);
        }
      }
    }
    if (request?.shouldGuard && isAuthFailureStatus(response.status)) {
      await recordAuthFailure(request.key, response);
    } else if (request?.shouldGuard && response.ok) {
      clearAuthFailure(request.key);
    }
    return response;
  }) as typeof fetch;
  try {
    win.fetch = patchedFetch;
  } catch {
    try {
      Object.defineProperty(win, "fetch", {
        configurable: true,
        value: patchedFetch,
        writable: true,
      });
    } catch {
      return;
    }
  }
  installed = true;
}
