import { agentNativePath } from "./api-path.js";
import {
  fetchAgentEngineStatus,
  invalidateClientStatusRequest,
  type ClientStatusResult,
} from "./client-status-requests.js";

export type AgentEngineConfiguredState =
  | "unknown"
  | "configured"
  | "missing"
  | "unavailable";

export interface AgentEngineReadinessSource {
  /** The status route belonging to the chat transport being guarded. */
  statusUrl?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
}

export interface FetchAgentEngineConfiguredStateOptions {
  /** Kept for API compatibility; readiness always comes from chatEligible. */
  missingFallback?: boolean;
  /** Skips the recent-answer TTL; still joins any probe already in flight. */
  fresh?: boolean;
  timeoutMs?: number;
  source?: AgentEngineReadinessSource;
}

export const AGENT_CHAT_AI_SETUP_REQUIRED_CODE =
  "AGENT_CHAT_AI_SETUP_REQUIRED" as const;

export const LOCAL_RUNTIME_ENGINE_IDS = [
  "codex-cli",
  "claude-cli",
  "pi-cli",
  "opencode-cli",
] as const;

const LOCAL_RUNTIME_ENGINES = new Set<string>(LOCAL_RUNTIME_ENGINE_IDS);
const AGENT_ENGINE_STATUS_PATH = "/_agent-native/agent-engine/status";
const CHAT_API_PATH_SUFFIX = "/_agent-native/agent-chat";
const AGENT_ENGINE_READINESS_TTL_MS = 10_000;

interface ReadinessSubscriber {
  listener: () => void;
  enabled: boolean;
  tabId?: string | null;
  threadId?: string | null;
}

interface AgentEngineReadinessStore {
  key: string;
  statusUrl: string;
  source?: AgentEngineReadinessSource;
  state: AgentEngineConfiguredState;
  resolvedAt: number;
  inFlight: Promise<AgentEngineConfiguredState> | null;
  revision: number;
  listeners: Map<() => void, ReadinessSubscriber>;
}

const stores = new Map<string, AgentEngineReadinessStore>();
let eventsInstalled = false;
let invalidationQueued = false;

export class AgentChatAiSetupRequiredError extends Error {
  readonly code = AGENT_CHAT_AI_SETUP_REQUIRED_CODE;

  constructor(readonly state: "missing" | "unavailable") {
    super(
      state === "missing"
        ? "Use Builder.io or a provider API key before chatting."
        : "Could not verify saved AI connections. Try again shortly.",
    );
    this.name = "AgentChatAiSetupRequiredError";
  }
}

function canonicalStatusUrl(url: string): string {
  try {
    const base =
      typeof window === "undefined"
        ? "http://agent-native.invalid"
        : window.location.href;
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function agentEngineStatusUrlForChatApi(apiUrl?: string): string {
  if (!apiUrl) return agentNativePath(AGENT_ENGINE_STATUS_PATH);
  try {
    const base =
      typeof window === "undefined"
        ? "http://agent-native.invalid"
        : window.location.href;
    const chatUrl = new URL(apiUrl, base);
    const chatPathIndex = chatUrl.pathname.lastIndexOf(CHAT_API_PATH_SUFFIX);
    if (chatPathIndex >= 0) {
      chatUrl.pathname = `${chatUrl.pathname.slice(0, chatPathIndex)}${AGENT_ENGINE_STATUS_PATH}`;
    } else {
      chatUrl.pathname = AGENT_ENGINE_STATUS_PATH;
    }
    chatUrl.search = "";
    chatUrl.hash = "";
    return apiUrl.startsWith("/") ? chatUrl.pathname : chatUrl.toString();
  } catch {
    return agentNativePath(AGENT_ENGINE_STATUS_PATH);
  }
}

function storeFor(
  source?: AgentEngineReadinessSource,
): AgentEngineReadinessStore {
  const statusUrl =
    source?.statusUrl ?? agentNativePath(AGENT_ENGINE_STATUS_PATH);
  const key = canonicalStatusUrl(statusUrl);
  let store = stores.get(key);
  if (!store) {
    store = {
      key,
      statusUrl,
      ...(source ? { source } : {}),
      state: "unknown",
      resolvedAt: 0,
      inFlight: null,
      revision: 0,
      listeners: new Map(),
    };
    stores.set(key, store);
  } else if (source) {
    store.statusUrl = statusUrl;
    store.source = source;
  }
  return store;
}

function publish(
  store: AgentEngineReadinessStore,
  nextState: AgentEngineConfiguredState,
): void {
  if (store.state === nextState) return;
  store.state = nextState;
  for (const listener of store.listeners.keys()) listener();
}

function refreshStores(scope?: { tabId?: unknown; threadId?: unknown }): void {
  const hasScope =
    typeof scope?.tabId === "string" || typeof scope?.threadId === "string";
  const matchingStores = [...stores.values()].filter((store) => {
    const hasInterestedSubscriber = [...store.listeners.values()].some(
      (entry) => {
        if (!entry.enabled) return false;
        if (!hasScope) return true;
        return (
          (typeof scope?.tabId !== "string" || entry.tabId === scope.tabId) &&
          (typeof scope?.threadId !== "string" ||
            entry.threadId === scope.threadId)
        );
      },
    );
    return hasInterestedSubscriber;
  });
  if (matchingStores.length === 0) return;
  if (invalidationQueued) return;
  invalidationQueued = true;
  queueMicrotask(() => {
    invalidationQueued = false;
    for (const store of matchingStores) {
      invalidateStore(store);
      void ensureStoreReadiness(store, { fresh: true });
    }
  });
}

function installInvalidationEvents(): void {
  if (eventsInstalled || typeof window === "undefined") return;
  eventsInstalled = true;
  window.addEventListener("agent-engine:configured-changed", () => {
    for (const store of stores.values()) invalidateStore(store);
    refreshStores();
  });
  // A failed key can be stale or scoped to one provider. Recheck authoritative
  // chat eligibility before disabling every composer in the app.
  window.addEventListener("agent-chat:missing-api-key", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    refreshStores(
      typeof detail === "object" && detail !== null
        ? (detail as { tabId?: unknown; threadId?: unknown })
        : undefined,
    );
  });
}

async function waitForStatus<T>(
  request: Promise<ClientStatusResult<T>>,
  timeoutMs: number | undefined,
  statusUrl: string,
): Promise<ClientStatusResult<T>> {
  if (timeoutMs === undefined) return request;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ClientStatusResult<T>>((resolve) => {
    timeoutId = setTimeout(() => {
      invalidateClientStatusRequest(statusUrl);
      resolve({ state: "unavailable" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function hasChatEligibleFlag(
  value: unknown,
): value is { chatEligible: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "chatEligible" in value &&
    typeof (value as { chatEligible?: unknown }).chatEligible === "boolean"
  );
}

async function statusRequestOptions(
  store: AgentEngineReadinessStore,
  fresh: boolean,
) {
  const source = store.source;
  const headers =
    typeof source?.headers === "function"
      ? await source.headers()
      : source?.headers;
  return {
    fresh,
    url: store.statusUrl,
    ...(source?.fetch ? { fetch: source.fetch } : {}),
    ...(headers ? { headers } : {}),
    ...(source?.credentials ? { credentials: source.credentials } : {}),
  };
}

async function readStoreReadiness(
  store: AgentEngineReadinessStore,
  timeoutMs: number | undefined,
  fresh: boolean,
): Promise<AgentEngineConfiguredState> {
  let engineResult = await waitForStatus(
    fetchAgentEngineStatus(await statusRequestOptions(store, fresh)),
    timeoutMs,
    store.statusUrl,
  );
  while (engineResult.state === "unavailable" && engineResult.stale) {
    engineResult = await waitForStatus(
      fetchAgentEngineStatus(await statusRequestOptions(store, false)),
      timeoutMs,
      store.statusUrl,
    );
  }
  if (
    engineResult.state !== "available" ||
    !hasChatEligibleFlag(engineResult.value)
  ) {
    return "unavailable";
  }
  return engineResult.value.chatEligible ? "configured" : "missing";
}

export function getAgentEngineReadiness(
  source?: AgentEngineReadinessSource,
): AgentEngineConfiguredState {
  installInvalidationEvents();
  return storeFor(source).state;
}

export function subscribeAgentEngineReadiness(
  listener: () => void,
  options?: {
    enabled?: boolean;
    tabId?: string | null;
    threadId?: string | null;
    source?: AgentEngineReadinessSource;
  },
): () => void {
  installInvalidationEvents();
  const store = storeFor(options?.source);
  store.listeners.set(listener, {
    listener,
    enabled: options?.enabled !== false,
    tabId: options?.tabId,
    threadId: options?.threadId,
  });
  return () => store.listeners.delete(listener);
}

function invalidateStore(store: AgentEngineReadinessStore): void {
  store.revision += 1;
  store.resolvedAt = 0;
  store.inFlight = null;
  invalidateClientStatusRequest(store.statusUrl);
}

/** A key save/connect/disconnect can make the cached authoritative answer stale. */
export function invalidateAgentEngineReadiness(
  source?: AgentEngineReadinessSource,
): void {
  if (source) {
    invalidateStore(storeFor(source));
    return;
  }
  if (stores.size === 0) storeFor();
  for (const store of stores.values()) invalidateStore(store);
}

async function ensureStoreReadiness(
  store: AgentEngineReadinessStore,
  options?: { fresh?: boolean; timeoutMs?: number },
): Promise<AgentEngineConfiguredState> {
  const fresh = options?.fresh === true;
  if (
    !fresh &&
    (store.state === "configured" || store.state === "missing") &&
    Date.now() - store.resolvedAt < AGENT_ENGINE_READINESS_TTL_MS
  ) {
    return store.state;
  }
  if (store.inFlight) return store.inFlight;

  const requestRevision = store.revision;
  const timeoutMs =
    typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
  const request = readStoreReadiness(store, timeoutMs, fresh)
    .catch(() => "unavailable" as const)
    .then((nextState) => {
      if (requestRevision !== store.revision) {
        return ensureStoreReadiness(store, { timeoutMs });
      }
      store.resolvedAt = Date.now();
      publish(store, nextState);
      return nextState;
    })
    .finally(() => {
      if (store.inFlight === request) store.inFlight = null;
    });
  store.inFlight = request;
  return request;
}

export async function ensureAgentEngineReadiness(options?: {
  fresh?: boolean;
  timeoutMs?: number;
  source?: AgentEngineReadinessSource;
}): Promise<AgentEngineConfiguredState> {
  installInvalidationEvents();
  return ensureStoreReadiness(storeFor(options?.source), options);
}

export async function fetchAgentEngineConfiguredState(
  enabled = true,
  options?: FetchAgentEngineConfiguredStateOptions,
): Promise<AgentEngineConfiguredState> {
  if (!enabled) return "configured";
  return ensureAgentEngineReadiness(options);
}

export function isLocalRuntimeEngine(engine?: string): boolean {
  return engine !== undefined && LOCAL_RUNTIME_ENGINES.has(engine);
}

export async function requireAgentEngineConfiguredForDispatch(options?: {
  engine?: string;
  fresh?: boolean;
  timeoutMs?: number;
  source?: AgentEngineReadinessSource;
}): Promise<void> {
  if (isLocalRuntimeEngine(options?.engine)) return;
  const readiness = await ensureAgentEngineReadiness({
    fresh: options?.fresh,
    timeoutMs: options?.timeoutMs ?? 10_000,
    source: options?.source,
  });
  if (readiness === "configured") return;
  throw new AgentChatAiSetupRequiredError(
    readiness === "missing" ? "missing" : "unavailable",
  );
}

/** @internal Test isolation for the shared module store. */
export function resetAgentEngineReadinessForTests(): void {
  for (const store of stores.values()) {
    store.revision += 1;
    invalidateClientStatusRequest(store.statusUrl);
  }
  stores.clear();
  invalidationQueued = false;
}

export function isAgentChatAiSetupRequiredError(
  error: unknown,
): error is AgentChatAiSetupRequiredError {
  return (
    error instanceof AgentChatAiSetupRequiredError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === AGENT_CHAT_AI_SETUP_REQUIRED_CODE)
  );
}
