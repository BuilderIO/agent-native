import type { ActionsRegistry } from "./registry.js";
import type {
  ActionHttpMethod,
  ActionMap,
  InferActionInputFromDef,
  InferActionReturn,
} from "./types.js";

/**
 * Optional module augmentation hook populated by `.generated/action-types.d.ts`.
 * Prefer passing `createActionClient<AppActions>()` / `createActionHooks<AppActions>()`
 * when a single TypeScript program contains multiple independent action registries.
 */
export interface ActionTypeRegistry {
  actions: Record<string, { input: unknown; output: unknown }>;
}

export type ActionNameOf<TRegistry> =
  TRegistry extends ActionsRegistry<infer _TCtx, infer TActions>
    ? Extract<keyof TActions, string>
    : keyof ActionTypeRegistry["actions"] extends never
      ? string
      : Extract<keyof ActionTypeRegistry["actions"], string>;

export type ActionInputOf<TRegistry, TName extends string> =
  TRegistry extends ActionsRegistry<infer _TCtx, infer TActions>
    ? TName extends keyof TActions
      ? InferActionInputFromDef<TActions[TName]>
      : Record<string, unknown>
    : TName extends keyof ActionTypeRegistry["actions"]
      ? ActionTypeRegistry["actions"][TName]["input"]
      : Record<string, unknown>;

export type ActionOutputOf<TRegistry, TName extends string> =
  TRegistry extends ActionsRegistry<infer _TCtx, infer TActions>
    ? TName extends keyof TActions
      ? InferActionReturn<TActions[TName]>
      : unknown
    : TName extends keyof ActionTypeRegistry["actions"]
      ? ActionTypeRegistry["actions"][TName]["output"]
      : unknown;

export class ActionClientError extends Error {
  readonly actionName: string;
  readonly statusCode: number;
  readonly errorCode: string;
  readonly committed: boolean;
  readonly details: Record<string, unknown> | undefined;
  readonly userMessage: string | undefined;

  constructor(params: {
    actionName: string;
    message: string;
    statusCode: number;
    errorCode?: string;
    committed?: boolean;
    details?: Record<string, unknown>;
    userMessage?: string;
  }) {
    super(`Action ${params.actionName} failed: ${params.message}`);
    this.name = "ActionClientError";
    this.actionName = params.actionName;
    this.statusCode = params.statusCode;
    this.errorCode = params.errorCode ?? "action_failed";
    this.committed = params.committed ?? false;
    this.details = params.details;
    this.userMessage = params.userMessage;
  }
}

/**
 * Extract the clean, caller-facing error message from an `ActionClientError`
 * without the `Action <name> failed:` console prefix. Returns `undefined` for
 * network drops or unexpected 5xx failures so the UI renders its own fallback copy.
 */
export function actionErrorMessage(error: unknown): string | undefined {
  if (error instanceof ActionClientError) {
    if (error.statusCode >= 500) return undefined;
    return error.userMessage;
  }
  return undefined;
}

export interface ActionClientOptions {
  /** Base URL for HTTP action calls. Defaults to `"/api/agent-native/actions"`. */
  baseUrl?: string;
  /** Custom Fetch implementation (e.g. SvelteKit `event.fetch`, Nuxt `useRequestFetch()`). */
  fetch?: typeof globalThis.fetch;
  /** Static or async headers attached to every request (e.g. Bearer token). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Fetch credentials mode. Defaults to `"same-origin"`. */
  credentials?: RequestCredentials;
  /** Optional map of action names to HTTP methods (defaults to POST; GET used when specified). */
  methods?: Record<string, ActionHttpMethod>;
  /** Optional namespace scoping generated query keys (e.g. tenant or signed-in user id). */
  scope?: string;
}

export interface ActionCallOptions {
  method?: ActionHttpMethod;
  signal?: AbortSignal;
  headers?: HeadersInit;
  approvalToken?: string;
}

export function buildActionQueryKey(
  actionName: string,
  input?: unknown,
  scope?: string,
): readonly unknown[] {
  return scope
    ? (["agent-native-action", scope, actionName, input ?? {}] as const)
    : (["agent-native-action", actionName, input ?? {}] as const);
}

export interface ActionClient<TRegistry = unknown> {
  readonly baseUrl: string;
  readonly scope: string | undefined;
  call: <TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?: ActionInputOf<TRegistry, TName>,
    options?: ActionCallOptions,
  ) => Promise<ActionOutputOf<TRegistry, TName>>;
  queryKey: <TName extends ActionNameOf<TRegistry>>(
    name: TName,
    input?: ActionInputOf<TRegistry, TName>,
    extraScope?: string,
  ) => readonly unknown[];
}

export function createActionClient<
  TRegistry = ActionsRegistry<never, ActionMap<never>>,
>(options: ActionClientOptions = {}): ActionClient<TRegistry> {
  const baseUrl = (options.baseUrl ?? "/api/agent-native/actions").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    baseUrl,
    scope: options.scope,
    queryKey: (name, input, extraScope) =>
      buildActionQueryKey(name, input, extraScope ?? options.scope),
    call: async (name, input, callOptions = {}) => {
      const method: ActionHttpMethod =
        callOptions.method ?? options.methods?.[name] ?? "POST";

      const resolvedBaseHeaders =
        typeof options.headers === "function"
          ? await options.headers()
          : options.headers;

      const headers = new Headers(resolvedBaseHeaders);
      if (callOptions.headers) {
        new Headers(callOptions.headers).forEach((value, key) => {
          headers.set(key, value);
        });
      }
      if (callOptions.approvalToken) {
        headers.set("X-Action-Approval", callOptions.approvalToken);
      }

      let url = `${baseUrl}/${encodeURIComponent(name)}`;
      let body: string | undefined;

      if (method === "GET") {
        if (input !== undefined && Object.keys(input as object).length > 0) {
          const qs = new URLSearchParams({
            input: JSON.stringify(input),
          });
          url = `${url}?${qs.toString()}`;
        }
      } else {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(input ?? {});
      }

      const response = await fetchImpl(url, {
        method,
        headers,
        credentials: options.credentials ?? "same-origin",
        ...(callOptions.signal ? { signal: callOptions.signal } : {}),
        ...(body !== undefined ? { body } : {}),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");

      if (!response.ok) {
        let errorPayload: unknown = null;
        try {
          errorPayload = isJson ? await response.json() : await response.text();
        } catch {
          // coercion-ok: error response body may be empty or malformed; HTTP status error is always thrown below
          errorPayload = null;
        }
        const record =
          errorPayload && typeof errorPayload === "object"
            ? (errorPayload as Record<string, unknown>)
            : null;
        const message =
          typeof record?.["error"] === "string"
            ? record["error"]
            : `HTTP ${response.status}`;
        const errorCode =
          typeof record?.["errorCode"] === "string"
            ? record["errorCode"]
            : "action_failed";
        const committed = record?.["committed"] === true;
        const details =
          record?.["details"] &&
          typeof record["details"] === "object" &&
          !Array.isArray(record["details"])
            ? (record["details"] as Record<string, unknown>)
            : undefined;

        throw new ActionClientError({
          actionName: name,
          message,
          statusCode: response.status,
          errorCode,
          committed,
          ...(details ? { details } : {}),
          ...(response.status < 500 && typeof record?.["error"] === "string"
            ? { userMessage: record["error"] }
            : {}),
        });
      }

      if (response.status === 204) {
        return undefined as ActionOutputOf<TRegistry, typeof name>;
      }
      const payload: unknown = isJson
        ? await response.json()
        : await response.text();
      return payload as ActionOutputOf<TRegistry, typeof name>;
    },
  };
}
