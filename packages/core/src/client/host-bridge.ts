export const AGENT_NATIVE_HOST_BRIDGE_VERSION = "0.1.0";

export const AGENT_NATIVE_HOST_MESSAGE_TYPES = {
  READY: "agentNative.host.ready",
  INIT: "agentNative.host.init",
  GET_CONTEXT: "agentNative.host.getContext",
  CONTEXT: "agentNative.host.context",
  AUTH: "agentNative.host.auth",
  LIST_ACTIONS: "agentNative.host.listActions",
  ACTIONS: "agentNative.host.actions",
  RUN_ACTION: "agentNative.host.runAction",
  ACTION_RESULT: "agentNative.host.actionResult",
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

export type AgentNativeJsonSchema = Record<string, unknown>;

export type AgentNativeActionAvailability =
  | "browser-session"
  | "current-page"
  | "backend"
  | "always";

export interface AgentNativeActionManifestEntry {
  name: string;
  description: string;
  schema?: AgentNativeJsonSchema;
  /** Alias for schema for function-calling/tooling runtimes. */
  parameters?: AgentNativeJsonSchema;
  title?: string;
  source?: "client" | "backend" | string;
  availability?: AgentNativeActionAvailability | string;
  destructive?: boolean;
  requiresApproval?: boolean | AgentNativeClientActionApprovalConfig;
  approval?: AgentNativeClientActionApprovalConfig;
  [key: string]: unknown;
}

export interface AgentNativeClientActionApprovalConfig {
  title?: string;
  description?: string;
  confirmLabel?: string;
  risk?: "low" | "medium" | "high" | string;
  [key: string]: unknown;
}

export interface AgentNativeHostSession {
  id: string;
  label?: string;
  connectedAt: string;
  url?: string;
  [key: string]: unknown;
}

export interface AgentNativeClientActionRuntime {
  requestId?: string;
  origin: string;
  context: AgentNativeHostContext;
  session: AgentNativeHostSession;
  event: MessageEvent;
  refresh(payload?: unknown): Promise<unknown>;
  command(command: string, payload?: unknown): Promise<unknown>;
}

export interface AgentNativeClientAction<
  TArgs = unknown,
  TResult = unknown,
> extends AgentNativeActionManifestEntry {
  run(
    args: TArgs,
    runtime: AgentNativeClientActionRuntime,
  ): TResult | Promise<TResult>;
}

export type AgentNativeClientActionGetter = () =>
  | AgentNativeClientAction[]
  | Promise<AgentNativeClientAction[]>;

export type AgentNativeClientActions =
  | AgentNativeClientAction[]
  | AgentNativeClientActionGetter;

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
  screen?: AgentNativeScreenSnapshot;
  session?: AgentNativeHostSession;
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
  | { type: "actions"; requestId?: string; count: number; origin?: string }
  | {
      type: "action";
      name: string;
      requestId?: string;
      origin: string;
    }
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
  /** Stable browser-session identity. Used by the sidecar to distinguish tabs. */
  session?: string | Partial<AgentNativeHostSession>;
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
  /**
   * Live browser-session actions. These can change per render/page context and
   * are only callable while this host page is connected.
   */
  actions?: AgentNativeClientActions;
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
  sendActions(requestId?: string): Promise<boolean>;
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
      type: typeof AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS;
      requestId?: string;
    }
  | {
      type: typeof AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION;
      requestId?: string;
      name?: string;
      args?: unknown;
      payload?: unknown;
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

function sessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createHostSession(
  session: AgentNativeHostBridgeOptions["session"],
): AgentNativeHostSession {
  const now = new Date().toISOString();
  const base =
    typeof session === "string"
      ? { id: session }
      : session && typeof session === "object"
        ? session
        : {};
  return {
    id: base.id || sessionId(),
    connectedAt: base.connectedAt || now,
    url:
      base.url ||
      (typeof window !== "undefined" ? window.location.href : undefined),
    ...base,
  };
}

function attachSession(
  context: AgentNativeHostContext,
  session: AgentNativeHostSession,
): AgentNativeHostContext {
  return serializeForMessage(
    {
      ...context,
      session: {
        ...session,
        ...(context.session ?? {}),
      },
    },
    "Host context",
  );
}

export interface AgentNativeScreenSnapshot {
  url?: string;
  title?: string;
  route?: AgentNativeHostRouteContext;
  selection?: AgentNativeHostSelectionContext;
  visibleText?: string;
  html?: string;
  viewport?: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
}

export interface AgentNativeScreenSnapshotOptions {
  /**
   * Root element to read from. Defaults to document.body, then documentElement.
   */
  root?: Element | null | (() => Element | null | undefined);
  /** Include textContent from the root element. Defaults to true. */
  includeVisibleText?: boolean;
  /** Include outerHTML from the root element. Defaults to false. */
  includeDomHtml?: boolean;
  /** Max characters of visible text to include. Defaults to 6000. */
  maxTextLength?: number;
  /** Max characters of DOM html to include. Defaults to 20000. */
  maxHtmlLength?: number;
}

function truncate(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function resolveSnapshotRoot(
  root: AgentNativeScreenSnapshotOptions["root"],
): Element | null {
  if (typeof document === "undefined") return null;
  if (typeof root === "function") return root() ?? null;
  return root ?? document.body ?? document.documentElement;
}

function readElementText(root: Element): string | undefined {
  if (typeof document === "undefined") return root.textContent ?? undefined;
  try {
    const showText =
      typeof NodeFilter === "undefined" ? 4 : NodeFilter.SHOW_TEXT;
    const walker = document.createTreeWalker(root, showText);
    const parts: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) parts.push(text);
    }
    return parts.join(" ");
  } catch {
    return root.textContent ?? undefined;
  }
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

export function readAgentNativeScreenContext(
  options: AgentNativeScreenSnapshotOptions = {},
): AgentNativeHostContext {
  const base = defaultContext();
  if (typeof window === "undefined") return base;

  const root = resolveSnapshotRoot(options.root);
  const selectionText =
    typeof window.getSelection === "function"
      ? window.getSelection()?.toString().trim() || undefined
      : undefined;
  const maxTextLength = options.maxTextLength ?? 6000;
  const maxHtmlLength = options.maxHtmlLength ?? 20000;
  const includeVisibleText = options.includeVisibleText ?? true;
  const includeDomHtml = options.includeDomHtml ?? false;
  const selection = selectionText
    ? { ...(base.selection ?? {}), type: "text", text: selectionText }
    : base.selection;

  return {
    ...base,
    selection,
    screen: {
      url: base.url,
      title: base.title,
      route: base.route,
      selection,
      visibleText:
        includeVisibleText && root
          ? truncate(readElementText(root), maxTextLength)
          : undefined,
      html:
        includeDomHtml && root
          ? truncate(root.outerHTML ?? undefined, maxHtmlLength)
          : undefined,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
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
  return serializeForMessage(
    {
      source: "client",
      availability: "browser-session",
      ...manifest,
      schema: manifest.schema ?? manifest.parameters,
    },
    "Client action manifest",
  );
}

async function resolveActionManifest(
  actions: AgentNativeClientActions | undefined,
): Promise<AgentNativeActionManifestEntry[]> {
  const resolved = await resolveClientActions(actions);
  return resolved
    .map(toActionManifest)
    .filter(Boolean) as AgentNativeActionManifestEntry[];
}

async function findClientAction(
  actions: AgentNativeClientActions | undefined,
  name: string,
): Promise<AgentNativeClientAction | undefined> {
  const resolved = await resolveClientActions(actions);
  return resolved.find((action) => action.name === name);
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

/**
 * Cooldown for host-issued `hardReload` / `hard-reload` commands. A reload is
 * already in flight after the first command, so repeats inside this window are
 * acknowledged (`{ reloading: true }` — the page IS reloading) but do not call
 * `window.location.reload()` again. Without this, an embedding host that sends
 * the command on a loop (health checks, per-edit refresh logic) can keep the
 * page permanently mid-reload.
 */
const HARD_RELOAD_COOLDOWN_MS = 2_000;
let lastHardReloadAt = 0;

/** @internal Exported for tests only. */
export function _resetHostHardReloadCooldownForTests(): void {
  lastHardReloadAt = 0;
}

function runGuardedHardReload(): { reloading: true } {
  if (typeof window !== "undefined") {
    const now = Date.now();
    if (now - lastHardReloadAt >= HARD_RELOAD_COOLDOWN_MS) {
      lastHardReloadAt = now;
      window.location.reload();
    }
  }
  return { reloading: true };
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
  hardReload: () => runGuardedHardReload(),
  "hard-reload": () => runGuardedHardReload(),
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
    value.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS ||
    value.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION ||
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
  const session = createHostSession(options.session);

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
      message.session = session;
      message.context = attachSession(
        await resolveHostContext(options.getContext),
        session,
      );
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
    try {
      message.actions = await resolveActionManifest(options.actions);
    } catch (error) {
      message.actionsError = messageError(error).message;
      emit({ type: "error", requestId, error: messageError(error) });
    }
    const sent = post(message);
    if (sent) emit({ type: "init", requestId });
    return sent;
  }

  async function sendContext(requestId?: string): Promise<boolean> {
    try {
      const context = attachSession(
        await resolveHostContext(options.getContext),
        session,
      );
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

  async function sendActions(requestId?: string): Promise<boolean> {
    try {
      const actions = await resolveActionManifest(options.actions);
      const sent = post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTIONS,
        ok: true,
        requestId,
        actions,
      });
      if (sent) emit({ type: "actions", requestId, count: actions.length });
      return sent;
    } catch (error) {
      const err = messageError(error);
      emit({ type: "error", requestId, error: err });
      return post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTIONS,
        ok: false,
        requestId,
        error: err.message,
      });
    }
  }

  async function runHostCommand(
    command: string,
    payload: unknown,
    requestId: string | undefined,
    event: MessageEvent,
  ): Promise<unknown> {
    const handler =
      options.commands?.[command] ?? defaultAgentNativeHostCommands[command];
    if (!handler) {
      throw new Error(`No host command handler registered for "${command}"`);
    }
    return handler(
      {
        command,
        payload,
        requestId,
        origin: event.origin,
      },
      event,
    );
  }

  function needsApproval(action: AgentNativeClientAction): boolean {
    return (
      action.destructive === true ||
      action.requiresApproval === true ||
      typeof action.requiresApproval === "object" ||
      Boolean(action.approval)
    );
  }

  function approvalConfig(
    action: AgentNativeClientAction,
  ): AgentNativeClientActionApprovalConfig | undefined {
    if (action.approval) return action.approval;
    return typeof action.requiresApproval === "object"
      ? action.requiresApproval
      : undefined;
  }

  async function assertActionApproved(
    action: AgentNativeClientAction,
    args: unknown,
    context: AgentNativeHostContext,
    requestId: string | undefined,
    event: MessageEvent,
  ): Promise<void> {
    if (!needsApproval(action)) return;
    const manifest = toActionManifest(action);
    const response = await runHostCommand(
      "requestApproval",
      {
        action: manifest,
        args,
        context,
        session,
        approval: approvalConfig(action),
      },
      requestId,
      event,
    );
    const approved =
      response === true ||
      (isRecord(response) &&
        (response.approved === true || response.ok === true));
    if (!approved)
      throw new Error(`Client action "${action.name}" was not approved`);
  }

  async function handleAction(
    message: IncomingHostMessage,
    event: MessageEvent,
  ) {
    if (message.type !== AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION) return;
    const name = typeof message.name === "string" ? message.name : "";
    const requestId = message.requestId;
    const args = "args" in message ? message.args : message.payload;
    try {
      if (!name) throw new Error("Missing client action name");
      const action = await findClientAction(options.actions, name);
      if (!action) {
        throw new Error(`No client action registered for "${name}"`);
      }
      const context = attachSession(
        await resolveHostContext(options.getContext),
        session,
      );
      await assertActionApproved(action, args, context, requestId, event);
      emit({ type: "action", name, requestId, origin: event.origin });
      const result = await action.run(args, {
        requestId,
        origin: event.origin,
        context,
        session,
        event,
        refresh: (payload) =>
          runHostCommand("refreshData", payload, requestId, event),
        command: (command, payload) =>
          runHostCommand(command, payload, requestId, event),
      });
      post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
        ok: true,
        requestId,
        result: serializeForMessage(result, "Client action result"),
      });
    } catch (error) {
      const err = messageError(error);
      emit({ type: "error", requestId, error: err, origin: event.origin });
      post({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
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
      emit({ type: "command", command, requestId, origin: event.origin });
      const result = await runHostCommand(
        command,
        message.payload,
        requestId,
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
    } else if (message.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS) {
      void sendActions(message.requestId);
    } else if (message.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION) {
      void handleAction(message, event);
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
    sendActions,
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
      // targetWindow is non-null: the null branch returned early above
      if (!isTrustedHostResponse(event, targetWindow!, options.hostOrigin)) {
        return;
      }
      if (!isRecord(event.data)) return;
      if (event.data.type !== responseType) return;
      if (event.data.requestId !== id) return;

      const response = pick(event.data);
      if (response.ok === true) {
        finish(() => resolve(response.value));
      } else {
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

export function requestAgentNativeHostActions(
  options: AgentNativeHostRequestOptions = {},
): Promise<AgentNativeActionManifestEntry[]> {
  return requestFromHost(
    { type: AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS },
    AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTIONS,
    (message) => {
      if (message.ok === false) {
        return {
          ok: false,
          error: new Error(
            typeof message.error === "string"
              ? message.error
              : "Host actions request failed",
          ),
        };
      }
      return {
        ok: true,
        value: Array.isArray(message.actions)
          ? (message.actions as AgentNativeActionManifestEntry[])
          : [],
      };
    },
    options,
  );
}

export function runAgentNativeHostAction<TArgs = unknown, TResult = unknown>(
  name: string,
  args?: TArgs,
  options: AgentNativeHostRequestOptions = {},
): Promise<TResult> {
  return requestFromHost(
    {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION,
      name,
      args,
    },
    AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
    (message) => {
      if (message.ok === false) {
        return {
          ok: false,
          error: new Error(
            typeof message.error === "string"
              ? message.error
              : "Host action failed",
          ),
        };
      }
      return { ok: true, value: message.result as TResult };
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
  actions?: AgentNativeActionManifestEntry[];
  session?: AgentNativeHostSession;
  contextError?: string;
  authError?: string;
  actionsError?: string;
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
    // targetWindow is non-null: the null branch returned early above
    if (!isTrustedHostResponse(event, targetWindow!, options.hostOrigin)) {
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
      actions: Array.isArray(event.data.actions)
        ? (event.data.actions as AgentNativeActionManifestEntry[])
        : undefined,
      session: isRecord(event.data.session)
        ? (event.data.session as AgentNativeHostSession)
        : undefined,
      contextError:
        typeof event.data.contextError === "string"
          ? event.data.contextError
          : undefined,
      authError:
        typeof event.data.authError === "string"
          ? event.data.authError
          : undefined,
      actionsError:
        typeof event.data.actionsError === "string"
          ? event.data.actionsError
          : undefined,
    });
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
