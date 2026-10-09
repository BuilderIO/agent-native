import type {
  AgentNativeBrowserSession,
  AgentNativeBrowserSessionRecord,
  AgentNativeBrowserSessionRequest,
} from "../browser-sessions/types.js";
import { createPollEngine } from "../shared/poll-engine.js";
import { agentNativePath } from "./api-path.js";
import {
  announceAgentNativeFrameReady,
  defaultAgentNativeHostCommands,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  requestAgentNativeHostWebMcpTools,
  runAgentNativeHostAction,
  runAgentNativeHostWebMcpTool,
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
import type {
  AgentNativeWebMcpClient,
  AgentNativeWebMcpTool,
} from "./webmcp.js";

export interface AgentNativeBrowserSessionBridgeOptions extends AgentNativeHostRequestOptions {
  endpoint?: string;
  sessionId?: string;
  session?: string | Partial<AgentNativeHostSession>;
  getContext?: AgentNativeHostContextGetter;
  actions?: AgentNativeClientActions;
  webmcp?: AgentNativeWebMcpClient | "host";
  commands?: AgentNativeHostCommandHandlers;
  origin?: string;
  label?: string;
  heartbeatMs?: number;
  pollMs?: number;
  ttlMs?: number;
  fetch?: typeof fetch;
  onError?: (
    error: unknown,
    source: AgentNativeBrowserSessionBridgeErrorSource,
  ) => void;
}

export type AgentNativeBrowserSessionBridgeErrorSource = "heartbeat" | "poll";

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
const REQUEST_ABORT_MIN_MS = 10_000;
const HIDDEN_INTERVAL_FLOOR_MS = 10_000;

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function browserSessionId(): string {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function requestAbortMs(
  options: AgentNativeBrowserSessionBridgeOptions,
): number {
  const cadence = Math.min(
    options.pollMs ?? DEFAULT_POLL_MS,
    options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
  );
  return Math.max(REQUEST_ABORT_MIN_MS, cadence * 4);
}

class BrowserSessionRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Browser-session request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
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
  let body: any;
  try {
    body = await response.json();
  } catch (error) {
    if (!response.ok && error instanceof SyntaxError) {
      throw new Error(`Browser-session request failed (${response.status})`);
    }
    throw error;
  }
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
  signal?: AbortSignal,
): Promise<any> {
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const abortFromSignal = () => controller?.abort();
  if (signal?.aborted) {
    abortFromSignal();
  } else {
    signal?.addEventListener("abort", abortFromSignal, { once: true });
  }
  const timeoutMs = requestAbortMs(options);
  let timedOut = false;
  const timeoutId = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  try {
    const response = await fetchImpl(options)(endpointPath(options, path), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-CSRF": "1",
      },
      body: JSON.stringify(body ?? {}),
      ...(controller
        ? { signal: controller.signal }
        : signal
          ? { signal }
          : {}),
    });
    return await readJsonResponse(response);
  } catch (error) {
    if (timedOut) throw new BrowserSessionRequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromSignal);
  }
}

async function deleteJson(
  options: AgentNativeBrowserSessionBridgeOptions,
  path: string,
): Promise<void> {
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), requestAbortMs(options))
    : null;
  try {
    const response = await fetchImpl(options)(endpointPath(options, path), {
      method: "DELETE",
      credentials: "include",
      headers: {
        "X-Agent-Native-CSRF": "1",
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    await readJsonResponse(response);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
    webmcp: _webmcp,
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
    options.session ||
    (options.webmcp && options.webmcp !== "host"),
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
  const manifest = { ...action };
  delete (manifest as Partial<AgentNativeClientAction>).run;
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

async function resolveWebMcpTools(
  options: AgentNativeBrowserSessionBridgeOptions,
): Promise<AgentNativeWebMcpTool[] | undefined> {
  if (!options.webmcp) return undefined;
  try {
    if (options.webmcp === "host") {
      return await requestAgentNativeHostWebMcpTools(
        hostRequestOptions(options),
      );
    }
    if (!options.webmcp.supported) return [];
    return await options.webmcp.listTools();
  } catch (error) {
    void error;
    return undefined;
  }
}

function requireDirectWebMcpClient(
  options: AgentNativeBrowserSessionBridgeOptions,
): AgentNativeWebMcpClient {
  if (!options.webmcp || options.webmcp === "host") {
    throw new Error("WebMCP is not enabled for this browser session");
  }
  return options.webmcp;
}

function findWebMcpTool(
  tools: AgentNativeWebMcpTool[],
  name: string,
  origin?: string,
): AgentNativeWebMcpTool | undefined {
  const matches = tools.filter(
    (tool) => tool.name === name && (!origin || tool.origin === origin),
  );
  if (matches.length > 1 && !origin) {
    throw new Error(
      `WebMCP tool "${name}" is exposed by multiple origins; origin is required`,
    );
  }
  return matches[0];
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
  if (request.type === "list-webmcp-tools") {
    const tools = await requireDirectWebMcpClient(options).listTools();
    return tools;
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
  if (request.type === "run-webmcp-tool") {
    if (!request.name) {
      throw new Error("Browser-session WebMCP request is missing name");
    }
    const client = requireDirectWebMcpClient(options);
    const tools = await client.listTools();
    const tool = findWebMcpTool(tools, request.name, request.origin);
    if (!tool) {
      throw new Error(`WebMCP tool "${request.name}" is no longer available`);
    }
    return client.executeListedTool(tool, request.args);
  }
  if (request.type === "command") {
    return runDirectCommand(
      request.command || "refreshData",
      request.payload,
      request.id,
      options,
    );
  }
  throw new Error(
    `Unknown browser-session request type: ${String(request.type)}`,
  );
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
  const hostOptions = hostRequestOptions(options);
  if (options.webmcp === "host" && request.type === "list-webmcp-tools") {
    return requestAgentNativeHostWebMcpTools(hostOptions);
  }
  if (options.webmcp === "host" && request.type === "run-webmcp-tool") {
    if (!request.name) {
      throw new Error("Browser-session WebMCP request is missing name");
    }
    return runAgentNativeHostWebMcpTool(
      { name: request.name, origin: request.origin },
      request.args,
      hostOptions,
    );
  }
  if (hasDirectHost(options)) {
    return executeDirectBrowserSessionRequest(request, options);
  }

  if (request.type === "get-context") {
    return requestAgentNativeHostContext(hostOptions);
  }
  if (request.type === "list-actions") {
    return requestAgentNativeHostActions(hostOptions);
  }
  if (request.type === "list-webmcp-tools") {
    return requestAgentNativeHostWebMcpTools(hostOptions);
  }
  if (request.type === "run-action") {
    if (!request.name)
      throw new Error("Browser-session action request is missing name");
    return runAgentNativeHostAction(request.name, request.args, hostOptions);
  }
  if (request.type === "run-webmcp-tool") {
    if (!request.name) {
      throw new Error("Browser-session WebMCP request is missing name");
    }
    return runAgentNativeHostWebMcpTool(
      { name: request.name, origin: request.origin },
      request.args,
      hostOptions,
    );
  }
  if (request.type === "command") {
    return sendAgentNativeHostCommand(
      request.command || "refreshData",
      request.payload,
      hostOptions,
    );
  }
  throw new Error(
    `Unknown browser-session request type: ${String(request.type)}`,
  );
}

export function createAgentNativeBrowserSessionBridge(
  options: AgentNativeBrowserSessionBridgeOptions = {},
): AgentNativeBrowserSessionBridge {
  let currentSessionId: string | null = options.sessionId ?? null;
  let fallbackSessionId: string | null = null;
  let started = false;
  let onVisibility: (() => void) | undefined;
  let lastWebMcpTools: AgentNativeWebMcpTool[] | undefined;
  let activeRequestCount = 0;
  const requestExpiryTimers = new Set<ReturnType<typeof setTimeout>>();

  async function refreshRegistration(
    signal?: AbortSignal,
  ): Promise<AgentNativeBrowserSessionRecord> {
    const direct = hasDirectHost(options);
    const hostOptions = hostRequestOptions(options);
    const [context, actions, webmcpTools] = direct
      ? await Promise.all([
          resolveDirectContext(options),
          resolveDirectActionManifest(options).catch(() => []),
          resolveWebMcpTools(options),
        ])
      : await Promise.all([
          requestAgentNativeHostContext(hostOptions),
          requestAgentNativeHostActions(hostOptions).catch(() => []),
          resolveWebMcpTools(options),
        ]);
    lastWebMcpTools = webmcpTools;
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
    const body = await postJson(
      options,
      "",
      {
        session,
        sessionId: currentSessionId,
        context,
        actions,
        ...(lastWebMcpTools !== undefined
          ? { webmcpTools: lastWebMcpTools }
          : {}),
        ttlMs: options.ttlMs,
      },
      signal,
    );
    return body.session as AgentNativeBrowserSessionRecord;
  }

  async function claimOnce(
    signal?: AbortSignal,
  ): Promise<AgentNativeBrowserSessionRequest | null> {
    if (!currentSessionId) {
      await refreshRegistration(signal);
    }
    if (!currentSessionId) return null;

    let claim: any;
    try {
      claim = await postJson(
        options,
        `/${encodePathSegment(currentSessionId)}/requests/claim`,
        {},
        signal,
      );
    } catch (error) {
      const timedOut = error instanceof BrowserSessionRequestTimeoutError;
      if ((timedOut || (signal?.aborted && started)) && currentSessionId) {
        const sessionId = currentSessionId;
        try {
          await deleteJson(options, `/${encodePathSegment(sessionId)}`);
          if (currentSessionId === sessionId) currentSessionId = null;
        } catch (cleanupError) {
          const combinedError = new AggregateError(
            [error, cleanupError],
            "Browser-session claim timed out and its possible claim could not be cleared",
          );
          requestPoll.onError(combinedError, { force: true });
          throw combinedError;
        }
      }
      throw error;
    }
    const request = claim.request as AgentNativeBrowserSessionRequest | null;
    if (!request) return null;

    activeRequestCount++;
    const expiryTimer = setTimeout(
      () => {
        requestPoll.onError(
          new Error(
            `Browser-session request "${request.id}" is still running after expiry`,
          ),
          { force: true },
        );
      },
      Math.max(0, request.expiresAt - Date.now()),
    );
    requestExpiryTimers.add(expiryTimer);
    try {
      let result: unknown;
      try {
        result = await executeBrowserSessionRequest(request, options);
      } catch (error) {
        try {
          await postJson(
            options,
            `/${encodePathSegment(currentSessionId)}/requests/${encodePathSegment(
              request.id,
            )}/complete`,
            { ok: false, error: messageError(error).message },
          );
        } catch (completionError) {
          const combinedError = new AggregateError(
            [error, completionError],
            `Browser-session request "${request.id}" failed and its failure could not be reported`,
          );
          requestPoll.onError(combinedError, { force: true });
          throw combinedError;
        }
        return request;
      }
      try {
        await postJson(
          options,
          `/${encodePathSegment(currentSessionId)}/requests/${encodePathSegment(
            request.id,
          )}/complete`,
          { ok: true, result },
        );
      } catch (error) {
        requestPoll.onError(error, { force: true });
        throw error;
      }
    } finally {
      clearTimeout(expiryTimer);
      requestExpiryTimers.delete(expiryTimer);
      activeRequestCount--;
    }

    return request;
  }

  function backgroundPoll(
    source: AgentNativeBrowserSessionBridgeErrorSource,
    attempt: (signal: AbortSignal) => Promise<unknown>,
  ) {
    let reportedFailure = false;
    return {
      attempt: async (signal: AbortSignal) => {
        await attempt(signal);
        reportedFailure = false;
      },
      onError: (error: unknown, control: { force?: boolean } = {}) => {
        const force = control.force ?? false;
        if (reportedFailure && !force) return;
        reportedFailure = true;
        if (options.onError) {
          try {
            options.onError(error, source);
          } catch (callbackError) {
            console.error(
              `[Agent-Native browser session] ${source} onError callback failed:`,
              callbackError,
            );
          }
        } else {
          console.error(
            `[Agent-Native browser session] ${source} failed:`,
            error,
          );
        }
      },
    };
  }

  const heartbeatPoll = backgroundPoll("heartbeat", (signal) =>
    refreshRegistration(signal).then(() => {}),
  );
  const heartbeatEngine = createPollEngine(heartbeatPoll.attempt, {
    onError: heartbeatPoll.onError,
    intervalMs: () => {
      const base = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
      return isDocumentHidden()
        ? Math.max(base, HIDDEN_INTERVAL_FLOOR_MS)
        : base;
    },
  });
  const requestPoll = backgroundPoll("poll", (signal) =>
    claimOnce(signal).then(() => {}),
  );
  const pollEngine = createPollEngine(requestPoll.attempt, {
    onError: requestPoll.onError,
    onTimeout: (error) => {
      if (activeRequestCount === 0) requestPoll.onError(error);
    },
    intervalMs: () => {
      const base = options.pollMs ?? DEFAULT_POLL_MS;
      return isDocumentHidden()
        ? Math.max(base, HIDDEN_INTERVAL_FLOOR_MS)
        : base;
    },
  });

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
      heartbeatEngine.start();
      pollEngine.start();
      onVisibility = () => {
        if (isDocumentHidden()) {
          heartbeatEngine.reschedule();
          pollEngine.reschedule();
        } else {
          heartbeatEngine.pollNow();
          pollEngine.pollNow();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      return bridge;
    },
    stop() {
      if (!started) return;
      started = false;
      heartbeatEngine.stop();
      pollEngine.stop();
      for (const timer of requestExpiryTimers) clearTimeout(timer);
      requestExpiryTimers.clear();
      if (onVisibility) {
        document.removeEventListener("visibilitychange", onVisibility);
        onVisibility = undefined;
      }
      if (currentSessionId) {
        void deleteJson(
          options,
          `/${encodePathSegment(currentSessionId)}`,
        ).catch((error) => {
          requestPoll.onError(
            new Error(
              `Failed to disconnect browser session "${currentSessionId}" after stop; outstanding requests may remain active until expiry: ${messageError(error).message}`,
            ),
            { force: true },
          );
        });
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
