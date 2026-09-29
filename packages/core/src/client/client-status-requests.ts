import { agentNativePath } from "./api-path.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";

export type ClientStatusResult<T> =
  | { state: "available"; value: T }
  | { state: "unavailable"; status?: number };

declare global {
  interface Window {
    __agentNativeSessionBootstrap?: Promise<ClientStatusResult<unknown>>;
  }
}

type CacheEntry = {
  expiresAt: number;
  result: ClientStatusResult<unknown>;
};

const RESULT_TTL_MS = 500;
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
const cache = new Map<string, CacheEntry>();
const requests = new Map<string, Promise<ClientStatusResult<unknown>>>();
const requestControllers = new Map<string, AbortController>();
const requestGenerations = new Map<string, number>();
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

function expireClientStatusCache(): void {
  statusGeneration += 1;
  const sessionUrl = agentNativePath(SESSION_STATUS_PATH);
  for (const url of cache.keys()) {
    if (url !== sessionUrl) cache.delete(url);
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
): Promise<ClientStatusResult<T>> {
  if (agentNativeApiDisabledReason()) return { state: "unavailable" };
  installInvalidationListeners();
  const url = agentNativePath(path);
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result as ClientStatusResult<T>;
  }
  cache.delete(url);

  const pending = requests.get(url);
  if (pending) return pending as Promise<ClientStatusResult<T>>;

  const sessionRead = path === SESSION_STATUS_PATH;
  const currentGeneration = () =>
    sessionRead ? sessionGeneration : statusGeneration;
  const requestGeneration = currentGeneration();
  const requestUrlGeneration = requestGenerations.get(url) ?? 0;
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
    fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
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
      if (
        currentGeneration() === requestGeneration &&
        (requestGenerations.get(url) ?? 0) === requestUrlGeneration &&
        result.state === "available"
      ) {
        cache.set(url, {
          expiresAt:
            Date.now() +
            (sessionRead && isSignedInSession(result.value)
              ? SESSION_RESULT_LIFETIME_MS
              : RESULT_TTL_MS),
          result,
        });
      }
      return result;
    })
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (requests.get(url) === request) requests.delete(url);
      if (requestControllers.get(url) === controller) {
        requestControllers.delete(url);
      }
    });

  requests.set(url, request);
  if (controller) requestControllers.set(url, controller);
  return request as Promise<ClientStatusResult<T>>;
}

export function invalidateClientStatusRequest(path: string): void {
  const url = agentNativePath(path);
  if (path === SESSION_STATUS_PATH && typeof window !== "undefined") {
    delete window.__agentNativeSessionBootstrap;
  }
  requestGenerations.set(url, (requestGenerations.get(url) ?? 0) + 1);
  cache.delete(url);
  requestControllers.get(url)?.abort();
  requestControllers.delete(url);
  requests.delete(url);
}

/**
 * Drop a cached result without aborting a read already in flight, so callers
 * refreshing on the same event share that read instead of starting another.
 */
export function expireClientStatusResult(path: string): void {
  cache.delete(agentNativePath(path));
}

export function invalidateClientStatusRequests(): void {
  statusGeneration += 1;
  sessionGeneration += 1;
  if (typeof window !== "undefined") {
    delete window.__agentNativeSessionBootstrap;
  }
  cache.clear();
  for (const controller of requestControllers.values()) {
    controller.abort();
  }
  requestControllers.clear();
  requests.clear();
}

export function fetchAgentEngineStatus<T = unknown>(): Promise<
  ClientStatusResult<T>
> {
  return fetchClientStatus<T>("/_agent-native/agent-engine/status");
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
