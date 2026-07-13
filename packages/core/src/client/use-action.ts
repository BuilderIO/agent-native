/**
 * Client helpers for calling actions through the framework transport.
 *
 * Components should prefer `useActionQuery` / `useActionMutation`; use
 * `callAction` for imperative cases such as debounced search, prefetching, or
 * event handlers that do not fit a hook.
 *
 * ## End-to-end type safety
 *
 * When the action type registry is generated (via the Vite plugin or CLI),
 * `useActionQuery` and `useActionMutation` automatically infer the correct
 * return type and parameter types from the action definitions — no manual
 * type annotations needed.
 *
 * ```ts
 * // Fully typed — return type and params inferred from the action's defineAction()
 * const { data } = useActionQuery("list-forms", { status: "published" });
 * //      ^? Form[]  (inferred from the action's run() return type)
 * ```
 *
 * Without the registry, the hooks fall back to `any` types for backward
 * compatibility.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UseQueryOptions,
  UseMutationOptions,
} from "@tanstack/react-query";

import { agentNativePath } from "./api-path.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import { ensureEmbedAuthFetchInterceptor } from "./embed-auth.js";

const ACTION_PREFIX = agentNativePath("/_agent-native/actions");

/**
 * Upper bound on how long a single action fetch may stay in flight (headers
 * AND body). Converts a hung server/proxy/connection into a visible, typed
 * failure instead of a UI that spins forever. Generous on purpose: it sits
 * above every server-side budget (serverless function limits, hosted run
 * wall-clock), so it only fires when something is genuinely stuck.
 */
const DEFAULT_ACTION_TIMEOUT_MS = 60_000;

function isAuthFailure(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403)
  );
}

function isActionTimeout(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { timedOut?: unknown }).timedOut === true
  );
}

/** @internal exported for tests */
export function defaultActionQueryRetry(
  failureCount: number,
  error: unknown,
): boolean {
  if (isAuthFailure(error)) return false;
  // A timeout already made the user wait the full timeout window once;
  // silently retrying would multiply that wait. Surface it instead.
  if (isActionTimeout(error)) return false;
  if (isBrowserResourceExhaustion(error)) return false;
  // Network-level failures never carry an HTTP `status` (actionFetch only
  // sets it after a response arrives). Chrome reports connection-pool
  // exhaustion (net::ERR_INSUFFICIENT_RESOURCES) as a generic "Failed to
  // fetch", indistinguishable from a transient blip — allow one retry, not
  // three, so an exhausted tab cannot sustain its own fetch storm.
  if (isNetworkLevelFailure(error)) return failureCount < 1;
  return failureCount < 3;
}

/** @internal alias kept for existing specs. */
export const shouldRetryActionQueryForError = defaultActionQueryRetry;

function isBrowserResourceExhaustion(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /ERR_INSUFFICIENT_RESOURCES|insufficient resources/i.test(message);
}

function isNetworkLevelFailure(error: unknown): boolean {
  // Match the exact shape actionFetch produces for fetch-level failures (its
  // catch wraps the cause as "Action <name> failed: <cause>" and never sets a
  // status). Other status-less errors (test doubles, transport internals)
  // keep the standard three-retry policy.
  return (
    error instanceof Error &&
    (error as { status?: unknown }).status === undefined &&
    /^Action .+ failed: /.test(error.message)
  );
}

/**
 * Default retry backoff for action queries. React Query's stock retryDelay
 * (1s → 2s → 4s) makes a failing query sit on a spinner for ~7s before the
 * error surfaces; interactive data fetches want failures visible fast.
 *
 * @internal exported for tests
 */
export function defaultActionQueryRetryDelay(failureCount: number): number {
  return Math.min(500 * 2 ** failureCount, 2_000);
}

// ---------------------------------------------------------------------------
// Action type registry — augmented by generated code
// ---------------------------------------------------------------------------

/**
 * Action type registry. This interface is empty by default and gets augmented
 * by the auto-generated `.generated/action-types.d.ts` file. When augmented,
 * it maps action names to their parameter and return types, enabling
 * end-to-end type safety for `useActionQuery` and `useActionMutation`.
 */
declare global {
  interface AgentNativeActionRegistry {}
}

export interface ActionRegistry extends AgentNativeActionRegistry {}

/** Resolves to the union of registered action names, or `string` if no registry exists. */
type ActionName = keyof ActionRegistry extends never
  ? string
  : (keyof ActionRegistry & string) | (string & {});

/** Resolves the return type of an action, or `any` if not in the registry. */
type ActionResult<T extends string> = T extends keyof ActionRegistry
  ? ActionRegistry[T] extends { result: infer R }
    ? R
    : any
  : any;

/** Resolves the parameter type of an action, or `Record<string, any>` if not in the registry. */
type ActionParams<T extends string> = T extends keyof ActionRegistry
  ? ActionRegistry[T] extends { params: infer P }
    ? P
    : Record<string, any>
  : Record<string, any>;

export type ClientActionMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ClientActionCallOptions {
  method?: ClientActionMethod;
  /** Abort signal for the underlying fetch. */
  signal?: AbortSignal;
  /** Override the default 60s fetch timeout for long-running actions. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/**
 * Resolve the browser's IANA timezone (e.g. "America/Los_Angeles"). This is
 * sent on every action request as `x-user-timezone` so server-side defaults
 * like "today" honor the user's local day rather than the server's UTC clock.
 */
function resolveUserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function serializeActionQueryParams(
  params: Record<string, any>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendActionQueryParam(qs, key, value);
  }
  return qs.toString();
}

function appendActionQueryParam(
  qs: URLSearchParams,
  key: string,
  value: unknown,
) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    // Use bracket keys so a one-item array still arrives as an array after the
    // server parses URLSearchParams. Repeated bare keys lose that distinction.
    for (const item of value) {
      appendActionQueryParam(qs, `${key}[]`, item);
    }
    return;
  }
  qs.append(key, String(value));
}

export interface ActionFetchOptions {
  /**
   * Abort signal from the caller (React Query passes one per queryFn
   * invocation so superseded requests — key change, unmount, refetch — cancel
   * the underlying network request instead of hogging a connection slot).
   */
  signal?: AbortSignal;
  /** Per-call override for the fetch timeout. */
  timeoutMs?: number;
  /** Keep the request alive while the document is being unloaded. */
  keepalive?: boolean;
  /** Pre-serialized mutation body used by the keepalive budget coordinator. */
  serializedBody?: string;
  /** Omit the tab echo-suppression tag for imperative callers. */
  includeRequestSource?: boolean;
}

/**
 * Conservative per-document keepalive body budget. Browsers commonly enforce
 * an approximately 64 KiB aggregate limit across every in-flight keepalive
 * request; leaving headroom for other framework traffic prevents a request
 * that passed our guard from being rejected by the browser at send time.
 */
export const ACTION_KEEPALIVE_BODY_BUDGET_BYTES = 48_000;

let reservedKeepaliveBodyBytes = 0;

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }

  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

async function actionFetch<T>(
  name: string,
  method: string,
  params?: Record<string, any>,
  options?: ActionFetchOptions,
): Promise<T> {
  ensureEmbedAuthFetchInterceptor();
  let url = `${ACTION_PREFIX}/${name}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Tag browser-originated action calls so the server can set
    // `ctx.caller = "frontend"` (vs a bare programmatic `"http"` POST).
    // Mirrors the X-Agent-Native-Tool-Bridge: 1 convention. The header is
    // safe to expose: CORS allows it (see action-routes.ts) and it carries
    // no auth weight — it only narrows the caller tag.
    "X-Agent-Native-Frontend": "1",
    ...(options?.includeRequestSource !== false
      ? {
          // The server copies this onto the emitted action sync event.
          // useDbSync can then ignore the echo in this tab while other tabs
          // still refresh.
          "X-Request-Source": getBrowserTabId(),
        }
      : {}),
  };
  const tz = resolveUserTimezone();
  if (tz) headers["x-user-timezone"] = tz;
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
    keepalive: options?.keepalive,
  };

  if (method === "GET" && params && Object.keys(params).length > 0) {
    // Skip null/undefined so optional filters don't turn into literal "null"
    // strings in the query string (e.g. `?folderId=null`).
    const qs = serializeActionQueryParams(params);
    if (qs) url += `?${qs}`;
  } else if (method !== "GET" && params) {
    init.body = options?.serializedBody ?? JSON.stringify(params);
  }

  // One controller drives both cancellation sources: the caller's signal
  // (superseded query, unmount) and the timeout. The timer stays armed until
  // the BODY is fully read — headers arriving quickly while the body stalls
  // is exactly the hang this bounds.
  const outerSignal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const onOuterAbort = () => controller?.abort();
  if (outerSignal && controller) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  }
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  if (controller) init.signal = controller.signal;

  const throwTimeout = (): never => {
    const error = new Error(
      `Action ${name} timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    (error as any).timedOut = true;
    (error as any).status = 408;
    throw error;
  };

  let res: Response;
  let raw = "";
  let readFailed = false;
  let readError: unknown;
  try {
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (timedOut) throwTimeout();
      // Caller-initiated cancellation — rethrow untouched so React Query
      // recognizes it as a cancellation rather than a query failure.
      if (outerSignal?.aborted) throw err;
      // Network failures, CORS, server unreachable, etc. — give the caller a
      // useful message instead of the opaque "Failed to fetch".
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Action ${name} failed: ${cause}`);
    }

    // 204 No Content — nothing to parse.
    if (res.status === 204) return null as T;

    // Read the body as text first so we can:
    //   - tolerate empty bodies (avoids "Unexpected end of JSON input")
    //   - surface non-JSON error responses (HTML 401/404 pages, plain text, etc.)
    //   - preserve the original HTTP status in the thrown error
    // Track read failures separately from "no body" — a stream interruption /
    // decode failure on a 2xx response should error rather than silently
    // succeed with `null`.
    try {
      raw = await res.text();
    } catch (err) {
      if (timedOut) throwTimeout();
      if (outerSignal?.aborted) throw err;
      readFailed = true;
      readError = err;
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
  }

  let data: any = undefined;
  let parseFailed = false;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      // Body wasn't JSON — keep `data` undefined and use the raw text below.
      parseFailed = true;
    }
  }

  if (!res.ok) {
    const message =
      (data && (data.error || data.message)) ||
      // Truncate non-JSON bodies so we don't dump entire HTML pages into the
      // console, but still give the developer a hint as to what came back.
      (raw && raw.slice(0, 200)) ||
      res.statusText ||
      `HTTP ${res.status}`;
    const error = new Error(`Action ${name} failed: ${message}`);
    (error as any).status = res.status;
    throw error;
  }

  // 2xx but the body couldn't even be read (mid-stream abort, decode failure,
  // etc.). Don't silently treat that as a `null` success.
  if (readFailed) {
    const cause =
      readError instanceof Error ? readError.message : String(readError);
    const error = new Error(
      `Action ${name} returned ${res.status} but the body could not be read: ${cause}`,
    );
    (error as any).status = res.status;
    throw error;
  }

  // 2xx with a non-empty, non-JSON body. Action callers expect typed data, so
  // returning `null` here would silently mask a real server bug (e.g. a proxy
  // returning HTML 200 instead of JSON). Throw instead — empty bodies (handled
  // above by the `raw.length > 0` guard and the 204 short-circuit) still
  // correctly resolve to `null`.
  if (parseFailed) {
    const error = new Error(
      `Action ${name} returned a non-JSON ${res.status} response: ${raw.slice(0, 200)}`,
    );
    (error as any).status = res.status;
    throw error;
  }

  return (data ?? (null as unknown)) as T;
}

/**
 * Imperatively call an action from browser/client code.
 *
 * Prefer `useActionQuery` / `useActionMutation` in React render flows. Use this
 * helper when a hook is not ergonomic; do not hand-write fetch calls to
 * `/_agent-native/actions/*` in components.
 */
export function callAction<
  TResult = undefined,
  TName extends ActionName = ActionName,
>(
  actionName: TName,
  params?: ActionParams<TName>,
  options: ClientActionCallOptions = {},
): Promise<TResult extends undefined ? ActionResult<TName> : TResult> {
  type R = TResult extends undefined ? ActionResult<TName> : TResult;
  return actionFetch<R>(actionName, options.method ?? "POST", params, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    includeRequestSource: false,
  });
}

export type KeepaliveActionCallRejectionReason =
  | "body-too-large"
  | "budget-exhausted";

export type KeepaliveActionCallResult<TResult> =
  | {
      accepted: true;
      bodyBytes: number;
      completion: Promise<TResult>;
    }
  | {
      accepted: false;
      bodyBytes: number;
      reason: KeepaliveActionCallRejectionReason;
      completion: null;
    };

/**
 * Attempts an unload-safe action call without exceeding the browser's shared
 * keepalive request budget. The reservation remains held until the response
 * body has completed, because browsers count every in-flight keepalive body
 * against the same per-document quota.
 *
 * A rejected attempt is deliberately synchronous so callers can fall back to
 * a durable outbox before returning from `pagehide`.
 */
export function tryCallActionKeepalive<
  TResult = undefined,
  TName extends ActionName = ActionName,
>(
  actionName: TName,
  params?: ActionParams<TName>,
  options: Omit<ClientActionCallOptions, "method"> = {},
): KeepaliveActionCallResult<
  TResult extends undefined ? ActionResult<TName> : TResult
> {
  type R = TResult extends undefined ? ActionResult<TName> : TResult;
  const serializedBody = JSON.stringify(params ?? {});
  const bodyBytes = utf8ByteLength(serializedBody);

  if (bodyBytes > ACTION_KEEPALIVE_BODY_BUDGET_BYTES) {
    return {
      accepted: false,
      bodyBytes,
      reason: "body-too-large",
      completion: null,
    };
  }

  if (
    reservedKeepaliveBodyBytes + bodyBytes >
    ACTION_KEEPALIVE_BODY_BUDGET_BYTES
  ) {
    return {
      accepted: false,
      bodyBytes,
      reason: "budget-exhausted",
      completion: null,
    };
  }

  reservedKeepaliveBodyBytes += bodyBytes;
  const completion = actionFetch<R>(actionName, "POST", params, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    keepalive: true,
    serializedBody,
  }).finally(() => {
    reservedKeepaliveBodyBytes = Math.max(
      0,
      reservedKeepaliveBodyBytes - bodyBytes,
    );
  });

  return { accepted: true, bodyBytes, completion };
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

/**
 * Query an action exposed as GET.
 *
 * When the action type registry is generated, the return type and parameter
 * types are inferred automatically from the action's `defineAction()` call.
 *
 * ```ts
 * // Type-safe — no manual generic needed
 * const { data } = useActionQuery("list-meals", { date: "2025-01-01" });
 *
 * // Manual override still works when needed
 * const { data } = useActionQuery<CustomType>("list-meals");
 * ```
 */
export function useActionQuery<
  TResult = undefined,
  TName extends ActionName = ActionName,
>(
  actionName: TName,
  params?: ActionParams<TName>,
  options?: Omit<
    UseQueryOptions<TResult extends undefined ? ActionResult<TName> : TResult>,
    "queryKey" | "queryFn"
  >,
) {
  type R = TResult extends undefined ? ActionResult<TName> : TResult;
  return useQuery<R>({
    queryKey: ["action", actionName, params],
    // Thread React Query's per-fetch AbortSignal into the network request so
    // superseded fetches (key change, unmount, rapid refetch) actually cancel
    // instead of holding a per-origin connection slot until they finish.
    queryFn: ({ signal }) =>
      actionFetch<R>(actionName, "GET", params, { signal }),
    retry: defaultActionQueryRetry,
    retryDelay: defaultActionQueryRetryDelay,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Mutation hook
// ---------------------------------------------------------------------------

/**
 * Mutate via an action exposed as POST (default), PUT, or DELETE.
 *
 * When the action type registry is generated, the return type and parameter
 * types are inferred automatically.
 *
 * ```ts
 * // Type-safe
 * const { mutate } = useActionMutation("log-meal");
 * mutate({ name: "Salad", calories: 350 });
 * ```
 */
export function useActionMutation<
  TData = undefined,
  TVariables = undefined,
  TName extends ActionName = ActionName,
>(
  actionName: TName,
  options?: Omit<
    UseMutationOptions<
      TData extends undefined ? ActionResult<TName> : TData,
      Error,
      TVariables extends undefined ? ActionParams<TName> : TVariables
    >,
    "mutationFn"
  > & {
    method?: "POST" | "PUT" | "DELETE";
    skipActionQueryInvalidation?: boolean;
  },
) {
  const queryClient = useQueryClient();
  const {
    method: methodOpt,
    onSuccess,
    skipActionQueryInvalidation = false,
    ...restOptions
  } = options ?? ({} as any);
  const method = methodOpt ?? "POST";

  type D = TData extends undefined ? ActionResult<TName> : TData;
  type V = TVariables extends undefined ? ActionParams<TName> : TVariables;

  return useMutation<D, Error, V>({
    ...restOptions,
    mutationFn: (params) =>
      actionFetch<D>(actionName, method, params as Record<string, any>),
    onSuccess: (...args: [any, any, any]) => {
      // Most mutations change app data broadly. High-volume background
      // mutations can opt out and perform narrower invalidation in onSuccess.
      if (!skipActionQueryInvalidation) {
        queryClient.invalidateQueries({ queryKey: ["action"] });
      }
      (onSuccess as Function)?.(...args);
    },
  });
}
