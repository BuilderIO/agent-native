import { toPublicFrameworkPath } from "../shared/framework-route-prefix.js";
import {
  isAgentNativeFirstPartyAppOrigin,
  isBuilderIoEmbedOrigin,
  isLocalMcpEmbedOrigin,
  isMcpProductHostOrigin,
} from "../shared/mcp-embed-headers.js";
import { isTruthyRuntimeValue } from "../shared/runtime-config.js";
import {
  frameworkRoutePrefix,
  isFrameworkRoutePath,
  resolveAppBasePath,
} from "./api-path.js";
import { agentNativePath } from "./api-path.js";
import { getEmbedAuthToken } from "./embed-auth.js";

export function sendToFrame(type: string, data?: any): void {
  if (typeof window === "undefined") return;
  const target = window.parent !== window ? window.parent : window;
  const targetOrigin =
    getFramePostMessageTargetOrigin() || window.location.origin;
  target.postMessage({ type, data }, targetOrigin);
}

export function onFrameMessage(
  type: string,
  handler: (data: any) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: MessageEvent) => {
    if (!isTrustedFrameMessage(event)) return;
    if (event.data?.type === type) {
      handler(event.data.data ?? event.data.detail ?? event.data);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

let _frameOrigin: string | null = null;

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "null") return "null";
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getFramePostMessageTargetOrigin(): string | null {
  const origin = getFrameOrigin();
  return origin === "null" ? "*" : origin;
}

export function isTrustedFrameMessage(event: MessageEvent): boolean {
  if (typeof window === "undefined") return false;

  const ownOrigin = window.location.origin;
  if (event.origin === ownOrigin) return true;

  const frameOrigin = getFrameOrigin();
  if (!frameOrigin) return false;
  if (frameOrigin === "null") {
    return (
      event.origin === "null" &&
      (event.source === window.parent || event.source === window)
    );
  }
  if (event.origin !== frameOrigin) return false;

  return event.source === window.parent || event.source === window;
}

let _contentHeightReportingStarted = false;
let _lastReportedContentHeight = 0;

function measureContentHeight(): number {
  if (typeof document === "undefined") return 0;
  const doc = document.documentElement;
  const body = document.body;
  return Math.ceil(
    Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0),
  );
}

function reportContentHeight(): void {
  if (typeof window === "undefined" || window.parent === window) return;
  const height = measureContentHeight();
  if (!height || Math.abs(height - _lastReportedContentHeight) < 2) return;
  _lastReportedContentHeight = height;
  sendToFrame("agentNative.contentHeight", { height });
}

function startContentHeightReporting(): void {
  if (_contentHeightReportingStarted || typeof window === "undefined") return;
  if (window.parent === window) return;
  _contentHeightReportingStarted = true;
  let scheduled = false;
  const schedule = () => {
    if (typeof window === "undefined") return;
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      if (typeof window === "undefined") return;
      reportContentHeight();
    });
  };
  schedule();
  for (const delay of [100, 300, 800, 1500]) window.setTimeout(schedule, delay);
  try {
    const observer = new ResizeObserver(schedule);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  } catch {
    window.addEventListener("resize", schedule, { passive: true });
  }
  window.addEventListener("load", schedule, { passive: true });
}

function configuredFrameHostOrigins(): string[] {
  const shell = window.__AGENT_NATIVE_CONFIG__ as
    | {
        frameHostOrigins?: unknown;
        appUrl?: unknown;
        workspaceGatewayUrl?: unknown;
        workspaceOAuthOrigin?: unknown;
      }
    | undefined;
  const listed: unknown[] = Array.isArray(shell?.frameHostOrigins)
    ? shell.frameHostOrigins
    : [];
  return [
    ...listed,
    shell?.appUrl,
    shell?.workspaceGatewayUrl,
    shell?.workspaceOAuthOrigin,
  ]
    .map((value) => (value === "null" ? null : normalizeOrigin(value)))
    .filter((value): value is string => value !== null);
}

/**
 * Hosts that may claim the parent role without an embed session: this app,
 * Builder, first-party agent-native hosts, the MCP hosts whose shells frame
 * apps, the deployment's configured origins, and loopback hosts during local
 * development.
 */
export function isKnownFrameHostOrigin(origin: string): boolean {
  if (typeof window === "undefined" || origin === "null") return false;
  if (origin === window.location.origin) return true;
  if (
    isBuilderIoEmbedOrigin(origin) ||
    isAgentNativeFirstPartyAppOrigin(origin) ||
    isMcpProductHostOrigin(origin)
  ) {
    return true;
  }
  if (isLocalMcpEmbedOrigin(origin)) {
    return isLocalMcpEmbedOrigin(window.location.origin);
  }
  return configuredFrameHostOrigins().includes(origin);
}

async function embedSessionAllowsUnlistedParent(): Promise<boolean> {
  const token = getEmbedAuthToken();
  if (!token) return false;
  try {
    const response = await fetch(
      agentNativePath("/_agent-native/auth/session"),
      {
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) return false;
    const session = (await response.json()) as {
      email?: unknown;
      token?: unknown;
    } | null;
    return (
      typeof session?.email === "string" &&
      session.email.length > 0 &&
      session.token === token
    );
  } catch {
    // coercion-ok: an unanswered check leaves the parent unaccepted.
    return false;
  }
}

let _pendingFrameOrigin: string | null = null;

function acceptFrameOrigin(origin: string): void {
  if (_frameOrigin) return;
  _frameOrigin = origin;
  window.parent.postMessage(
    { type: "agentNative.embeddedAppReady" },
    getFramePostMessageTargetOrigin() ?? window.location.origin,
  );
  startContentHeightReporting();
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type === "agentNative.viewRequest") {
      void handleEmbeddedViewRequest(event);
      return;
    }
    const eventOrigin = normalizeOrigin(event.origin);
    const payloadOrigin = normalizeOrigin(event.data?.origin);
    const origin = eventOrigin ?? payloadOrigin;
    if (
      event.data?.type !== "agentNative.frameOrigin" ||
      !origin ||
      (payloadOrigin && payloadOrigin !== origin && origin !== "null") ||
      _frameOrigin ||
      event.source !== window.parent
    ) {
      return;
    }
    if (isKnownFrameHostOrigin(origin)) {
      acceptFrameOrigin(origin);
      return;
    }
    if (_pendingFrameOrigin) return;
    _pendingFrameOrigin = origin;
    void embedSessionAllowsUnlistedParent().then((allowed) => {
      if (allowed) acceptFrameOrigin(origin);
      else _pendingFrameOrigin = null;
    });
  });
}

async function handleEmbeddedViewRequest(event: MessageEvent): Promise<void> {
  const port = event.ports.at(0);
  const token = getEmbedAuthToken();
  if (
    !port ||
    !token ||
    event.source !== window.parent ||
    event.origin !== getFrameOrigin() ||
    (event.origin !== window.location.origin &&
      !configuredFrameHostOrigins().includes(event.origin))
  )
    return;
  const request = event.data as {
    operation?: unknown;
    path?: unknown;
    deadline?: unknown;
  };
  const deadline = request.deadline;
  if (
    typeof deadline !== "number" ||
    deadline < Date.now() ||
    deadline > Date.now() + 1000
  ) {
    port.close();
    return;
  }
  try {
    if (!(await embedSessionAllowsUnlistedParent())) {
      port.postMessage({
        error: "The embedded app session could not be verified.",
      });
      return;
    }
    if (Date.now() <= deadline && getEmbedAuthToken() === token) {
      port.postMessage({ result: runEmbeddedViewRequest(request) });
    }
  } catch (error) {
    port.postMessage({
      error: error instanceof Error ? error.message : "View request failed.",
    });
  } finally {
    port.close();
  }
}

function viewPath(url: URL): string {
  url.searchParams.delete("__an_embed_token");
  return url.pathname + url.search + url.hash;
}

function runEmbeddedViewRequest(request: {
  operation?: unknown;
  path?: unknown;
}) {
  if (request.operation === "read") {
    return {
      path: viewPath(new URL(window.location.href)),
      title: document.title,
      selectedText: window.getSelection()?.toString().trim().slice(0, 4000),
    };
  }
  const path = typeof request.path === "string" ? request.path.trim() : "";
  if (
    request.operation !== "navigate" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    throw new Error("Choose a path inside the open app.");
  }
  const target = new URL(path, window.location.href);
  if (target.origin !== window.location.origin)
    throw new Error("Choose a path inside the open app.");
  const base = resolveAppBasePath();
  if (
    base &&
    target.pathname !== base &&
    !target.pathname.startsWith(`${base}/`)
  ) {
    throw new Error("Choose a path inside the open app.");
  }
  const nextPath = viewPath(target);
  const index = window.history.state?.idx;
  const state = {
    usr: null,
    key: crypto.randomUUID(),
    idx: typeof index === "number" ? index + 1 : 0,
  };
  window.history.pushState(state, "", nextPath);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
  return { path: nextPath };
}

export function getFrameOrigin(): string | null {
  return _frameOrigin;
}

export function isInFrame(): boolean {
  return _frameOrigin !== null;
}

export function getCallbackOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function envFlag(name: string): boolean {
  return isTruthyRuntimeValue(runtimeEnvValue(name));
}

function runtimeEnvValue(name: string): string | boolean | undefined {
  const importMetaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | boolean | undefined>;
    }
  ).env;
  if (importMetaEnv?.[name] !== undefined) return importMetaEnv[name];
  return typeof process !== "undefined"
    ? (process.env as Record<string, string | undefined>)?.[name]
    : undefined;
}

function workspaceOAuthOrigin(): string | null {
  const shell =
    typeof window !== "undefined" ? window.__AGENT_NATIVE_CONFIG__ : undefined;
  const projectedRaw =
    shell?.workspaceOAuthOrigin || shell?.appUrl || shell?.workspaceGatewayUrl;
  if (shell?.workspaceRuntime === true) {
    if (typeof projectedRaw === "string" && projectedRaw.trim()) {
      try {
        return new URL(projectedRaw).origin;
      } catch {
        // coercion-ok: a stale projected origin intentionally falls back below.
        // Fall through to the current origin when the projected value is stale.
      }
    }
    const currentOrigin = getCallbackOrigin();
    return currentOrigin || null;
  }

  const raw =
    projectedRaw ||
    runtimeEnvValue("VITE_WORKSPACE_OAUTH_ORIGIN") ||
    runtimeEnvValue("WORKSPACE_OAUTH_ORIGIN") ||
    runtimeEnvValue("VITE_APP_URL") ||
    runtimeEnvValue("APP_URL") ||
    runtimeEnvValue("VITE_BETTER_AUTH_URL") ||
    runtimeEnvValue("BETTER_AUTH_URL") ||
    runtimeEnvValue("VITE_WORKSPACE_GATEWAY_URL") ||
    runtimeEnvValue("WORKSPACE_GATEWAY_URL");
  if (typeof raw !== "string" || !raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function shouldUseWorkspaceCallbackRelay(path: string): boolean {
  const projectedWorkspaceRuntime =
    typeof window !== "undefined" &&
    window.__AGENT_NATIVE_CONFIG__?.workspaceRuntime === true;
  return (
    (projectedWorkspaceRuntime || envFlag("VITE_AGENT_NATIVE_WORKSPACE")) &&
    isFrameworkRoutePath(path) &&
    (path.endsWith("/callback") || path.includes("/callback/"))
  );
}

export function oauthRedirectUri(callbackPath: string): string {
  const normalized = callbackPath.startsWith("/")
    ? callbackPath
    : `/${callbackPath}`;
  const path = shouldUseWorkspaceCallbackRelay(normalized)
    ? toPublicFrameworkPath(normalized, {
        publicPrefix: frameworkRoutePrefix(),
      })
    : agentNativePath(normalized);
  const oauthOrigin = shouldUseWorkspaceCallbackRelay(normalized)
    ? workspaceOAuthOrigin()
    : null;
  if (!oauthOrigin && URL.canParse(path)) return path;
  const origin = oauthOrigin ?? getCallbackOrigin();
  return `${origin}${path}`;
}

export interface UserInfo {
  name?: string;
  email?: string;
}

export function requestUserInfo(timeoutMs = 1500): Promise<UserInfo> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || window.parent === window) {
      resolve({});
      return;
    }

    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener("message", handler);
        resolve({});
      }
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (!event.data || event.data.type !== "agentNative.userInfo") return;
      if (event.source !== window.parent) return;
      const frameOrigin = getFrameOrigin();
      if (frameOrigin && event.origin !== frameOrigin) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      const { name, email } = event.data.data ?? {};
      resolve({ name: name || undefined, email: email || undefined });
    }

    window.addEventListener("message", handler);
    window.parent.postMessage(
      { type: "agentNative.getUserInfo" },
      getFramePostMessageTargetOrigin() ?? window.location.origin,
    );
  });
}

export function enterStyleEditing(selector: string): void {
  sendToFrame("agentNative.enterStyleEditing", { selector });
}

export function enterTextEditing(selector: string): void {
  sendToFrame("agentNative.enterTextEditing", { selector });
}

export function exitSelectionMode(): void {
  sendToFrame("agentNative.exitSelectionMode");
}
