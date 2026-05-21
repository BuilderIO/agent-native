import { useSyncExternalStore } from "react";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";

export const AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES = {
  HOST_CONTEXT: "agentNative.mcpHostContext",
  UPDATE_MODEL_CONTEXT: "agentNative.mcpHost.updateModelContext",
  OPEN_LINK: "agentNative.mcpHost.openLink",
  REQUEST_DISPLAY_MODE: "agentNative.mcpHost.requestDisplayMode",
  RESPONSE: "agentNative.mcpHost.response",
} as const;

export type AgentNativeMcpAppHostMessageType =
  (typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES)[keyof typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES];

export type McpAppDisplayMode = "inline" | "pip" | "fullscreen" | (string & {});

export interface McpAppModelContextContentPart {
  type: string;
  [key: string]: unknown;
}

export interface McpAppModelContextUpdate {
  content?: McpAppModelContextContentPart[];
  structuredContent?: unknown;
}

export interface McpAppHostCapabilities {
  updateModelContext?: boolean;
  openLink?: boolean;
  displayModes?: McpAppDisplayMode[];
  [key: string]: unknown;
}

export interface McpAppHostContext {
  capabilities?: McpAppHostCapabilities;
  [key: string]: unknown;
}

export interface McpAppHostContextSnapshot {
  context: McpAppHostContext | null;
  capabilities: McpAppHostCapabilities | null;
  version: unknown;
}

type PendingRequest = {
  resolve: (ok: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type HostContextMessage = {
  type: typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.HOST_CONTEXT;
  data?: {
    context?: unknown;
    capabilities?: unknown;
    version?: unknown;
  };
};

type HostResponseMessage = {
  type: typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE;
  data?: {
    requestId?: unknown;
    ok?: unknown;
    result?: unknown;
    error?: unknown;
  };
};

const REQUEST_TIMEOUT_MS = 5000;

let snapshot: McpAppHostContextSnapshot = {
  context: null,
  capabilities: null,
  version: null,
};
const listeners = new Set<() => void>();
const pending = new Map<string, PendingRequest>();
let listenerInstalled = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBrowserWindow(): boolean {
  return (
    typeof window !== "undefined" && typeof window.postMessage === "function"
  );
}

function isInChildFrame(): boolean {
  if (!isBrowserWindow()) return false;
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

function isMcpAppBridgeEnabled(): boolean {
  if (!isBrowserWindow()) return false;
  const params = new URLSearchParams(window.location.search || "");
  return (
    params.get(EMBED_MODE_QUERY_PARAM) === "1" &&
    params.has(EMBED_TOKEN_QUERY_PARAM) &&
    params.get(MCP_APP_CHAT_BRIDGE_QUERY_PARAM) === "1"
  );
}

function isTrustedParentMessage(event: MessageEvent): boolean {
  if (!isInChildFrame()) return false;
  return event.source === window.parent;
}

function requestId(): string {
  return `mcp-host-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function notify() {
  for (const listener of listeners) listener();
}

function updateSnapshot(data: HostContextMessage["data"]): void {
  if (!isRecord(data)) return;
  snapshot = {
    context: isRecord(data.context)
      ? (data.context as McpAppHostContext)
      : snapshot.context,
    capabilities: isRecord(data.capabilities)
      ? (data.capabilities as McpAppHostCapabilities)
      : snapshot.capabilities,
    version: data.version !== undefined ? data.version : snapshot.version,
  };
  notify();
}

function resolvePending(data: HostResponseMessage["data"]): void {
  if (!isRecord(data) || typeof data.requestId !== "string") return;
  const request = pending.get(data.requestId);
  if (!request) return;
  pending.delete(data.requestId);
  clearTimeout(request.timeout);
  request.resolve(data.ok === true);
}

function onMessage(event: MessageEvent): void {
  if (!isTrustedParentMessage(event)) return;
  const message = event.data;
  if (!isRecord(message) || typeof message.type !== "string") return;

  if (message.type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.HOST_CONTEXT) {
    updateSnapshot((message as HostContextMessage).data);
    return;
  }

  if (message.type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE) {
    resolvePending((message as HostResponseMessage).data);
  }
}

function ensureListener(): void {
  if (!isBrowserWindow() || listenerInstalled) return;
  window.addEventListener("message", onMessage);
  listenerInstalled = true;
}

function postHostRequest(
  type:
    | typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.UPDATE_MODEL_CONTEXT
    | typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.OPEN_LINK
    | typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.REQUEST_DISPLAY_MODE,
  data: Record<string, unknown>,
): Promise<boolean> | false {
  ensureListener();
  if (!isInChildFrame() || !isMcpAppBridgeEnabled()) return false;

  const id =
    typeof data.requestId === "string" && data.requestId
      ? data.requestId
      : requestId();
  const payload = { ...data, requestId: id };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timeout });

    try {
      window.parent.postMessage({ type, data: payload }, "*");
    } catch {
      pending.delete(id);
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

export function getMcpAppHostContext(): McpAppHostContextSnapshot {
  ensureListener();
  return snapshot;
}

export function useMcpAppHostContext(): McpAppHostContextSnapshot {
  ensureListener();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => ({ context: null, capabilities: null, version: null }),
  );
}

export function updateMcpAppModelContext(
  update: McpAppModelContextUpdate,
): Promise<boolean> | false {
  return postHostRequest(
    AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.UPDATE_MODEL_CONTEXT,
    {
      ...(Array.isArray(update.content) ? { content: update.content } : {}),
      ...(update.structuredContent !== undefined
        ? { structuredContent: update.structuredContent }
        : {}),
    },
  );
}

export function openMcpAppHostLink(url: string): Promise<boolean> | false {
  if (!url) return false;
  return postHostRequest(AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.OPEN_LINK, {
    url,
  });
}

export function requestMcpAppDisplayMode(
  mode: McpAppDisplayMode,
): Promise<boolean> | false {
  if (!mode) return false;
  return postHostRequest(
    AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.REQUEST_DISPLAY_MODE,
    { mode },
  );
}

ensureListener();

/** Internal test helper. Do not use in app code. */
export function _resetMcpAppHostForTests(): void {
  for (const request of pending.values()) clearTimeout(request.timeout);
  pending.clear();
  snapshot = { context: null, capabilities: null, version: null };
  listeners.clear();
}
