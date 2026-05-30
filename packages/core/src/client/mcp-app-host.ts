import { useSyncExternalStore } from "react";
import { getFrameOrigin } from "./frame.js";
import {
  getEmbedAuthToken,
  isEmbedAuthActive,
  markEmbedMcpChatBridgeActive,
  isEmbedMcpChatBridgeActive,
  readEmbedMcpChatBridgeFlagFromUrl,
} from "./embed-auth.js";
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

export interface McpAppHostChatMessage {
  message: string;
  context?: string;
  content?: McpAppModelContextContentPart[];
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

type PendingJsonRpcRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
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
const DIRECT_MCP_APP_PROTOCOL_VERSION = "2026-01-26";

let snapshot: McpAppHostContextSnapshot = {
  context: null,
  capabilities: null,
  version: null,
};
const listeners = new Set<() => void>();
const pending = new Map<string, PendingRequest>();
const jsonRpcPending = new Map<string, PendingJsonRpcRequest>();
let directMcpAppInit: Promise<boolean> | null = null;
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
  if (readEmbedMcpChatBridgeFlagFromUrl()) markEmbedMcpChatBridgeActive();
  if (isEmbedMcpChatBridgeActive() && isEmbedAuthActive()) return true;
  const params = new URLSearchParams(window.location.search || "");
  return (
    params.get(EMBED_MODE_QUERY_PARAM) === "1" &&
    (params.has(EMBED_TOKEN_QUERY_PARAM) || Boolean(getEmbedAuthToken())) &&
    params.get(MCP_APP_CHAT_BRIDGE_QUERY_PARAM) === "1"
  );
}

function isClaudeMcpContentHost(): boolean {
  if (!isBrowserWindow()) return false;
  try {
    return /(^|\.)claudemcpcontent\.com$/i.test(window.location.hostname || "");
  } catch {
    return false;
  }
}

function hasWrapperBridge(): boolean {
  if (!isBrowserWindow()) return false;
  const params = new URLSearchParams(window.location.search || "");
  const mode =
    params.get("embedMode") ??
    params.get("renderMode") ??
    params.get("embed_mode") ??
    "";
  if (mode === "iframe" || mode === "nested") return true;
  if (params.get("nested") === "1" || params.get("frame") === "iframe") {
    return true;
  }
  if (isClaudeMcpContentHost()) return false;
  return Boolean(getFrameOrigin());
}

function isTrustedParentMessage(event: MessageEvent): boolean {
  if (!isInChildFrame()) return false;
  return event.source === window.parent;
}

function requestId(): string {
  return `mcp-host-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function jsonRpcRequestId(): string {
  return `mcp-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function updateSnapshotFromInitialize(result: unknown): void {
  if (!isRecord(result)) return;
  updateSnapshot({
    context: result.hostContext,
    capabilities: result.hostCapabilities,
    version: result.hostInfo ?? result.protocolVersion,
  });
}

function updateSnapshotFromOpenAiBridge(bridge: OpenAiAppBridge): void {
  updateSnapshot({
    context: {
      displayMode: bridge.displayMode,
      availableDisplayModes:
        typeof bridge.requestDisplayMode === "function"
          ? ["inline", "fullscreen", "pip"]
          : [],
      maxHeight: bridge.maxHeight,
      locale: bridge.locale,
      theme: bridge.theme,
      view: bridge.view,
    },
    capabilities: {
      updateModelContext: typeof bridge.setWidgetState === "function",
      openLink: typeof bridge.openExternal === "function",
      displayModes:
        typeof bridge.requestDisplayMode === "function"
          ? ["inline", "fullscreen", "pip"]
          : [],
      openai: true,
    },
    version: bridge.userAgent,
  });
}

function resolvePending(data: HostResponseMessage["data"]): void {
  if (!isRecord(data) || typeof data.requestId !== "string") return;
  const request = pending.get(data.requestId);
  if (!request) return;
  pending.delete(data.requestId);
  clearTimeout(request.timeout);
  request.resolve(data.ok === true);
}

function resolveJsonRpc(data: Record<string, unknown>): void {
  const id = typeof data.id === "string" ? data.id : String(data.id ?? "");
  if (!id) return;
  const request = jsonRpcPending.get(id);
  if (!request) return;
  jsonRpcPending.delete(id);
  clearTimeout(request.timeout);
  if (isRecord(data.error)) {
    const message =
      typeof data.error.message === "string"
        ? data.error.message
        : "MCP Apps host request failed.";
    request.reject(new Error(message));
    return;
  }
  request.resolve(data.result ?? {});
}

function handleJsonRpcNotification(message: Record<string, unknown>): void {
  if (message.method !== "ui/notifications/host-context-changed") return;
  updateSnapshot({
    context: isRecord(message.params) ? message.params : undefined,
  });
}

function onMessage(event: MessageEvent): void {
  if (!isTrustedParentMessage(event)) return;
  const message = event.data;
  if (!isRecord(message)) return;

  if (message.type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.HOST_CONTEXT) {
    updateSnapshot((message as HostContextMessage).data);
    return;
  }

  if (message.type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE) {
    resolvePending((message as HostResponseMessage).data);
    return;
  }

  if (message.jsonrpc === "2.0") {
    if ("id" in message && ("result" in message || "error" in message)) {
      resolveJsonRpc(message);
      return;
    }
    if (typeof message.method === "string") {
      handleJsonRpcNotification(message);
    }
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

  if (!hasWrapperBridge()) {
    return postDirectHostRequest(type, data);
  }

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

function postWrapperHostChat(chat: McpAppHostChatMessage): Promise<boolean> {
  ensureListener();
  const id = requestId();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timeout });

    try {
      window.parent.postMessage(
        {
          type: "agentNative.submitChat",
          data: {
            requestId: id,
            message: chat.message,
            context: chat.context?.trim() || "",
            submit: true,
            ...(chat.content?.length ? { content: chat.content } : {}),
          },
        },
        "*",
      );
    } catch {
      pending.delete(id);
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

interface OpenAiAppBridge {
  widgetState?: unknown;
  displayMode?: unknown;
  maxHeight?: unknown;
  locale?: unknown;
  theme?: unknown;
  view?: unknown;
  userAgent?: unknown;
  setWidgetState?: (state: unknown) => void;
  sendFollowUpMessage?: (args: {
    prompt: string;
    scrollToBottom?: boolean;
  }) => unknown | Promise<unknown>;
  openExternal?: (args: {
    href: string;
    redirectUrl?: boolean;
  }) => unknown | Promise<unknown>;
  requestDisplayMode?: (args: {
    mode: McpAppDisplayMode;
  }) => unknown | Promise<unknown>;
}

function readOpenAiBridge(): OpenAiAppBridge | null {
  if (!isBrowserWindow()) return null;
  const bridge = (window as unknown as { openai?: unknown }).openai;
  return bridge && typeof bridge === "object"
    ? (bridge as OpenAiAppBridge)
    : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function postJsonRpcNotification(method: string, params?: unknown): void {
  if (!isInChildFrame()) return;
  try {
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  } catch {
    // Best-effort lifecycle notification.
  }
}

function postJsonRpcRequest(
  method: string,
  params?: unknown,
): Promise<unknown> | false {
  ensureListener();
  if (!isInChildFrame()) return false;

  const id = jsonRpcRequestId();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      jsonRpcPending.delete(id);
      reject(new Error("MCP Apps host did not respond."));
    }, REQUEST_TIMEOUT_MS);
    jsonRpcPending.set(id, { resolve, reject, timeout });

    try {
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    } catch (err) {
      jsonRpcPending.delete(id);
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function ensureDirectMcpAppInitialized(): Promise<boolean> {
  if (!isInChildFrame() || !isMcpAppBridgeEnabled()) return false;
  if (hasWrapperBridge()) return true;

  const openAiBridge = readOpenAiBridge();
  if (openAiBridge) {
    updateSnapshotFromOpenAiBridge(openAiBridge);
    return true;
  }

  if (!directMcpAppInit) {
    directMcpAppInit = (async () => {
      const result = await postJsonRpcRequest("ui/initialize", {
        protocolVersion: DIRECT_MCP_APP_PROTOCOL_VERSION,
        appInfo: { name: "Agent Native App", version: "1.0.0" },
        appCapabilities: {
          availableDisplayModes: ["inline", "fullscreen", "pip"],
        },
      });
      updateSnapshotFromInitialize(result);
      postJsonRpcNotification("ui/notifications/initialized", {});
      return true;
    })().catch(() => false);
  }

  return directMcpAppInit;
}

async function waitForDirectMcpAppInitialized(): Promise<void> {
  const ok = await ensureDirectMcpAppInitialized();
  if (!ok) throw new Error("MCP Apps host bridge is not available.");
}

async function postDirectHostRequest(
  type:
    | typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.UPDATE_MODEL_CONTEXT
    | typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.OPEN_LINK
    | typeof AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.REQUEST_DISPLAY_MODE,
  data: Record<string, unknown>,
): Promise<boolean> {
  const openAiBridge = readOpenAiBridge();
  if (openAiBridge) {
    updateSnapshotFromOpenAiBridge(openAiBridge);
    if (
      type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.UPDATE_MODEL_CONTEXT &&
      typeof openAiBridge.setWidgetState === "function"
    ) {
      openAiBridge.setWidgetState({
        ...objectValue(openAiBridge.widgetState),
        agentNativeModelContext: {
          ...(Array.isArray(data.content) ? { content: data.content } : {}),
          ...(data.structuredContent !== undefined
            ? { structuredContent: data.structuredContent }
            : {}),
        },
      });
      return true;
    }
    if (
      type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.OPEN_LINK &&
      typeof openAiBridge.openExternal === "function" &&
      typeof data.url === "string"
    ) {
      await openAiBridge.openExternal({
        href: data.url,
        redirectUrl: false,
      });
      return true;
    }
    if (
      type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.REQUEST_DISPLAY_MODE &&
      typeof openAiBridge.requestDisplayMode === "function" &&
      typeof data.mode === "string"
    ) {
      await openAiBridge.requestDisplayMode({ mode: data.mode });
      updateSnapshotFromOpenAiBridge(openAiBridge);
      return true;
    }
  }

  await waitForDirectMcpAppInitialized();
  const method =
    type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.UPDATE_MODEL_CONTEXT
      ? "ui/update-model-context"
      : type === AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.OPEN_LINK
        ? "ui/open-link"
        : "ui/request-display-mode";
  await postJsonRpcRequest(method, data);
  return true;
}

export function sendMcpAppHostMessage(
  chat: McpAppHostChatMessage,
): Promise<boolean> | false {
  if (!chat.message.trim() || !isInChildFrame() || !isMcpAppBridgeEnabled()) {
    return false;
  }

  if (hasWrapperBridge()) return postWrapperHostChat(chat);

  return (async () => {
    const openAiBridge = readOpenAiBridge();
    const context = chat.context?.trim() || null;
    const content = chat.content?.length
      ? chat.content
      : [{ type: "text", text: chat.message }];
    const contextContent = context
      ? [
          { type: "text", text: context },
          ...content.filter((part) => part && part.type !== "text"),
        ]
      : content.filter((part) => part && part.type !== "text");
    if (
      openAiBridge &&
      typeof openAiBridge.sendFollowUpMessage === "function"
    ) {
      updateSnapshotFromOpenAiBridge(openAiBridge);
      if (typeof openAiBridge.setWidgetState === "function") {
        openAiBridge.setWidgetState({
          ...objectValue(openAiBridge.widgetState),
          agentNativeChatContext: context,
          agentNativeModelContext: { content: contextContent },
        });
      }
      await openAiBridge.sendFollowUpMessage({
        prompt: chat.message,
        scrollToBottom: true,
      });
      return true;
    }

    await waitForDirectMcpAppInitialized();
    try {
      await postJsonRpcRequest("ui/update-model-context", {
        content: contextContent,
      });
    } catch {
      // Best effort: a host without model-context support should still receive
      // the visible chat message.
    }
    await postJsonRpcRequest("ui/message", {
      role: "user",
      content,
    });
    return true;
  })().catch(() => false);
}

export function getMcpAppHostContext(): McpAppHostContextSnapshot {
  ensureListener();
  const bridge = readOpenAiBridge();
  if (bridge) updateSnapshotFromOpenAiBridge(bridge);
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
  for (const request of jsonRpcPending.values()) clearTimeout(request.timeout);
  pending.clear();
  jsonRpcPending.clear();
  directMcpAppInit = null;
  snapshot = { context: null, capabilities: null, version: null };
  listeners.clear();
}

if (isBrowserWindow()) {
  window.addEventListener(
    "openai:set_globals",
    () => {
      const bridge = readOpenAiBridge();
      if (bridge) updateSnapshotFromOpenAiBridge(bridge);
    },
    { passive: true },
  );
}
