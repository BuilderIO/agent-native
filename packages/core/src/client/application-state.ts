import { agentNativePath } from "./api-path.js";
import { assertAgentNativeApiEnabled } from "./api-surface.js";
import {
  getBrowserTabId,
  isBrowserTabIdForCurrentDocument,
} from "./browser-tab-id.js";
import { recordStateWrite } from "./recorder.js";

const APP_STATE_KEY_PATTERN = /^[a-zA-Z0-9_:-]+$/;
const pendingMutations = new Map<string, Promise<void>>();
const mutationRevisions = new Map<string, number>();

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
  if (typeof window !== "undefined") {
    headers["X-Agent-Native-Browser-Tab"] = getBrowserTabId();
  }
  Object.assign(headers, requestSourceHeader(requestSource));
  return headers;
}

function requestSourceHeader(requestSource?: string): Record<string, string> {
  if (!requestSource) return {};
  return {
    "X-Request-Source": isBrowserTabIdForCurrentDocument(requestSource)
      ? getBrowserTabId()
      : requestSource,
  };
}

function browserTabHeaders(): Record<string, string> | undefined {
  return typeof window === "undefined"
    ? undefined
    : { "X-Agent-Native-Browser-Tab": getBrowserTabId() };
}

function requestKey(key: string): string {
  return `${typeof window === "undefined" ? "" : getBrowserTabId()}:${key}`;
}

export function isClientAppStateMutationPending(key: string): boolean {
  return pendingMutations.has(requestKey(key));
}

function runClientAppStateMutation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const id = requestKey(key);
  const previous = pendingMutations.get(id);
  // A later write must not fold into one queued before this mutation.
  queuedReplacements.delete(id);
  mutationRevisions.set(id, (mutationRevisions.get(id) ?? 0) + 1);
  const mutation = (async () => {
    if (previous) await previous;
    return operation();
  })();
  let pending!: Promise<void>;
  const clearPending = () => {
    if (pendingMutations.get(id) === pending) {
      pendingMutations.delete(id);
    }
  };
  pending = mutation.then(clearPending, clearPending);
  pendingMutations.set(id, pending);
  return mutation;
}

interface Replacement {
  method: "PUT" | "DELETE";
  body?: string | undefined;
  requestSource?: string | undefined;
  keepalive?: boolean | undefined;
}

interface QueuedReplacement {
  key: string;
  replacement: Replacement;
  started: boolean;
  sent: boolean;
  pending?: Promise<void> | undefined;
  result: Promise<unknown>;
  settle?: {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  };
}

// Screens rewrite the same key in bursts (a collection view settles its
// navigation state a dozen times as it loads) and several keys at once (a
// page switch writes navigation, selection and editor state together).
// Writes that start in the same tick go out as one request, and each key
// sends at most the write in flight and one more: a write made while another
// waits replaces the waiting one's value, and every caller gets the result of
// the latest. The server still ends on the latest value, as soon as the
// earlier write lands.
const queuedReplacements = new Map<string, QueuedReplacement>();
const inFlightReplacements = new Map<string, QueuedReplacement>();
let unsentReplacements: QueuedReplacement[] = [];
let replacementFlushTimer: ReturnType<typeof setTimeout> | undefined;
// An older server answers the batch route with 404 or 405; after that every
// write takes its own route again.
let batchWritesUnsupported = false;

// fetch rejects a keepalive request over 64 KB.
const KEEPALIVE_BODY_LIMIT = 60_000;
const MAX_BATCH_WRITES = 100;

function sameReplacement(a: Replacement, b: Replacement): boolean {
  return (
    a.method === b.method &&
    a.body === b.body &&
    a.requestSource === b.requestSource
  );
}

function mergeReplacement(
  id: string,
  target: QueuedReplacement,
  replacement: Replacement,
): Promise<unknown> {
  target.replacement = {
    ...replacement,
    keepalive: replacement.keepalive || target.replacement.keepalive,
  };
  mutationRevisions.set(id, (mutationRevisions.get(id) ?? 0) + 1);
  return target.result;
}

function replaceClientAppState(
  key: string,
  replacement: Replacement,
): Promise<unknown> {
  appStateUrl(key);
  const id = requestKey(key);
  const queued = queuedReplacements.get(id);
  if (queued) return mergeReplacement(id, queued, replacement);
  const inFlight = inFlightReplacements.get(id);
  if (inFlight && inFlight.pending === pendingMutations.get(id)) {
    // Not sent yet: it can still carry this value instead.
    if (!inFlight.sent) return mergeReplacement(id, inFlight, replacement);
    // The request on the wire already writes this, and nothing follows it.
    if (sameReplacement(inFlight.replacement, replacement)) {
      return inFlight.result;
    }
  }
  const entry = {
    key,
    replacement,
    started: false,
    sent: false,
  } as QueuedReplacement;
  entry.result = runClientAppStateMutation(key, () => {
    entry.started = true;
    if (queuedReplacements.get(id) === entry) queuedReplacements.delete(id);
    inFlightReplacements.set(id, entry);
    return new Promise<unknown>((resolve, reject) => {
      entry.settle = { resolve, reject };
      unsentReplacements.push(entry);
      flushWhenPageHides();
      replacementFlushTimer ??= setTimeout(flushReplacements, 0);
    }).finally(() => {
      if (inFlightReplacements.get(id) === entry) {
        inFlightReplacements.delete(id);
      }
    });
  });
  entry.pending = pendingMutations.get(id);
  if (!entry.started) queuedReplacements.set(id, entry);
  return entry.result;
}

// A page that is closing may not get to run the timer, so hiding the page
// sends the writes waiting for it at once. Writes marked keepalive are the ones
// meant to outlive the page, and the request carries the flag.
let flushOnHideInstalled = false;
function flushWhenPageHides(): void {
  if (
    flushOnHideInstalled ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof document === "undefined"
  ) {
    return;
  }
  flushOnHideInstalled = true;
  window.addEventListener("pagehide", flushReplacements);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushReplacements();
  });
}

function flushReplacements(): void {
  if (replacementFlushTimer !== undefined) clearTimeout(replacementFlushTimer);
  replacementFlushTimer = undefined;
  const entries = unsentReplacements;
  unsentReplacements = [];
  for (const entry of entries) entry.sent = true;
  for (let i = 0; i < entries.length; i += MAX_BATCH_WRITES) {
    const chunk = entries.slice(i, i + MAX_BATCH_WRITES);
    if (chunk.length === 1 || batchWritesUnsupported) {
      for (const entry of chunk) sendEach(entry);
    } else {
      void sendBatch(chunk);
    }
  }
}

function sendEach(entry: QueuedReplacement): void {
  void sendReplacement(entry.key, entry.replacement).then(
    entry.settle?.resolve,
    entry.settle?.reject,
  );
}

type BatchWriteResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

async function sendBatch(entries: QueuedReplacement[]): Promise<void> {
  const body = `{"writes":[${entries
    .map(({ key, replacement: { method, body, requestSource } }) => {
      const source = requestSourceHeader(requestSource)["X-Request-Source"];
      return `{"key":${JSON.stringify(key)}${
        method === "DELETE" ? `,"delete":true` : `,"value":${body}`
      }${source ? `,"requestSource":${JSON.stringify(source)}` : ""}}`;
    })
    .join(",")}]}`;
  const keepalive = entries.some((entry) => entry.replacement.keepalive);
  let results: BatchWriteResult[];
  try {
    const response = await fetch(
      agentNativePath("/_agent-native/application-state"),
      {
        method: "POST",
        headers: buildHeaders(),
        body,
        ...(keepalive
          ? { keepalive: body.length <= KEEPALIVE_BODY_LIMIT }
          : {}),
      },
    );
    const answered = response.ok
      ? await batchResults(response, entries.length)
      : undefined;
    // A server without the batch route answers 404 or 405, or hands the POST
    // to whatever serves unknown paths, which can answer 200 with a page.
    // Either way nothing was written, so the writes go one key at a time.
    if (
      response.status === 404 ||
      response.status === 405 ||
      (response.ok && !answered)
    ) {
      batchWritesUnsupported = true;
      for (const entry of entries) sendEach(entry);
      return;
    }
    results =
      answered ??
      (await parseAppStateResponse<never>(
        response,
        `Write application state [${entries.map(({ key }) => key).join(", ")}]`,
      ));
  } catch (error) {
    for (const entry of entries) entry.settle?.reject(error);
    return;
  }
  entries.forEach((entry, index) => {
    // batchResults checked there is one result per write.
    const result = results.at(index);
    if (!result) return;
    if (result.ok) {
      entry.settle?.resolve(result.value ?? null);
      return;
    }
    const error = new Error(
      `${entry.replacement.method === "PUT" ? "Write" : "Delete"} application state "${entry.key}" failed: ${result.error}`,
    );
    (error as { status?: number }).status = result.status;
    entry.settle?.reject(error);
  });
}

async function batchResults(
  response: Response,
  count: number,
): Promise<BatchWriteResult[] | undefined> {
  try {
    const parsed = JSON.parse(await response.text()) as {
      results?: unknown;
    } | null;
    return Array.isArray(parsed?.results) && parsed.results.length === count
      ? (parsed.results as BatchWriteResult[])
      : undefined;
  } catch {
    // coercion-ok: a body that isn't JSON is a server that doesn't know the
    // batch route; the caller sends the writes one key at a time instead.
    return undefined;
  }
}

// Leaves keepalive out of a request that didn't ask for it.
function keepaliveInit(keepalive: boolean | undefined): {
  keepalive?: boolean;
} {
  return keepalive === undefined ? {} : { keepalive };
}

async function sendReplacement(
  key: string,
  { method, body, requestSource, keepalive }: Replacement,
): Promise<unknown> {
  const response = await fetch(appStateUrl(key), {
    method,
    headers:
      method === "PUT"
        ? buildHeaders(requestSource)
        : {
            "X-Agent-Native-CSRF": "1",
            ...(browserTabHeaders() ?? {}),
            ...requestSourceHeader(requestSource),
          },
    ...(body === undefined ? {} : { body }),
    ...keepaliveInit(
      keepalive && (body?.length ?? 0) > KEEPALIVE_BODY_LIMIT
        ? false
        : keepalive,
    ),
  });
  return parseAppStateResponse<unknown>(
    response,
    method === "PUT"
      ? `Write application state "${key}"`
      : `Delete application state "${key}"`,
  );
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
      `${String(operation)} failed: response body could not be read: ${cause}`,
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
          `${String(operation)} returned a non-JSON ${response.status} response: ${raw.slice(
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
    const error = new Error(`${String(operation)} failed: ${String(message)}`);
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

export interface ClientAppStateBatch {
  values: Record<string, unknown>;
  missing: string[];
}

const MAX_BATCH_KEYS = 100;

export async function readClientAppStateMany(
  keys: readonly string[],
  options: ClientAppStateReadOptions = {},
): Promise<ClientAppStateBatch> {
  assertAgentNativeApiEnabled(`read application state [${keys.join(", ")}]`);
  const unique = [...new Set(keys)];
  for (const key of unique) appStateUrl(key);
  if (unique.length === 0) return { values: {}, missing: [] };

  while (true) {
    const revisions = new Map(
      unique.map((key) => {
        const id = requestKey(key);
        return [id, mutationRevisions.get(id) ?? 0] as const;
      }),
    );
    const pending = unique.flatMap((key) => {
      const mutation = pendingMutations.get(requestKey(key));
      return mutation ? [mutation] : [];
    });
    await awaitWithAbort(Promise.all(pending), options.signal);
    if (
      unique.some((key) => {
        const id = requestKey(key);
        return revisions.get(id) !== (mutationRevisions.get(id) ?? 0);
      })
    ) {
      continue;
    }
    const merged: ClientAppStateBatch = { values: {}, missing: [] };
    for (let i = 0; i < unique.length; i += MAX_BATCH_KEYS) {
      const chunk = unique.slice(i, i + MAX_BATCH_KEYS);
      const browserHeaders = browserTabHeaders();
      const url = `${agentNativePath("/_agent-native/application-state")}?keys=${chunk
        .map(encodeURIComponent)
        .join(",")}`;
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        ...(browserHeaders ? { headers: browserHeaders } : {}),
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
    if (
      unique.every((key) => {
        const id = requestKey(key);
        return revisions.get(id) === (mutationRevisions.get(id) ?? 0);
      })
    ) {
      return merged;
    }
  }
}

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
  appStateUrl(key);
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
  const write = options.signal
    ? runClientAppStateMutation(key, async () => {
        const response = await fetch(appStateUrl(key), {
          method: "PUT",
          headers: buildHeaders(options.requestSource),
          body: jsonBody(value),
          ...keepaliveInit(options.keepalive),
          signal: options.signal ?? null,
        });
        return parseAppStateResponse<T>(
          response,
          `Write application state "${key}"`,
        );
      })
    : (replaceClientAppState(key, {
        method: "PUT",
        body: jsonBody(value),
        requestSource: options.requestSource,
        keepalive: options.keepalive,
      }) as Promise<T>);
  recordStateWrite(key, value, write, options.signal);
  return write;
}

export async function compareAndSetClientAppState(
  key: string,
  expected: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
  options: ClientAppStateWriteOptions = {},
): Promise<boolean> {
  assertAgentNativeApiEnabled(`compare application state \"${key}\"`);
  return runClientAppStateMutation(key, async () => {
    const response = await fetch(appStateUrl(key), {
      method: "PATCH",
      headers: buildHeaders(options.requestSource),
      body: jsonBody({ expected, next }),
      keepalive: options.keepalive,
      signal: options.signal,
    });
    const result = await parseAppStateResponse<{ changed?: unknown }>(
      response,
      `Compare application state \"${key}\"`,
    );
    if (typeof result?.changed !== "boolean") {
      throw new Error(
        `Compare application state \"${key}\" returned an unexpected payload.`,
      );
    }
    return result.changed;
  });
}

export async function deleteClientAppState(
  key: string,
  options: ClientAppStateWriteOptions = {},
): Promise<void> {
  assertAgentNativeApiEnabled(`delete application state "${key}"`);
  const deletion = options.signal
    ? runClientAppStateMutation(key, async () => {
        const response = await fetch(appStateUrl(key), {
          method: "DELETE",
          headers: {
            "X-Agent-Native-CSRF": "1",
            ...(browserTabHeaders() ?? {}),
            ...requestSourceHeader(options.requestSource),
          },
          ...keepaliveInit(options.keepalive),
          signal: options.signal ?? null,
        });
        return parseAppStateResponse<unknown>(
          response,
          `Delete application state "${key}"`,
        );
      })
    : replaceClientAppState(key, {
        method: "DELETE",
        requestSource: options.requestSource,
        keepalive: options.keepalive,
      });
  recordStateWrite(key, undefined, deletion, options.signal);
  await deletion;
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
