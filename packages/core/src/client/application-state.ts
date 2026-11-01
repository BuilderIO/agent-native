import {
  APP_STATE_BATCH_ROUTE_HEADER,
  TAB_SCOPED_APP_STATE_KEYS,
} from "../shared/app-state-routes.js";
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

// Identifies the server row a key reaches, so writes and reads through
// `navigation` and through `navigation:<this tab>` wait on each other.
function requestKey(key: string): string {
  if (typeof window === "undefined") return `:${key}`;
  const tab = getBrowserTabId();
  return `${tab}:${TAB_SCOPED_APP_STATE_KEYS.has(key) ? `${key}:${tab}` : key}`;
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
  /** Whether the request on the wire actually carries keepalive. */
  sentKeepalive: boolean;
  pending?: Promise<void> | undefined;
  result: Promise<unknown>;
  running?: Promise<unknown>;
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
// Set once a server shows it has no batch route; every write then takes its
// own route again until the page reloads.
let batchWritesUnsupported = false;

// Browsers refuse a keepalive request once the keepalive bodies in flight
// from the page pass 64 KiB, counted in encoded bytes. Keepalive requests
// from this module claim their bytes until they finish, and a request that
// doesn't fit goes without keepalive rather than fail.
const KEEPALIVE_BYTE_BUDGET = 64 * 1024;
const MAX_BATCH_WRITES = 100;
let keepaliveBytesInFlight = 0;

function encodedLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function claimKeepalive(body: string | undefined): (() => void) | undefined {
  const bytes = encodedLength(body ?? "");
  if (keepaliveBytesInFlight + bytes > KEEPALIVE_BYTE_BUDGET) return undefined;
  keepaliveBytesInFlight += bytes;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keepaliveBytesInFlight -= bytes;
  };
}

/**
 * The keepalive part of a request's init: omitted when the caller didn't ask,
 * and false when the budget has no room for this body.
 */
function keepaliveRequest(
  wanted: boolean | undefined,
  body: string | undefined,
): { init: { keepalive?: boolean }; release: () => void } {
  const none = () => {};
  if (wanted === undefined) return { init: {}, release: none };
  const release = wanted ? claimKeepalive(body) : undefined;
  return release
    ? { init: { keepalive: true }, release }
    : { init: { keepalive: false }, release: none };
}

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
    // The request on the wire already writes this, and nothing follows it,
    // as long as it also survives the page when this caller needs that.
    if (
      sameReplacement(inFlight.replacement, replacement) &&
      (inFlight.sentKeepalive || !wantsKeepalive(replacement))
    ) {
      return inFlight.result;
    }
  }
  const entry = {
    key,
    replacement,
    started: false,
    sent: false,
    sentKeepalive: false,
  } as QueuedReplacement;
  entry.result = runClientAppStateMutation(key, () => startReplacement(entry));
  entry.pending = pendingMutations.get(id);
  if (!entry.started) queuedReplacements.set(id, entry);
  return entry.result;
}

// Hands an entry to the next flush. Runs when the key's earlier write settles,
// or sooner when the page is unloading (see flushOnPageHide).
function startReplacement(entry: QueuedReplacement): Promise<unknown> {
  if (entry.running) return entry.running;
  const id = requestKey(entry.key);
  entry.started = true;
  if (queuedReplacements.get(id) === entry) queuedReplacements.delete(id);
  inFlightReplacements.set(id, entry);
  entry.running = new Promise<unknown>((resolve, reject) => {
    entry.settle = { resolve, reject };
    unsentReplacements.push(entry);
    watchPageHide();
    // A hidden page may never run the timer, so the write goes now.
    if (pageIsHiding()) flushReplacements();
    else replacementFlushTimer ??= setTimeout(flushReplacements, 0);
  }).finally(() => {
    if (inFlightReplacements.get(id) === entry) {
      inFlightReplacements.delete(id);
    }
  });
  return entry.running;
}

// Once the page starts hiding, a write may not get another chance to go out,
// so waiting writes go at once and every write sent from then on asks for
// keepalive (within the budget). That covers writes that pagehide handlers
// make before or after this one, and writes made while the tab is hidden.
let pageHidden = false;
let pageHideWatched = false;

function pageIsHiding(): boolean {
  return (
    pageHidden ||
    (typeof document !== "undefined" && document.visibilityState === "hidden")
  );
}

function wantsKeepalive(replacement: Replacement): boolean {
  return replacement.keepalive === true || pageIsHiding();
}

function watchPageHide(): void {
  if (
    pageHideWatched ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof document === "undefined"
  ) {
    return;
  }
  pageHideWatched = true;
  window.addEventListener("pagehide", flushOnPageHide);
  window.addEventListener("pageshow", () => {
    pageHidden = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushReplacements();
  });
}

function flushOnPageHide(): void {
  pageHidden = true;
  // A keepalive write still waiting for an earlier write to its key would
  // never start once the page is gone, so it goes now, alongside that write.
  // The server may then apply the two in either order; without this it would
  // get only the earlier one.
  for (const entry of [...queuedReplacements.values()]) {
    if (entry.replacement.keepalive) void startReplacement(entry);
  }
  flushReplacements();
}

function flushReplacements(): void {
  if (replacementFlushTimer !== undefined) clearTimeout(replacementFlushTimer);
  replacementFlushTimer = undefined;
  const entries = unsentReplacements;
  unsentReplacements = [];
  for (const entry of entries) entry.sent = true;
  const plain = entries.filter((entry) => !wantsKeepalive(entry.replacement));
  for (let i = 0; i < plain.length; i += MAX_BATCH_WRITES) {
    sendChunk(plain.slice(i, i + MAX_BATCH_WRITES), false);
  }
  // Keepalive writes are packed into requests that each fit what is left of
  // the budget, so one large write can't take the others' keepalive away.
  let chunk: QueuedReplacement[] = [];
  let chunkBytes = BATCH_BODY_OVERHEAD;
  for (const entry of entries) {
    if (!wantsKeepalive(entry.replacement)) continue;
    // Each item after the first adds a comma.
    const bytes = encodedLength(batchItem(entry));
    if (
      chunk.length > 0 &&
      (chunk.length >= MAX_BATCH_WRITES ||
        chunkBytes + 1 + bytes > KEEPALIVE_BYTE_BUDGET - keepaliveBytesInFlight)
    ) {
      sendChunk(chunk, true);
      chunk = [];
      chunkBytes = BATCH_BODY_OVERHEAD;
    }
    chunkBytes += chunk.length > 0 ? 1 + bytes : bytes;
    chunk.push(entry);
  }
  if (chunk.length > 0) sendChunk(chunk, true);
}

function sendChunk(chunk: QueuedReplacement[], keepalive: boolean): void {
  if (chunk.length === 1 || batchWritesUnsupported) {
    for (const entry of chunk) sendEach(entry, keepalive);
  } else {
    void sendBatch(chunk, keepalive);
  }
}

function sendEach(entry: QueuedReplacement, keepalive: boolean): void {
  void sendReplacement(entry, keepalive).then(
    entry.settle?.resolve,
    entry.settle?.reject,
  );
}

type BatchWriteResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

const BATCH_BODY_OVERHEAD = encodedLength(`{"writes":[]}`);

function batchItem({
  key,
  replacement: { method, body, requestSource },
}: QueuedReplacement): string {
  const source = requestSourceHeader(requestSource)["X-Request-Source"];
  return `{"key":${JSON.stringify(key)}${
    method === "DELETE" ? `,"delete":true` : `,"value":${body}`
  }${source ? `,"requestSource":${JSON.stringify(source)}` : ""}}`;
}

async function sendBatch(
  entries: QueuedReplacement[],
  wantKeepalive: boolean,
): Promise<void> {
  const body = `{"writes":[${entries.map(batchItem).join(",")}]}`;
  const operation = `Write application state [${entries
    .map(({ key }) => key)
    .join(", ")}]`;
  const keepalive = keepaliveRequest(wantKeepalive || undefined, body);
  for (const entry of entries)
    entry.sentKeepalive = keepalive.init.keepalive === true;
  let response: Response;
  try {
    response = await fetch(
      agentNativePath("/_agent-native/application-state"),
      { method: "POST", headers: buildHeaders(), body, ...keepalive.init },
    );
  } catch (error) {
    for (const entry of entries) entry.settle?.reject(error);
    return;
  } finally {
    keepalive.release();
  }
  // From here the route may have written: an answer that can't be read or
  // doesn't make sense is an error for every caller, never a reason to send
  // the writes again over whatever has changed since.
  let results: BatchWriteResult[];
  try {
    if (batchRouteAbsent(response)) {
      batchWritesUnsupported = true;
      void response.body?.cancel().catch(() => {});
      for (const entry of entries) sendEach(entry, wantKeepalive);
      return;
    }
    results = response.ok
      ? parseBatchResults(await response.text(), entries.length, operation)
      : await parseAppStateResponse<never>(response, operation);
  } catch (error) {
    for (const entry of entries) entry.settle?.reject(error);
    return;
  }
  entries.forEach((entry, index) => {
    const result = results[index] as BatchWriteResult;
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

// A server without the batch route never runs it, so nothing was written:
// it answers 404 or 405, or hands the POST to the app's pages, which answer
// with HTML. The route marks its own answers and always answers JSON.
function batchRouteAbsent(response: Response): boolean {
  if (responseHeader(response, APP_STATE_BATCH_ROUTE_HEADER) === "1") {
    return false;
  }
  if (response.status === 404 || response.status === 405) return true;
  const type = responseHeader(response, "content-type") ?? "";
  return response.ok && !/\bjson\b/i.test(type);
}

function responseHeader(response: Response, name: string): string | null {
  try {
    return response.headers.get(name);
  } catch {
    // coercion-ok: a response stand-in without headers (some test doubles)
    // reads as one that doesn't carry the header.
    return null;
  }
}

function parseBatchResults(
  raw: string,
  count: number,
  operation: string,
): BatchWriteResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const results = (parsed as { results?: unknown } | null)?.results;
  if (
    Array.isArray(results) &&
    results.length === count &&
    results.every(isBatchWriteResult)
  ) {
    return results;
  }
  throw new Error(
    `${operation} returned an unexpected payload: ${raw.slice(0, 200)}`,
  );
}

function isBatchWriteResult(value: unknown): value is BatchWriteResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    result.ok === true ||
    (result.ok === false &&
      typeof result.status === "number" &&
      typeof result.error === "string")
  );
}

async function sendReplacement(
  entry: QueuedReplacement,
  wantKeepalive: boolean,
): Promise<unknown> {
  const { key } = entry;
  const { method, body, requestSource, keepalive: asked } = entry.replacement;
  const keepalive = keepaliveRequest(
    wantKeepalive ? true : asked === undefined ? undefined : false,
    body,
  );
  entry.sentKeepalive = keepalive.init.keepalive === true;
  let response: Response;
  try {
    response = await fetch(appStateUrl(key), {
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
      ...keepalive.init,
    });
  } finally {
    keepalive.release();
  }
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
        const body = jsonBody(value);
        const keepalive = keepaliveRequest(options.keepalive, body);
        let response: Response;
        try {
          response = await fetch(appStateUrl(key), {
            method: "PUT",
            headers: buildHeaders(options.requestSource),
            body,
            ...keepalive.init,
            signal: options.signal ?? null,
          });
        } finally {
          keepalive.release();
        }
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
        const keepalive = keepaliveRequest(options.keepalive, undefined);
        let response: Response;
        try {
          response = await fetch(appStateUrl(key), {
            method: "DELETE",
            headers: {
              "X-Agent-Native-CSRF": "1",
              ...(browserTabHeaders() ?? {}),
              ...requestSourceHeader(options.requestSource),
            },
            ...keepalive.init,
            signal: options.signal ?? null,
          });
        } finally {
          keepalive.release();
        }
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
