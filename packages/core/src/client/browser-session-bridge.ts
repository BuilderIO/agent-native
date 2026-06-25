import type {
  AgentNativeBrowserSession,
  AgentNativeBrowserSessionRecord,
  AgentNativeBrowserSessionRequest,
} from "../browser-sessions/types.js";
import { agentNativePath } from "./api-path.js";
import {
  announceAgentNativeFrameReady,
  defaultAgentNativeHostCommands,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
  type AgentNativeActionManifestEntry,
  type AgentNativeClientAction,
  type AgentNativeClientActions,
  type AgentNativeHostRequestOptions,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostContext,
  type AgentNativeHostContextGetter,
  type AgentNativeHostSession,
} from "./host-bridge.js";

export interface AgentNativeBrowserSessionBridgeOptions extends AgentNativeHostRequestOptions {
  /** Framework browser-session endpoint. Defaults to /_agent-native/browser-sessions. */
  endpoint?: string;
  /** Stable tab/session id. Defaults to the host-provided session id. */
  sessionId?: string;
  /**
   * Direct in-app session identity. Use this when the Agent-Native chat is
   * rendered inside the host app instead of inside a sidecar iframe.
   */
  session?: string | Partial<AgentNativeHostSession>;
  /**
   * Direct in-app context getter. When set, the bridge does not use
   * postMessage; it registers this tab directly with the backend.
   */
  getContext?: AgentNativeHostContextGetter;
  /** Direct in-app client actions exposed to backend browser-session tools. */
  actions?: AgentNativeClientActions;
  /** Direct in-app host commands exposed to backend browser-session tools. */
  commands?: AgentNativeHostCommandHandlers;
  /** Origin label passed to direct action/command callbacks. */
  origin?: string;
  /** Human-readable label shown to the agent when multiple tabs are live. */
  label?: string;
  /** Re-register host context/actions on this interval. Defaults to 5s. */
  heartbeatMs?: number;
  /** Claim pending backend requests on this interval. Defaults to 500ms. */
  pollMs?: number;
  /** Session TTL on the server. Defaults to 45s. */
  ttlMs?: number;
  /** Override fetch for tests or custom runtimes. */
  fetch?: typeof fetch;
}

export interface AgentNativeBrowserSessionBridge {
  readonly sessionId: string | null;
  start(): AgentNativeBrowserSessionBridge;
  stop(): void;
  refreshRegistration(): Promise<AgentNativeBrowserSessionRecord>;
  claimOnce(): Promise<AgentNativeBrowserSessionRequest | null>;
}

const DEFAULT_ENDPOINT = "/_agent-native/browser-sessions";
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_POLL_MS = 500;

function browserSessionId(): string {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function messageError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function endpointBase(options: AgentNativeBrowserSessionBridgeOptions): string {
  return options.endpoint ?? agentNativePath(DEFAULT_ENDPOINT);
}

function endpointPath(
  options: AgentNativeBrowserSessionBridgeOptions,
  path = "",
): string {
  const base = endpointBase(options).replace(/\/+$/, "");
  return `${base}${path}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function fetchImpl(
  options: AgentNativeBrowserSessionBridgeOptions,
): typeof fetch {
  const fn =
    options.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fn) throw new Error("fetch is not available");
  return fn;
}

async function readJsonResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Browser-session request failed (${response.status})`,
    );
  }
  return body;
}

async function postJson(
  options: AgentNativeBrowserSessionBridgeOptions,
  path: string,
  body: unknown,
): Promise<any> {
  const response = await fetchImpl(options)(endpointPath(options, path), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-CSRF": "1",
    },
    body: JSON.stringify(body ?? {}),
  });
  return readJsonResponse(response);
}

async function deleteJson(
  options: AgentNativeBrowserSessionBridgeOptions,
  path: string,
): Promise<void> {
  const response = await fetchImpl(options)(endpointPath(options, path), {
    method: "DELETE",
    credentials: "include",
    headers: {
      "X-Agent-Native-CSRF": "1",
    },
  });
  await readJsonResponse(response);
}

function hostRequestOptions(
  options: AgentNativeBrowserSessionBridgeOptions,
): AgentNativeHostRequestOptions {
  const {
    endpoint: _endpoint,
    sessionId: _sessionId,
    session: _session,
    getContext: _getContext,
    actions: _actions,
    commands: _commands,
    origin: _origin,
    label: _label,
    heartbeatMs: _heartbeatMs,
    pollMs: _pollMs,
    ttlMs: _ttlMs,
    fetch: _fetch,
    ...hostOptions
  } = options;
  return hostOptions;
}

function hasDirectHost(
  options: AgentNativeBrowserSessionBridgeOptions,
): boolean {
  return Boolean(
    options.getContext ||
    options.actions ||
    options.commands ||
    options.session,
  );
}

function directOrigin(options: AgentNativeBrowserSessionBridgeOptions): string {
  return options.origin || "agent-native-embedded";
}

function directSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDirectHostSession(
  session: AgentNativeBrowserSessionBridgeOptions["session"],
  fallbackId: string | undefined,
  contextUrl: string | undefined,
): AgentNativeHostSession {
  const now = new Date().toISOString();
  const base =
    typeof session === "string"
      ? { id: session }
      : session && typeof session === "object"
        ? session
        : {};
  return {
    id: base.id || fallbackId || directSessionId(),
    connectedAt: base.connectedAt || now,
    url:
      base.url ||
      contextUrl ||
      (typeof window !== "undefined" ? window.location.href : undefined),
    ...base,
  };
}

function serializeForBrowserSession<T>(value: T, label: string): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
}

async function resolveDirectContext(
  options: AgentNativeBrowserSessionBridgeOptions,
): Promise<AgentNativeHostContext> {
  const raw = options.getContext ? await options.getContext() : {};
  const context = serializeForBrowserSession(
    raw ?? {},
    "Browser-session context",
  );
  const session = createDirectHostSession(
    options.session,
    options.sessionId,
    context.url,
  );
  return {
    ...context,
    session: {
      ...session,
      ...(context.session ?? {}),
    },
  };
}

async function resolveClientActions(
  actions: AgentNativeClientActions | undefined,
): Promise<AgentNativeClientAction[]> {
  const value = typeof actions === "function" ? await actions() : actions;
  return Array.isArray(value) ? value : [];
}

function toActionManifest(
  action: AgentNativeClientAction,
): AgentNativeActionManifestEntry | null {
  if (!action?.name || !action.description) return null;
  const { run: _run, ...manifest } = action;
  return serializeForBrowserSession(
    {
      source: "client",
      availability: "browser-session",
      ...manifest,
      schema: manifest.schema ?? manifest.parameters,
    },
    "Client action manifest",
  );
}

async function resolveDirectActionManifest(
  options: AgentNativeBrowserSessionBridgeOptions,
): Promise<AgentNativeActionManifestEntry[]> {
  const actions = await resolveClientActions(options.actions);
  return actions
    .map(toActionManifest)
    .filter(Boolean) as AgentNativeActionManifestEntry[];
}

async function findDirectAction(
  options: AgentNativeBrowserSessionBridgeOptions,
  name: string,
): Promise<AgentNativeClientAction | undefined> {
  const actions = await resolveClientActions(options.actions);
  return actions.find((action) => action.name === name);
}

async function runDirectCommand(
  command: string,
  payload: unknown,
  requestId: string | undefined,
  options: AgentNativeBrowserSessionBridgeOptions,
): Promise<unknown> {
  const handlers = {
    ...defaultAgentNativeHostCommands,
    ...(options.commands ?? {}),
  };
  const handler = handlers[command];
  if (!handler) {
    throw new Error(`Host command "${command}" is not available`);
  }
  return handler(
    {
      command,
      payload,
      requestId,
      origin: directOrigin(options),
    },
    undefined as unknown as MessageEvent,
  );
}

async function executeDirectBrowserSessionRequest(
  request: AgentNativeBrowserSessionRequest,
  options: AgentNativeBrowserSessionBridgeOptions,
): Promise<unknown> {
  if (request.type === "get-context") {
    return resolveDirectContext(options);
  }
  if (request.type === "list-actions") {
    return resolveDirectActionManifest(options);
  }
  if (request.type === "run-action") {
    if (!request.name) {
      throw new Error("Browser-session action request is missing name");
    }
    const action = await findDirectAction(options, request.name);
    if (!action) {
      throw new Error(`Client action "${request.name}" is not available`);
    }
    const context = await resolveDirectContext(options);
    const session =
      context.session ??
      createDirectHostSession(options.session, options.sessionId, context.url);
    return action.run(request.args, {
      requestId: request.id,
      origin: directOrigin(options),
      context,
      session,
      event: undefined as unknown as MessageEvent,
      refresh: (payload?: unknown) =>
        runDirectCommand("refreshData", payload, request.id, options),
      command: (command: string, payload?: unknown) =>
        runDirectCommand(command, payload, request.id, options),
    });
  }
  if (request.type === "command") {
    return runDirectCommand(
      request.command || "refreshData",
      request.payload,
      request.id,
      options,
    );
  }
  throw new Error(`Unknown browser-session request type: ${request.type}`);
}

function normalizeSession(
  sessionId: string,
  label: string | undefined,
  hostSession: AgentNativeHostSession | undefined,
  contextUrl: string | undefined,
): AgentNativeBrowserSession {
  return {
    ...(hostSession ?? {}),
    id: sessionId,
    ...(label
      ? { label }
      : hostSession?.label
        ? { label: hostSession.label }
        : {}),
    connectedAt: hostSession?.connectedAt ?? new Date().toISOString(),
    ...(contextUrl || hostSession?.url
      ? { url: contextUrl ?? hostSession?.url }
      : {}),
  };
}

async function executeBrowserSessionRequest(
  request: AgentNativeBrowserSessionRequest,
  options: AgentNativeBrowserSessionBridgeOptions,
): Promise<unknown> {
  if (hasDirectHost(options)) {
    return executeDirectBrowserSessionRequest(request, options);
  }

  const hostOptions = hostRequestOptions(options);
  if (request.type === "get-context") {
    return requestAgentNativeHostContext(hostOptions);
  }
  if (request.type === "list-actions") {
    return requestAgentNativeHostActions(hostOptions);
  }
  if (request.type === "run-action") {
    if (!request.name)
      throw new Error("Browser-session action request is missing name");
    return runAgentNativeHostAction(request.name, request.args, hostOptions);
  }
  if (request.type === "command") {
    return sendAgentNativeHostCommand(
      request.command || "refreshData",
      request.payload,
      hostOptions,
    );
  }
  throw new Error(`Unknown browser-session request type: ${request.type}`);
}

export function createAgentNativeBrowserSessionBridge(
  options: AgentNativeBrowserSessionBridgeOptions = {},
): AgentNativeBrowserSessionBridge {
  let currentSessionId: string | null = options.sessionId ?? null;
  let fallbackSessionId: string | null = null;
  let started = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;
  let polling = false;

  async function refreshRegistration(): Promise<AgentNativeBrowserSessionRecord> {
    const direct = hasDirectHost(options);
    const hostOptions = hostRequestOptions(options);
    const [context, actions] = direct
      ? await Promise.all([
          resolveDirectContext(options),
          resolveDirectActionManifest(options).catch(() => []),
        ])
      : await Promise.all([
          requestAgentNativeHostContext(hostOptions),
          requestAgentNativeHostActions(hostOptions).catch(() => []),
        ]);
    const hostSession = context.session;
    if (!currentSessionId) {
      currentSessionId =
        hostSession?.id || fallbackSessionId || browserSessionId();
      fallbackSessionId = currentSessionId;
    }
    const session = normalizeSession(
      currentSessionId,
      options.label,
      hostSession,
      context.url,
    );
    const body = await postJson(options, "", {
      session,
      sessionId: currentSessionId,
      context,
      actions,
      ttlMs: options.ttlMs,
    });
    return body.session as AgentNativeBrowserSessionRecord;
  }

  async function heartbeat(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      await refreshRegistration();
    } finally {
      refreshing = false;
    }
  }

  async function claimOnce(): Promise<AgentNativeBrowserSessionRequest | null> {
    if (!currentSessionId) {
      await refreshRegistration();
    }
    if (!currentSessionId) return null;

    const claim = await postJson(
      options,
      `/${encodePathSegment(currentSessionId)}/requests/claim`,
      {},
    );
    const request = claim.request as AgentNativeBrowserSessionRequest | null;
    if (!request) return null;

    try {
      const result = await executeBrowserSessionRequest(request, options);
      await postJson(
        options,
        `/${encodePathSegment(currentSessionId)}/requests/${encodePathSegment(
          request.id,
        )}/complete`,
        { ok: true, result },
      );
    } catch (error) {
      await postJson(
        options,
        `/${encodePathSegment(currentSessionId)}/requests/${encodePathSegment(
          request.id,
        )}/complete`,
        { ok: false, error: messageError(error).message },
      ).catch(() => {});
    }

    return request;
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      await claimOnce();
    } finally {
      polling = false;
    }
  }

  const bridge: AgentNativeBrowserSessionBridge = {
    get sessionId() {
      return currentSessionId;
    },
    start() {
      if (started) return bridge;
      started = true;
      if (!hasDirectHost(options)) {
        announceAgentNativeFrameReady(hostRequestOptions(options));
      }
      void heartbeat();
      void poll();
      heartbeatTimer = setInterval(
        () => void heartbeat(),
        options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      );
      pollTimer = setInterval(
        () => void poll(),
        options.pollMs ?? DEFAULT_POLL_MS,
      );
      return bridge;
    },
    stop() {
      if (!started) return;
      started = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pollTimer) clearInterval(pollTimer);
      heartbeatTimer = undefined;
      pollTimer = undefined;
      if (currentSessionId) {
        void deleteJson(
          options,
          `/${encodePathSegment(currentSessionId)}`,
        ).catch(() => {});
      }
    },
    refreshRegistration,
    claimOnce,
  };

  return bridge;
}

export function startAgentNativeBrowserSessionBridge(
  options: AgentNativeBrowserSessionBridgeOptions = {},
): AgentNativeBrowserSessionBridge {
  return createAgentNativeBrowserSessionBridge(options).start();
}
