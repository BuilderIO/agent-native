export const AGENT_NATIVE_HOST_BRIDGE_VERSION = "0.1.0";

export const AGENT_NATIVE_HOST_MESSAGE_TYPES = {
  READY: "agentNative.host.ready",
  INIT: "agentNative.host.init",
  GET_CONTEXT: "agentNative.host.getContext",
  CONTEXT: "agentNative.host.context",
  AUTH: "agentNative.host.auth",
  COMMAND: "agentNative.host.command",
  COMMAND_RESULT: "agentNative.host.commandResult",
  ERROR: "agentNative.host.error",
} as const;

export type AgentNativeHostMessageType =
  (typeof AGENT_NATIVE_HOST_MESSAGE_TYPES)[keyof typeof AGENT_NATIVE_HOST_MESSAGE_TYPES];

export type BuiltInAgentNativeHostCommand =
  | "navigate"
  | "refreshData"
  | "refresh-data"
  | "remountView"
  | "remount-view"
  | "hardReload"
  | "hard-reload"
  | "openResource"
  | "open-resource"
  | "requestApproval"
  | "request-approval";

export interface AgentNativeHostRouteContext {
  pathname?: string;
  search?: string;
  hash?: string;
  name?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  [key: string]: unknown;
}

export interface AgentNativeHostSelectionContext {
  type?: string;
  text?: string;
  ids?: string[];
  ranges?: unknown[];
  [key: string]: unknown;
}

export interface AgentNativeHostResourceContext {
  type?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface AgentNativeHostPrincipalContext {
  id?: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface AgentNativeHostCapabilities {
  commands?: string[];
  actions?: string[];
  refresh?: boolean;
  [key: string]: unknown;
}

export interface AgentNativeHostContext {
  url?: string;
  title?: string;
  route?: AgentNativeHostRouteContext;
  selection?: AgentNativeHostSelectionContext;
  resource?: AgentNativeHostResourceContext;
  user?: AgentNativeHostPrincipalContext;
  organization?: AgentNativeHostPrincipalContext;
  capabilities?: AgentNativeHostCapabilities | string[];
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AgentNativeHostAuthPayload {
  token?: string;
  headers?: Record<string, string>;
  userId?: string;
  organizationId?: string;
  [key: string]: unknown;
}

export type AgentNativeHostAuthValue =
  | string
  | AgentNativeHostAuthPayload
  | null
  | undefined;

export type AgentNativeHostAuth =
  | AgentNativeHostAuthValue
  | (() => AgentNativeHostAuthValue | Promise<AgentNativeHostAuthValue>);

export type AgentNativeHostContextGetter = () =>
  | AgentNativeHostContext
  | Promise<AgentNativeHostContext>;

export interface AgentNativeHostCommandRequest<TPayload = unknown> {
  command: string;
  payload?: TPayload;
  requestId?: string;
  origin: string;
}

export type AgentNativeHostCommandHandler<
  TPayload = unknown,
  TResult = unknown,
> = (
  request: AgentNativeHostCommandRequest<TPayload>,
  event: MessageEvent,
) => TResult | Promise<TResult>;

export type AgentNativeHostCommandHandlers = Record<
  string,
  AgentNativeHostCommandHandler | undefined
>;

export type AgentNativeHostBridgeEvent =
  | { type: "ready"; requestId?: string; origin: string }
  | { type: "init"; requestId?: string; origin?: string }
  | { type: "context"; requestId?: string; origin?: string }
  | { type: "auth"; requestId?: string; origin?: string }
  | {
      type: "command";
      command: string;
      requestId?: string;
      origin: string;
    }
  | {
      type: "ignored";
      reason: "origin" | "source" | "message";
      origin: string;
    }
  | { type: "error"; requestId?: string; error: Error; origin?: string };

export interface AgentNativeHostBridgeOptions {
  /**
   * The iframe/content window that runs the agent sidecar. Can be set later
   * with `bridge.setTargetWindow(iframe.contentWindow)`.
   */
  targetWindow?: Window | null;
  /**
   * Exact origin allowed to talk to the host, or a full URL whose origin should
   * be trusted. Pass "*" only for local prototypes.
   */
  agentOrigin?: string;
  /** Return current route, selected resource, user/org, and host-specific data. */
  getContext?: AgentNativeHostContextGetter;
  /**
   * Commands the sidecar may ask the host app to perform. If omitted, the
   * bridge still supports safe event-dispatch defaults for navigation/refresh.
   */
  commands?: AgentNativeHostCommandHandlers;
  /**
   * Optional bearer token or headers for the iframe sidecar. Only sent via
   * postMessage to the trusted `agentOrigin`.
   */
  auth?: AgentNativeHostAuth;
  onEvent?: (event: AgentNativeHostBridgeEvent) => void;
}

export interface AgentNativeHostBridge {
  start(): AgentNativeHostBridge;
  stop(): void;
  setTargetWindow(targetWindow: Window | null): void;
  post(message: Record<string, unknown>): boolean;
  sendInit(requestId?: string): Promise<boolean>;
  sendContext(requestId?: string): Promise<boolean>;
  refreshContext(): Promise<boolean>;
  sendAuth(requestId?: string): Promise<boolean>;
}

type IncomingHostMessage =
  | {
      type: typeof AGENT_NATIVE_HOST_MESSAGE_TYPES.READY;
      requestId?: string;
    }
  | {
      type: typeof AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT;
      requestId?: string;
    }
  | {
      type: typeof AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND;
      requestId?: string;
      command?: string;
      payload?: unknown;
    };

type HostResponse<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: Error };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "*") return "*";
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getWindowFromSource(source: MessageEventSource | null): Window | null {
  if (!source || !("postMessage" in source)) return null;
  return source as Window;
}

function messageError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function serializeForMessage<T>(value: T, label: string): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
}

function requestId(): string {
  return `host-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultContext(): AgentNativeHostContext {
  if (typeof window === "undefined") return {};
  return {
    url: window.location.href,
    title: typeof document !== "undefined" ? document.title : undefined,
    route: {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    },
  };
}

async function resolveHostContext(
  getContext: AgentNativeHostContextGetter | undefined,
): Promise<AgentNativeHostContext> {
  const base = defaultContext();
  const custom = getContext ? await getContext() : undefined;
  if (!custom) return serializeForMessage(base, "Host context");
  const merged = {
    ...base,
    ...custom,
    route:
      base.route || custom.route
        ? { ...(base.route ?? {}), ...(custom.route ?? {}) }
        : undefined,
  };
  return serializeForMessage(merged, "Host context");
}

async function resolveHostAuth(
  auth: AgentNativeHostAuth | undefined,
): Promise<AgentNativeHostAuthPayload | undefined> {
  const value = typeof auth === "function" ? await auth() : auth;
  if (!value) return undefined;
  const payload = typeof value === "string" ? { token: value } : value;
  if (!payload || typeof payload !== "object") return undefined;
  const headers =
    payload.headers && typeof payload.headers === "object"
      ? Object.fromEntries(
          Object.entries(payload.headers).map(([key, val]) => [
            key,
            String(val),
          ]),
        )
      : undefined;
  return serializeForMessage(
    { ...payload, headers },
    "Host auth payload",
  ) as AgentNativeHostAuthPayload;
}

function dispatchHostEvent(
  type: string,
  payload: unknown,
): { dispatched: true } {
  if (typeof window === "undefined") return { dispatched: true };
  window.dispatchEvent(
    new CustomEvent(type, {
      detail: payload,
    }),
  );
  return { dispatched: true };
}

export const defaultAgentNativeHostCommands: AgentNativeHostCommandHandlers = {
  navigate: ({ payload }) => dispatchHostEvent("agentNative:navigate", payload),
  refreshData: ({ payload }) =>
    dispatchHostEvent("agentNative:refresh-data", payload),
  "refresh-data": ({ payload }) =>
    dispatchHostEvent("agentNative:refresh-data", payload),
  remountView: ({ payload }) =>
    dispatchHostEvent("agentNative:remount-view", payload),
  "remount-view": ({ payload }) =>
    dispatchHostEvent("agentNative:remount-view", payload),
  hardReload: () => {
    if (typeof window !== "undefined") window.location.reload();
    return { reloading: true };
  },
  "hard-reload": () => {
    if (typeof window !== "undefined") window.location.reload();
    return { reloading: true };
  },
  openResource: ({ payload }) =>
    dispatchHostEvent("agentNative:open-resource", payload),
  "open-resource": ({ payload }) =>
    dispatchHostEvent("agentNative:open-resource", payload),
};

function isIncomingHostMessage(value: unknown): value is IncomingHostMessage {
  if (!isRecord(value)) return false;
  return (
    value.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.READY ||
    value.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT ||
    value.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND
  );
}

export function createAgentNativeHostBridge(
  options: AgentNativeHostBridgeOptions,
): AgentNativeHostBridge {
  let targetWindow = options.targetWindow ?? null;
  let started = false;
  const allowedOrigin = normalizeOrigin(options.agentOrigin);
  const targetOrigin =
    allowedOrigin && allowedOrigin !== "*" ? allowedOrigin : "*";

  function emit(event: AgentNativeHostBridgeEvent) {
    options.onEvent?.(event);
  }

  function trusted(event: MessageEvent): boolean {
    if (
      allowedOrigin &&
      allowedOrigin !== "*" &&
      event.origin !== allowedOrigin
    ) {
      emit({ type: "ignored", reason: "origin", origin: event.origin });
      return false;
    }
    if (targetWindow && event.source !== targetWindow) {
      emit({ type: "ignored", reason: "source", origin: event.origin });
      return false;
    }
    return true;
  }

  function post(message: Record<string, unknown>): boolean {
    if (!targetWindow) return false;
    targetWindow.postMessage(message, targetOrigin);
    return true;
  }

  async function sendInit(requestId?: string): Promise<boolean> {
    const message: Record<string, unknown> = {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.INIT,
      version: AGENT_NATIVE_HOST_BRIDGE_VERSION,
      requestId,
    };
    try {
      message.context = await resolveHostContext(options.getContext);
    } catch (error) {
      message.contextError = messageError(error).message;
      emit({ type: "error", requestId, error: messageError(error) });
    }
    try {
      message.auth = await resolveHostAuth(options.auth);
    } catch (error) {
      message.authError = messageError(error).message;
      emit({ type: "error", requestId, error: messageError(error) });
    }
    const sent = post(message);
    if (sent) emit({ type: "init", requestId });
    return sent;
  }

  async function sendContext(requestId?: string): Promise<boolean> {
    try {
      const context = await resolveHostContext(options.getContext);
      const sent = post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.CONTEXT,
        ok: true,
        requestId,
        context,
      });
      if (sent) emit({ type: "context", requestId });
      return sent;
    } catch (error) {
      const err = messageError(error);
      emit({ type: "error", requestId, error: err });
      return post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.CONTEXT,
        ok: false,
        requestId,
        error: err.message,
      });
    }
  }

  async function sendAuth(requestId?: string): Promise<boolean> {
    try {
      const auth = await resolveHostAuth(options.auth);
      const sent = post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.AUTH,
        ok: true,
        requestId,
        auth,
      });
      if (sent) emit({ type: "auth", requestId });
      return sent;
    } catch (error) {
      const err = messageError(error);
      emit({ type: "error", requestId, error: err });
      return post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.AUTH,
        ok: false,
        requestId,
        error: err.message,
      });
    }
  }

  async function handleCommand(
    message: IncomingHostMessage,
    event: MessageEvent,
  ) {
    if (message.type !== AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND) return;
    const command = typeof message.command === "string" ? message.command : "";
    const requestId = message.requestId;
    try {
      if (!command) throw new Error("Missing host command");
      const handler =
        options.commands?.[command] ?? defaultAgentNativeHostCommands[command];
      if (!handler) {
        throw new Error(`No host command handler registered for "${command}"`);
      }
      emit({ type: "command", command, requestId, origin: event.origin });
      const result = await handler(
        {
          command,
          payload: message.payload,
          requestId,
          origin: event.origin,
        },
        event,
      );
      post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT,
        ok: true,
        requestId,
        result: serializeForMessage(result, "Host command result"),
      });
    } catch (error) {
      const err = messageError(error);
      emit({ type: "error", requestId, error: err, origin: event.origin });
      post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT,
        ok: false,
        requestId,
        error: err.message,
      });
    }
  }

  function onMessage(event: MessageEvent) {
    const message = event.data;
    if (!isIncomingHostMessage(message)) return;
    if (!trusted(event)) return;

    const sourceWindow = getWindowFromSource(event.source);
    if (!targetWindow && sourceWindow) targetWindow = sourceWindow;

    if (message.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.READY) {
      emit({
        type: "ready",
        requestId: message.requestId,
        origin: event.origin,
      });
      void sendInit(message.requestId);
    } else if (message.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT) {
      void sendContext(message.requestId);
    } else if (message.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND) {
      void handleCommand(message, event);
    } else {
      emit({ type: "ignored", reason: "message", origin: event.origin });
    }
  }

  const bridge: AgentNativeHostBridge = {
    start() {
      if (started || typeof window === "undefined") return bridge;
      window.addEventListener("message", onMessage);
      started = true;
      return bridge;
    },
    stop() {
      if (!started || typeof window === "undefined") return;
      window.removeEventListener("message", onMessage);
      started = false;
    },
    setTargetWindow(nextTargetWindow) {
      targetWindow = nextTargetWindow;
    },
    post,
    sendInit,
    sendContext,
    refreshContext: sendContext,
    sendAuth,
  };

  return bridge;
}

export interface AgentNativeHostRequestOptions {
  /** Origin to send messages to. Defaults to "*" so prototypes can start. */
  targetOrigin?: string;
  /** Optional exact origin expected in replies from the host app. */
  hostOrigin?: string;
  timeoutMs?: number;
  targetWindow?: Window;
}

function getFrameTargetWindow(targetWindow?: Window): Window | null {
  if (targetWindow) return targetWindow;
  if (typeof window === "undefined") return null;
  try {
    return window.parent !== window ? window.parent : window;
  } catch {
    return window.parent;
  }
}

function isTrustedHostResponse(
  event: MessageEvent,
  targetWindow: Window,
  hostOrigin?: string,
): boolean {
  if (event.source !== targetWindow) return false;
  const origin = normalizeOrigin(hostOrigin);
  if (origin && origin !== "*" && event.origin !== origin) return false;
  return true;
}

function requestFromHost<TValue>(
  message: Record<string, unknown>,
  responseType: AgentNativeHostMessageType,
  pick: (message: Record<string, unknown>) => HostResponse<TValue>,
  options: AgentNativeHostRequestOptions = {},
): Promise<TValue> {
  return new Promise((resolve, reject) => {
    const targetWindow = getFrameTargetWindow(options.targetWindow);
    if (!targetWindow || typeof window === "undefined") {
      reject(new Error("No host window is available"));
      return;
    }

    const id =
      typeof message.requestId === "string" ? message.requestId : requestId();
    const timeoutMs = options.timeoutMs ?? 3000;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for host response")));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (!isTrustedHostResponse(event, targetWindow, options.hostOrigin)) {
        return;
      }
      if (!isRecord(event.data)) return;
      if (event.data.type !== responseType) return;
      if (event.data.requestId !== id) return;

      const response = pick(event.data);
      if (response.ok) {
        finish(() => resolve(response.value));
      } else if ("error" in response) {
        const error = response.error;
        finish(() => reject(error));
      }
    }

    window.addEventListener("message", onMessage);
    targetWindow.postMessage(
      { ...message, requestId: id },
      options.targetOrigin ?? options.hostOrigin ?? "*",
    );
  });
}

export function announceAgentNativeFrameReady(
  options: AgentNativeHostRequestOptions = {},
): void {
  const targetWindow = getFrameTargetWindow(options.targetWindow);
  if (!targetWindow) return;
  targetWindow.postMessage(
    {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.READY,
      version: AGENT_NATIVE_HOST_BRIDGE_VERSION,
      requestId: requestId(),
    },
    options.targetOrigin ?? options.hostOrigin ?? "*",
  );
}

export function requestAgentNativeHostContext(
  options: AgentNativeHostRequestOptions = {},
): Promise<AgentNativeHostContext> {
  return requestFromHost(
    { type: AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT },
    AGENT_NATIVE_HOST_MESSAGE_TYPES.CONTEXT,
    (message) => {
      if (message.ok === false) {
        return {
          ok: false,
          error: new Error(
            typeof message.error === "string"
              ? message.error
              : "Host context request failed",
          ),
        };
      }
      return {
        ok: true,
        value: (message.context ?? {}) as AgentNativeHostContext,
      };
    },
    options,
  );
}

export function sendAgentNativeHostCommand<
  TPayload = unknown,
  TResult = unknown,
>(
  command: BuiltInAgentNativeHostCommand | string,
  payload?: TPayload,
  options: AgentNativeHostRequestOptions = {},
): Promise<TResult> {
  return requestFromHost(
    {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND,
      command,
      payload,
    },
    AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT,
    (message) => {
      if (message.ok === false) {
        return {
          ok: false,
          error: new Error(
            typeof message.error === "string"
              ? message.error
              : "Host command failed",
          ),
        };
      }
      return { ok: true, value: message.result as TResult };
    },
    options,
  );
}

export interface AgentNativeHostInit {
  version?: string;
  context?: AgentNativeHostContext;
  auth?: AgentNativeHostAuthPayload;
  contextError?: string;
  authError?: string;
}

export function onAgentNativeHostInit(
  handler: (init: AgentNativeHostInit) => void,
  options: Pick<
    AgentNativeHostRequestOptions,
    "hostOrigin" | "targetWindow"
  > = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  const targetWindow = getFrameTargetWindow(options.targetWindow);
  if (!targetWindow) return () => {};

  function onMessage(event: MessageEvent) {
    if (!isTrustedHostResponse(event, targetWindow, options.hostOrigin)) {
      return;
    }
    if (!isRecord(event.data)) return;
    if (event.data.type !== AGENT_NATIVE_HOST_MESSAGE_TYPES.INIT) return;
    handler({
      version:
        typeof event.data.version === "string" ? event.data.version : undefined,
      context: isRecord(event.data.context)
        ? (event.data.context as AgentNativeHostContext)
        : undefined,
      auth: isRecord(event.data.auth)
        ? (event.data.auth as AgentNativeHostAuthPayload)
        : undefined,
      contextError:
        typeof event.data.contextError === "string"
          ? event.data.contextError
          : undefined,
      authError:
        typeof event.data.authError === "string"
          ? event.data.authError
          : undefined,
    });
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
