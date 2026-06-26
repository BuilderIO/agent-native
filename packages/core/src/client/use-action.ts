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
import { ensureEmbedAuthFetchInterceptor } from "./embed-auth.js";

const ACTION_PREFIX = agentNativePath("/_agent-native/actions");

function isAuthFailure(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403)
  );
}

function defaultActionQueryRetry(
  failureCount: number,
  error: unknown,
): boolean {
  if (isAuthFailure(error)) return false;
  return failureCount < 3;
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
export interface ActionRegistry {}

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

async function actionFetch<T>(
  name: string,
  method: string,
  params?: Record<string, any>,
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
  };
  const tz = resolveUserTimezone();
  if (tz) headers["x-user-timezone"] = tz;
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
  };

  if (method === "GET" && params && Object.keys(params).length > 0) {
    // Skip null/undefined so optional filters don't turn into literal "null"
    // strings in the query string (e.g. `?folderId=null`).
    const qs = serializeActionQueryParams(params);
    if (qs) url += `?${qs}`;
  } else if (method !== "GET" && params) {
    init.body = JSON.stringify(params);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
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
  let raw = "";
  let readFailed = false;
  let readError: unknown;
  try {
    raw = await res.text();
  } catch (err) {
    readFailed = true;
    readError = err;
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
  return actionFetch<R>(actionName, options.method ?? "POST", params);
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
    queryFn: () => actionFetch<R>(actionName, "GET", params),
    retry: defaultActionQueryRetry,
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
  },
) {
  const queryClient = useQueryClient();
  const {
    method: methodOpt,
    onSuccess,
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
      // Invalidate related action queries
      queryClient.invalidateQueries({ queryKey: ["action"] });
      (onSuccess as Function)?.(...args);
    },
  });
}
