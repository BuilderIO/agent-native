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
const AGENT_ENGINE_READINESS_PROBE_TIMEOUT_MS = 15_000;
const MAX_READINESS_STORES = 128;
const sourceIdentityTokens = new WeakMap<object, number>();
let nextSourceIdentityToken = 1;

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
  lastUsedAt: number;
  inFlight: Promise<AgentEngineConfiguredState> | null;
  revision: number;
  listeners: Map<() => void, ReadinessSubscriber>;
}

const stores = new Map<string, AgentEngineReadinessStore>();
const pendingRefreshStores = new Set<AgentEngineReadinessStore>();
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

function pruneIdleStores(now: number): void {
  for (const [key, store] of stores) {
    if (store.listeners.size > 0 || store.inFlight) continue;
    if (now - store.lastUsedAt >= AGENT_ENGINE_READINESS_TTL_MS) {
      stores.delete(key);
    }
  }

  if (stores.size <= MAX_READINESS_STORES) return;
  const idleStores = [...stores.entries()]
    .filter(([, store]) => store.listeners.size === 0 && !store.inFlight)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  for (const [key] of idleStores) {
    if (stores.size <= MAX_READINESS_STORES) break;
    stores.delete(key);
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

function sourceIdentityToken(value: object): number {
  let token = sourceIdentityTokens.get(value);
  if (token === undefined) {
    token = nextSourceIdentityToken++;
    sourceIdentityTokens.set(value, token);
  }
  return token;
}

function normalizedHeaderEntries(headers: HeadersInit): [string, string[]][] {
  const entries: [string, string][] = [];
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      entries.push([name.toLowerCase(), value.trim()]);
    }
  } else if (typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, name) => {
      entries.push([name.toLowerCase(), value.trim()]);
    });
  } else {
    for (const [name, value] of Object.entries(
      headers as Record<string, string>,
    )) {
      entries.push([name.toLowerCase(), value.trim()]);
    }
  }

  const valuesByName = new Map<string, string[]>();
  for (const [name, value] of entries) {
    const values = valuesByName.get(name) ?? [];
    values.push(value);
    valuesByName.set(name, values);
  }
  return [...valuesByName]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, values]) => [name, values]);
}

function readinessSourceKey(
  statusUrl: string,
  source?: AgentEngineReadinessSource,
): string {
  const fetcher = source?.fetch ?? globalThis.fetch;
  const fetcherKey =
    typeof fetcher === "function" ? sourceIdentityToken(fetcher) : null;
  const credentials = source?.credentials ?? "same-origin";
  let headersKey = "";
  if (typeof source?.headers === "function") {
    // A header factory may return caller-specific auth. Keep its stores
    // private to the source object even when the URL and fetcher are shared.
    headersKey = `factory:${sourceIdentityToken(source)}:${sourceIdentityToken(source.headers)}`;
  } else if (source?.headers) {
    try {
      headersKey = JSON.stringify(normalizedHeaderEntries(source.headers));
    } catch {
      headersKey = `headers:${sourceIdentityToken(source.headers as object)}`;
    }
  }
  return JSON.stringify([
    canonicalStatusUrl(statusUrl),
    fetcherKey,
    credentials,
    headersKey,
  ]);
}

export function agentEngineStatusUrlForChatApi(apiUrl?: string): string {
  if (!apiUrl) return agentNativePath(AGENT_ENGINE_STATUS_PATH);
  try {
    const base =
      typeof window === "undefined"
        ? "http://agent-native.invalid"
        : window.location.href;
    const chatUrl = new URL(apiUrl, base);
    const chatPathSuffix = "/agent-chat";
    if (chatUrl.pathname.endsWith(chatPathSuffix)) {
      chatUrl.pathname = `${chatUrl.pathname.slice(0, -chatPathSuffix.length)}/agent-engine/status`;
    } else {
      const internalChatPathIndex =
        chatUrl.pathname.lastIndexOf(CHAT_API_PATH_SUFFIX);
      chatUrl.pathname =
        internalChatPathIndex >= 0
          ? `${chatUrl.pathname.slice(0, internalChatPathIndex)}${AGENT_ENGINE_STATUS_PATH}`
          : agentNativePath(AGENT_ENGINE_STATUS_PATH);
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
  const now = Date.now();
  pruneIdleStores(now);
  const statusUrl =
    source?.statusUrl ?? agentNativePath(AGENT_ENGINE_STATUS_PATH);
  const key = readinessSourceKey(statusUrl, source);
  let store = stores.get(key);
  if (!store) {
    store = {
      key,
      statusUrl,
      ...(source ? { source } : {}),
      state: "unknown",
      resolvedAt: 0,
      lastUsedAt: now,
      inFlight: null,
      revision: 0,
      listeners: new Map(),
    };
    stores.set(key, store);
  } else if (source) {
    store.statusUrl = statusUrl;
    store.source = source;
  }
  store.lastUsedAt = now;
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
        if (
          typeof entry.tabId !== "string" &&
          typeof entry.threadId !== "string"
        ) {
          return true;
        }
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
  for (const store of matchingStores) pendingRefreshStores.add(store);
  if (invalidationQueued) return;
  invalidationQueued = true;
  queueMicrotask(() => {
    invalidationQueued = false;
    const storesToRefresh = [...pendingRefreshStores];
    pendingRefreshStores.clear();
    for (const store of storesToRefresh) {
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

const READINESS_DEADLINE_REACHED = Symbol("readiness-deadline-reached");

function remainingReadinessTime(
  deadline: number | undefined,
): number | undefined {
  return deadline === undefined
    ? undefined
    : Math.max(0, deadline - Date.now());
}

async function waitForReadinessDeadline<T>(
  request: Promise<T>,
  deadline: number | undefined,
): Promise<T | typeof READINESS_DEADLINE_REACHED> {
  const timeoutMs = remainingReadinessTime(deadline);
  if (timeoutMs === undefined) return request;
  if (timeoutMs === 0) return READINESS_DEADLINE_REACHED;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof READINESS_DEADLINE_REACHED>((resolve) => {
    timeoutId = setTimeout(
      () => resolve(READINESS_DEADLINE_REACHED),
      timeoutMs,
    );
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
  deadline: number | undefined,
) {
  const source = store.source;
  let headers: HeadersInit | undefined;
  if (typeof source?.headers === "function") {
    const resolvedHeaders = await waitForReadinessDeadline(
      Promise.resolve(source.headers()),
      deadline,
    );
    if (resolvedHeaders === READINESS_DEADLINE_REACHED) return null;
    headers = resolvedHeaders;
  } else {
    headers = source?.headers;
  }
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
  deadline: number | undefined,
  fresh: boolean,
): Promise<AgentEngineConfiguredState> {
  let requestOptions = await statusRequestOptions(store, fresh, deadline);
  let timeoutMs = remainingReadinessTime(deadline);
  if (!requestOptions || timeoutMs === 0) return "unavailable";

  let engineResult = await waitForStatus(
    fetchAgentEngineStatus(requestOptions),
    timeoutMs,
    store.statusUrl,
  );
  while (engineResult.state === "unavailable" && engineResult.stale) {
    requestOptions = await statusRequestOptions(store, false, deadline);
    timeoutMs = remainingReadinessTime(deadline);
    if (!requestOptions || timeoutMs === 0) return "unavailable";
    engineResult = await waitForStatus(
      fetchAgentEngineStatus(requestOptions),
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
  const callerTimeoutMs =
    typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
  const callerDeadline =
    callerTimeoutMs === undefined ? undefined : Date.now() + callerTimeoutMs;

  const waitForCaller = async (
    request: Promise<AgentEngineConfiguredState>,
  ): Promise<AgentEngineConfiguredState> => {
    const result = await waitForReadinessDeadline(request, callerDeadline);
    return result === READINESS_DEADLINE_REACHED ? "unavailable" : result;
  };

  if (
    !fresh &&
    (store.state === "configured" || store.state === "missing") &&
    Date.now() - store.resolvedAt < AGENT_ENGINE_READINESS_TTL_MS
  ) {
    return store.state;
  }
  if (store.inFlight) return waitForCaller(store.inFlight);

  const requestRevision = store.revision;
  const probeDeadline = Date.now() + AGENT_ENGINE_READINESS_PROBE_TIMEOUT_MS;
  const request = readStoreReadiness(store, probeDeadline, fresh)
    .catch(() => "unavailable" as const)
    .then((nextState) => {
      if (requestRevision !== store.revision) {
        if (store.inFlight === request) store.inFlight = null;
        return ensureStoreReadiness(store);
      }
      store.resolvedAt = Date.now();
      publish(store, nextState);
      return nextState;
    })
    .finally(() => {
      if (store.inFlight === request) store.inFlight = null;
    });
  store.inFlight = request;
  return waitForCaller(request);
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
  pendingRefreshStores.clear();
  invalidationQueued = false;
}

/** @internal Test assertion for bounded, idle readiness-store retention. */
export function getAgentEngineReadinessStoreCountForTests(): number {
  pruneIdleStores(Date.now());
  return stores.size;
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
