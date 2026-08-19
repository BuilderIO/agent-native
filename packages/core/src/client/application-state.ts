import { agentNativePath } from "./api-path.js";
import { assertAgentNativeApiEnabled } from "./api-surface.js";

const APP_STATE_KEY_PATTERN = /^[a-zA-Z0-9_:-]+$/;

export interface ClientAppStateReadOptions {
  signal?: AbortSignal;
}

export interface ClientAppStateWriteOptions {
  keepalive?: boolean;
  requestSource?: string;
  signal?: AbortSignal;
}

function appStateUrl(key: string): string {
  if (!APP_STATE_KEY_PATTERN.test(key)) {
    throw new TypeError(
      "Application state keys may only contain letters, numbers, underscores, hyphens, and colons.",
    );
  }
  return agentNativePath(`/_agent-native/application-state/${key}`);
}

function buildHeaders(requestSource?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (requestSource) headers["X-Request-Source"] = requestSource;
  return headers;
}

async function parseAppStateResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  let raw = "";
  try {
    raw = await response.text();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const error = new Error(
      `${operation} failed: response body could not be read: ${cause}`,
    );
    (error as { status?: number }).status = response.status;
    throw error;
  }

  let data: unknown = undefined;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (response.ok) {
        const error = new Error(
          `${operation} returned a non-JSON ${response.status} response: ${raw.slice(
            0,
            200,
          )}`,
        );
        (error as { status?: number }).status = response.status;
        throw error;
      }
    }
  }

  if (!response.ok) {
    const message =
      (data &&
        typeof data === "object" &&
        ("error" in data || "message" in data) &&
        String(
          (data as { error?: unknown; message?: unknown }).error ??
            (data as { error?: unknown; message?: unknown }).message,
        )) ||
      raw.slice(0, 200) ||
      response.statusText ||
      `HTTP ${response.status}`;
    const error = new Error(`${operation} failed: ${message}`);
    (error as { status?: number }).status = response.status;
    throw error;
  }

  return (data ?? null) as T;
}

function jsonBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (body === undefined) {
    throw new TypeError(
      "Application state values must be JSON-serializable. Use deleteClientAppState or setClientAppState with undefined to clear a key.",
    );
  }
  return body;
}

/**
 * Result of a batched read. `values` holds only the keys the server has a row
 * for; every other requested key is in `missing`. A key stored with a `null`
 * value lands in `values` with `null` and NOT in `missing` — that is how
 * "never written" stays distinguishable from "written as null/empty".
 */
export interface ClientAppStateBatch {
  values: Record<string, unknown>;
  missing: string[];
}

/** Server caps a batch at 100 keys; stay under it when splitting. */
const MAX_BATCH_KEYS = 100;

export async function readClientAppStateMany(
  keys: readonly string[],
  options: ClientAppStateReadOptions = {},
): Promise<ClientAppStateBatch> {
  assertAgentNativeApiEnabled(`read application state [${keys.join(", ")}]`);
  const unique = [...new Set(keys)];
  for (const key of unique) appStateUrl(key); // validates the key shape
  if (unique.length === 0) return { values: {}, missing: [] };

  const merged: ClientAppStateBatch = { values: {}, missing: [] };
  for (let i = 0; i < unique.length; i += MAX_BATCH_KEYS) {
    const chunk = unique.slice(i, i + MAX_BATCH_KEYS);
    const url = `${agentNativePath("/_agent-native/application-state")}?keys=${chunk
      .map(encodeURIComponent)
      .join(",")}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: options.signal,
    });
    const batch = await parseAppStateResponse<ClientAppStateBatch | null>(
      response,
      `Read application state [${chunk.join(", ")}]`,
    );
    if (!batch || typeof batch !== "object" || !batch.values) {
      throw new Error(
        `Read application state [${chunk.join(", ")}] returned an unexpected payload.`,
      );
    }
    Object.assign(merged.values, batch.values);
    merged.missing.push(...(batch.missing ?? []));
  }
  return merged;
}

// Reads issued in the same tick are coalesced into one batched request. Every
// mounted composer, question card and suggestion hook reads its own key on
// mount, which used to be one HTTP request (and one full identity resolution)
// each — ~55 on an analytics dashboard load.
let pendingBatch:
  | { keys: Set<string>; promise: Promise<ClientAppStateBatch> }
  | undefined;

function scheduleBatchedRead(key: string): Promise<ClientAppStateBatch> {
  if (pendingBatch) {
    pendingBatch.keys.add(key);
    return pendingBatch.promise;
  }
  const keys = new Set([key]);
  const promise = new Promise<ClientAppStateBatch>((resolve, reject) => {
    setTimeout(() => {
      pendingBatch = undefined;
      readClientAppStateMany([...keys]).then(resolve, reject);
    }, 0);
  });
  pendingBatch = { keys, promise };
  return promise;
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  const abortReason = () =>
    signal.reason ?? new Error("The operation was aborted");
  if (signal.aborted) return Promise.reject(abortReason());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        if (signal.aborted) reject(abortReason());
        else resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function readClientAppState<T = unknown>(
  key: string,
  options: ClientAppStateReadOptions = {},
): Promise<T | null> {
  appStateUrl(key); // validates the key shape before it joins a batch
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Aborted");
  }
  const batch = await awaitWithAbort(scheduleBatchedRead(key), options.signal);
  return (batch.values[key] ?? null) as T | null;
}

export async function writeClientAppState<T = unknown>(
  key: string,
  value: T,
  options: ClientAppStateWriteOptions = {},
): Promise<T> {
  assertAgentNativeApiEnabled(`write application state "${key}"`);
  const response = await fetch(appStateUrl(key), {
    method: "PUT",
    headers: buildHeaders(options.requestSource),
    body: jsonBody(value),
    keepalive: options.keepalive,
    signal: options.signal,
  });
  return parseAppStateResponse<T>(response, `Write application state "${key}"`);
}

export async function deleteClientAppState(
  key: string,
  options: ClientAppStateWriteOptions = {},
): Promise<void> {
  assertAgentNativeApiEnabled(`delete application state "${key}"`);
  const response = await fetch(appStateUrl(key), {
    method: "DELETE",
    // DELETE carries no JSON body, so this custom header is the only
    // same-origin marker the CSRF check can see from an embedded frame.
    headers: {
      "X-Agent-Native-CSRF": "1",
      ...(options.requestSource
        ? { "X-Request-Source": options.requestSource }
        : {}),
    },
    keepalive: options.keepalive,
    signal: options.signal,
  });
  await parseAppStateResponse<unknown>(
    response,
    `Delete application state "${key}"`,
  );
}

export async function setClientAppState<T = unknown>(
  key: string,
  value: T | null | undefined,
  options: ClientAppStateWriteOptions = {},
): Promise<T | null> {
  if (value === null || value === undefined) {
    await deleteClientAppState(key, options);
    return null;
  }
  return writeClientAppState(key, value, options);
}
