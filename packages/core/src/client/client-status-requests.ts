import { agentNativePath } from "./api-path.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";

export type ClientStatusResult<T> =
  | { state: "available"; value: T }
  | { state: "unavailable"; status?: number };

type CacheEntry = {
  expiresAt: number;
  result: ClientStatusResult<unknown>;
};

const RESULT_TTL_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const cache = new Map<string, CacheEntry>();
const requests = new Map<string, Promise<ClientStatusResult<unknown>>>();
const requestControllers = new Map<string, AbortController>();
const requestGenerations = new Map<string, number>();
let invalidationListenersInstalled = false;
let generation = 0;

function expireClientStatusCache(): void {
  generation += 1;
  cache.clear();
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
  // "unavailable" rather than a fabricated payload: callers already treat it as
  // "could not read", and there is genuinely nothing to read here.
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

  const requestGeneration = generation;
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
  const transport = fetch(url, {
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
        generation === requestGeneration &&
        (requestGenerations.get(url) ?? 0) === requestUrlGeneration &&
        result.state === "available"
      ) {
        cache.set(url, {
          expiresAt: Date.now() + RESULT_TTL_MS,
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
  requestGenerations.set(url, (requestGenerations.get(url) ?? 0) + 1);
  cache.delete(url);
  requestControllers.get(url)?.abort();
  requestControllers.delete(url);
  requests.delete(url);
}

export function invalidateClientStatusRequests(): void {
  generation += 1;
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

export function fetchAuthSessionStatus<T = unknown>(): Promise<
  ClientStatusResult<T>
> {
  return fetchClientStatus<T>("/_agent-native/auth/session");
}
