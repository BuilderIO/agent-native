import { agentNativePath } from "./api-path.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";

export type ClientStatusResult<T> =
  | { state: "available"; value: T }
  | { state: "unavailable"; status?: number; stale?: boolean };

declare global {
  interface Window {
    __agentNativeSessionBootstrap?: Promise<ClientStatusResult<unknown>>;
  }
}

type CacheEntry = {
  url: string;
  expiresAt: number;
  result: ClientStatusResult<unknown>;
};

interface ClientStatusRequestOptions {
  fresh?: boolean;
  url?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
}

const RESULT_TTL_MS = 500;
const AGENT_ENGINE_STATUS_TTL_MS = 10_000;
const MAX_STATUS_CACHE_ENTRIES = 128;
/**
 * One signed-in session answer serves the whole page load: the shell's
 * bootstrap read, analytics, and every `useSession` consumer share it for this
 * long. Focus and visibility do not expire it here; `use-session` decides when
 * a session must be re-read (logout, a peer tab's invalidation, a 401, a stale
 * answer). A signed-out answer keeps the short TTL, because signing in
 * elsewhere is exactly what the next focus should pick up.
 */
export const SESSION_RESULT_LIFETIME_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_STATUS_PATH = "/_agent-native/auth/session";
const AGENT_ENGINE_STATUS_PATH = "/_agent-native/agent-engine/status";
const cache = new Map<string, CacheEntry>();
const requests = new Map<string, Promise<ClientStatusResult<unknown>>>();
const requestUrls = new Map<string, string>();
const supersededRequests = new WeakSet<object>();
const freshRequests = new WeakSet<object>();
const requestControllers = new Map<string, AbortController>();
const requestSourceTokens = new WeakMap<object, number>();
let nextRequestSourceToken = 1;
let invalidationListenersInstalled = false;
// Endpoint statuses expire on focus and visibility; the session read only on
// a full invalidation, so it has its own generation.
let statusGeneration = 0;
let sessionGeneration = 0;

// Mirrors `use-session`: a body carrying `error` is a signed-out answer.
function isSignedInSession(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value as { error?: unknown }).error
  );
}

function statusCacheKey(url: string): string {
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

function requestSourceToken(value: object): number {
  let token = requestSourceTokens.get(value);
  if (token === undefined) {
    token = nextRequestSourceToken++;
    requestSourceTokens.set(value, token);
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

function headersCacheScope(headers: HeadersInit | undefined): string {
  if (headers === undefined) return "";
  try {
    return JSON.stringify(normalizedHeaderEntries(headers));
  } catch {
    return `identity:${requestSourceToken(headers as object)}`;
  }
}

function statusRequestKey(
  url: string,
  options?: ClientStatusRequestOptions,
): string {
  const fetcher = options?.fetch ?? globalThis.fetch;
  const fetcherToken =
    typeof fetcher === "function" ? requestSourceToken(fetcher) : null;
  return JSON.stringify([
    url,
    fetcherToken,
    options?.credentials ?? "same-origin",
    headersCacheScope(options?.headers),
  ]);
}

function pruneExpiredStatusCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size <= MAX_STATUS_CACHE_ENTRIES) return;
  const oldestEntries = [...cache.entries()].sort(
    (left, right) => left[1].expiresAt - right[1].expiresAt,
  );
  for (const [key] of oldestEntries) {
    if (cache.size <= MAX_STATUS_CACHE_ENTRIES) break;
    cache.delete(key);
  }
}

function expireClientStatusCache(): void {
  statusGeneration += 1;
  const sessionUrl = statusCacheKey(agentNativePath(SESSION_STATUS_PATH));
  const engineStatusUrl = statusCacheKey(
    agentNativePath(AGENT_ENGINE_STATUS_PATH),
  );
  for (const [key, entry] of cache) {
    if (entry.url !== sessionUrl && entry.url !== engineStatusUrl) {
      cache.delete(key);
    }
  }
}

function installInvalidationListeners(): void {
  if (
    invalidationListenersInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  invalidationListenersInstalled = true;

  if (typeof window.addEventListener === "function") {
    window.addEventListener("focus", expireClientStatusCache);
    window.addEventListener(
      "agent-engine:configured-changed",
      invalidateClientStatusRequests,
    );
    window.addEventListener("agent-native:tool-done", (event) => {
      const detail = (
        event as CustomEvent<{
          tool?: unknown;
          isError?: unknown;
          completedSideEffect?: unknown;
        }>
      ).detail;
      if (
        detail?.tool === "manage-agent-engine" &&
        detail.completedSideEffect === true &&
        detail.isError !== true
      ) {
        window.dispatchEvent(new Event("agent-engine:configured-changed"));
      }
    });
  }
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        expireClientStatusCache();
      }
    });
  }
}

async function fetchClientStatus<T>(
  path: string,
  options?: ClientStatusRequestOptions,
): Promise<ClientStatusResult<T>> {
  if (agentNativeApiDisabledReason()) return { state: "unavailable" };
  installInvalidationListeners();
  const url = options?.url ?? agentNativePath(path);
  const canonicalUrl = statusCacheKey(url);
  const key = statusRequestKey(canonicalUrl, options);
  pruneExpiredStatusCache(Date.now());
  const cached = cache.get(key);
  if (!options?.fresh && cached && cached.expiresAt > Date.now()) {
    return cached.result as ClientStatusResult<T>;
  }
  cache.delete(key);

  const pending = requests.get(key);
  if (pending && options?.fresh && freshRequests.has(pending)) {
    return pending as Promise<ClientStatusResult<T>>;
  }
  if (pending && !options?.fresh) {
    return pending as Promise<ClientStatusResult<T>>;
  }
  if (options?.fresh) {
    if (pending) supersededRequests.add(pending);
  }

  const sessionRead = path === SESSION_STATUS_PATH;
  const currentGeneration = () =>
    sessionRead ? sessionGeneration : statusGeneration;
  const requestGeneration = currentGeneration();
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ClientStatusResult<unknown>>((resolve) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      resolve({ state: "unavailable" });
    }, REQUEST_TIMEOUT_MS);
  });
  const bootstrappedSession =
    sessionRead && typeof window !== "undefined"
      ? window.__agentNativeSessionBootstrap
      : undefined;
  if (bootstrappedSession) delete window.__agentNativeSessionBootstrap;
  const transport =
    bootstrappedSession ??
    (options?.fetch ?? fetch)(url, {
      cache: "no-store",
      credentials: options?.credentials ?? "same-origin",
      ...(options?.headers ? { headers: options.headers } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    })
      .then(async (response): Promise<ClientStatusResult<unknown>> => {
        if (!response.ok) {
          return { state: "unavailable", status: response.status };
        }
        try {
          return { state: "available", value: await response.json() };
        } catch {
          return { state: "unavailable", status: response.status };
        }
      })
      .catch((): ClientStatusResult<unknown> => ({ state: "unavailable" }));
  const request = Promise.race([transport, timeout])
    .then((result) => {
      if (supersededRequests.has(request)) {
        return fetchClientStatus<T>(path, options);
      }
      if (
        currentGeneration() === requestGeneration &&
        result.state === "available"
      ) {
        cache.set(key, {
          url: canonicalUrl,
          expiresAt:
            Date.now() +
            (sessionRead && isSignedInSession(result.value)
              ? SESSION_RESULT_LIFETIME_MS
              : path === AGENT_ENGINE_STATUS_PATH
                ? AGENT_ENGINE_STATUS_TTL_MS
                : RESULT_TTL_MS),
          result,
        });
        pruneExpiredStatusCache(Date.now());
      }
      return result;
    })
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (requests.get(key) === request) {
        requests.delete(key);
        requestUrls.delete(key);
      }
      if (requestControllers.get(key) === controller) {
        requestControllers.delete(key);
      }
    });

  requests.set(key, request);
  requestUrls.set(key, canonicalUrl);
  if (options?.fresh) freshRequests.add(request);
  if (controller) requestControllers.set(key, controller);
  return request as Promise<ClientStatusResult<T>>;
}

export function invalidateClientStatusRequest(path: string): void {
  const url = agentNativePath(path);
  const canonicalUrl = statusCacheKey(url);
  if (path === SESSION_STATUS_PATH && typeof window !== "undefined") {
    delete window.__agentNativeSessionBootstrap;
  }
  for (const [key, entry] of cache) {
    if (entry.url === canonicalUrl) cache.delete(key);
  }
  for (const [key, requestUrl] of requestUrls) {
    if (requestUrl !== canonicalUrl) continue;
    const pending = requests.get(key);
    if (pending) supersededRequests.add(pending);
    requestControllers.get(key)?.abort();
    requestControllers.delete(key);
    requests.delete(key);
    requestUrls.delete(key);
  }
}

/**
 * Drop a cached result without aborting a read already in flight, so callers
 * refreshing on the same event share that read instead of starting another.
 */
export function expireClientStatusResult(path: string): void {
  const url = statusCacheKey(agentNativePath(path));
  for (const [key, entry] of cache) {
    if (entry.url === url) cache.delete(key);
  }
}

export function invalidateClientStatusRequests(): void {
  statusGeneration += 1;
  sessionGeneration += 1;
  if (typeof window !== "undefined") {
    delete window.__agentNativeSessionBootstrap;
  }
  cache.clear();
  // Callers already awaiting an aborted read get a new read, not a result
  // indistinguishable from an unreachable server.
  for (const pending of requests.values()) supersededRequests.add(pending);
  for (const controller of requestControllers.values()) {
    controller.abort();
  }
  requestControllers.clear();
  requests.clear();
  requestUrls.clear();
}

export function fetchAgentEngineStatus<T = unknown>(options?: {
  fresh?: boolean;
  url?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
}): Promise<ClientStatusResult<T>> {
  return fetchClientStatus<T>("/_agent-native/agent-engine/status", options);
}

export function fetchEnvironmentStatus<T = unknown>(): Promise<
  ClientStatusResult<T>
> {
  return fetchClientStatus<T>("/_agent-native/env-status");
}

export function fetchBuilderStatus<T = unknown>(): Promise<
  ClientStatusResult<T>
> {
  return fetchClientStatus<T>("/_agent-native/builder/status");
}

export function fetchFileUploadStatus<T = unknown>(): Promise<
  ClientStatusResult<T>
> {
  return fetchClientStatus<T>("/_agent-native/file-upload/status");
}

export function fetchAuthSessionStatus<T = unknown>(): Promise<
  ClientStatusResult<T>
> {
  return fetchClientStatus<T>(SESSION_STATUS_PATH);
}
