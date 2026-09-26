import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UseQueryOptions,
  UseMutationOptions,
} from "@tanstack/react-query";

import { ANALYTICS_CLIENT_PLATFORM_HEADER } from "../shared/analytics-platform.js";
import { getAnalyticsClientPlatform } from "./analytics-platform.js";
import { getOrCreateAnalyticsSessionId } from "./analytics-session.js";
import { trackEvent } from "./analytics.js";
import { agentNativePath } from "./api-path.js";
import {
  agentNativeApiDisabledReason,
  assertAgentNativeApiEnabled,
} from "./api-surface.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import {
  clientBuildId,
  clientCompatibilityVersion,
  reloadForClientCompatibilityMismatch,
} from "./build-compatibility.js";
import { isTerminalAuthFailure } from "./create-query-client.js";
import { ensureEmbedAuthFetchInterceptor } from "./embed-auth.js";
import { recheckSessionAfterUnauthorized } from "./use-session.js";

function actionPrefix(): string {
  return agentNativePath("/_agent-native/actions");
}

const DEFAULT_ACTION_TIMEOUT_MS = 60_000;

function isActionTimeout(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { timedOut?: unknown }).timedOut === true
  );
}

function isRetryableActionStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function actionErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

/** @internal exported for tests */
export function defaultActionQueryRetry(
  failureCount: number,
  error: unknown,
): boolean {
  if (isActionTimeout(error)) return false;
  if (isBrowserResourceExhaustion(error)) return false;
  if (isNetworkLevelFailure(error)) return failureCount < 1;

  const status = actionErrorStatus(error);
  if (status === undefined) return failureCount < 3;

  return isRetryableActionStatus(status) && failureCount < 3;
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

export function actionErrorMessage(error: unknown): string | undefined {
  const value = (error as { actionMessage?: unknown } | undefined)
    ?.actionMessage;
  return typeof value === "string" ? value : undefined;
}

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

type ActionName = keyof ActionRegistry extends never
  ? string
  : (keyof ActionRegistry & string) | (string & {});

type ActionResult<T extends string> = T extends keyof ActionRegistry
  ? ActionRegistry[T] extends { result: infer R }
    ? R
    : any
  : any;

type ActionParams<T extends string> = T extends keyof ActionRegistry
  ? ActionRegistry[T] extends { params: infer P }
    ? P
    : Record<string, any>
  : Record<string, any>;

export type ClientActionMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ClientActionCallOptions {
  method?: ClientActionMethod;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

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
    for (const item of value) {
      appendActionQueryParam(qs, `${key}[]`, item);
    }
    return;
  }
  if (typeof value === "object") {
    qs.append(key, JSON.stringify(value));
    return;
  }
  qs.append(key, String(value));
}

export interface ActionFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  keepalive?: boolean;
  serializedBody?: string;
  includeRequestSource?: boolean;
  headers?: Record<string, string>;
}

type InternalActionFetchOptions = ActionFetchOptions & {
  onResponse?: (response: Response) => void;
  uiCapabilityRetry?: boolean;
};

let uiCapabilityRequest: Promise<void> | undefined;

async function ensureUiActionCapability(): Promise<void> {
  const request =
    uiCapabilityRequest ??
    (uiCapabilityRequest = fetch(
      agentNativePath("/_agent-native/ui-capability"),
      { credentials: "same-origin", cache: "no-store" },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not establish the browser UI capability.");
        }
      })
      .finally(() => {
        uiCapabilityRequest = undefined;
      }));
  return request;
}

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

async function performActionFetch<T>(
  name: string,
  method: string,
  params?: Record<string, any>,
  options?: InternalActionFetchOptions,
): Promise<T> {
  ensureEmbedAuthFetchInterceptor();
  let url = `${actionPrefix()}/${name}`;
  const browserTabId = getBrowserTabId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Agent-Native-Browser-Tab": browserTabId,
    "X-Agent-Native-Frontend": "1",
    ...(options?.includeRequestSource !== false
      ? {
          "X-Request-Source": browserTabId,
        }
      : {}),
    ...(options?.headers ?? {}),
  };
  const compatibilityVersion = clientCompatibilityVersion();
  if (compatibilityVersion) {
    headers["X-Agent-Native-Client-Compatibility"] = compatibilityVersion;
  }
  const buildId = clientBuildId();
  if (buildId) headers["X-Agent-Native-Build-Id"] = buildId;
  const tz = resolveUserTimezone();
  if (tz) {
    headers["x-user-timezone"] = tz;
  }
  const browserSessionId = getOrCreateAnalyticsSessionId();
  if (browserSessionId) {
    headers["X-Agent-Native-Session-Id"] = browserSessionId;
  }
  headers[ANALYTICS_CLIENT_PLATFORM_HEADER] = getAnalyticsClientPlatform();
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
    keepalive: options?.keepalive,
  };

  if (method === "GET" && params && Object.keys(params).length > 0) {
    const qs = serializeActionQueryParams(params);
    if (qs) url += `?${qs}`;
  } else if (method !== "GET" && params) {
    init.body = options?.serializedBody ?? JSON.stringify(params);
  }

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
  const timeoutError = (): Error => {
    const error = new Error(
      `Action ${name} timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    (error as any).timedOut = true;
    (error as any).status = 408;
    return error;
  };
  const throwTimeout = (): never => {
    throw timeoutError();
  };
  let rejectTimedOut: (error: unknown) => void = () => {};
  const timedOutSignal = new Promise<never>((_resolve, reject) => {
    rejectTimedOut = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
    rejectTimedOut(timeoutError());
  }, timeoutMs);
  if (controller) init.signal = controller.signal;

  let res: Response;
  let raw = "";
  let readFailed = false;
  let readError: unknown;
  try {
    try {
      res = await Promise.race([fetch(url, init), timedOutSignal]);
      throwIfAborted(outerSignal);
      options?.onResponse?.(res);
    } catch (err) {
      if (timedOut) throwTimeout();
      if (outerSignal?.aborted) throw err;
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Action ${name} failed: ${cause}`);
    }

    if (
      res.status === 409 &&
      res.headers.get("X-Agent-Native-Client-Mismatch") === "1"
    ) {
      const serverBuildId =
        res.headers.get("X-Agent-Native-Build-Id") ?? "latest";
      const requiredCompatibility =
        res.headers.get("X-Agent-Native-Client-Compatibility") ?? "unknown";
      reloadForClientCompatibilityMismatch(
        serverBuildId,
        requiredCompatibility,
      );
      const error = new Error(
        `Action ${name} requires a refreshed browser client`,
      );
      (error as any).status = 409;
      (error as any).code = "client_build_mismatch";
      throw error;
    }

    throwIfAborted(outerSignal);
    if (res.status === 204) return null as T;

    try {
      raw = await Promise.race([res.text(), timedOutSignal]);
    } catch (err) {
      if (timedOut) throwTimeout();
      if (outerSignal?.aborted) throw err;
      readFailed = true;
      readError = err;
    }
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
  }

  throwIfAborted(outerSignal);

  let data: any = undefined;
  let parseFailed = false;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      parseFailed = true;
    }
  }

  if (!res.ok) {
    if (
      res.status === 403 &&
      data?.errorCode === "ui_capability_required" &&
      !options?.uiCapabilityRetry &&
      typeof window !== "undefined"
    ) {
      await ensureUiActionCapability();
      return performActionFetch<T>(name, method, params, {
        ...options,
        uiCapabilityRetry: true,
      });
    }

    if (res.status === 401) recheckSessionAfterUnauthorized();

    const authored =
      typeof data?.error === "string" && data.error
        ? data.error
        : typeof data?.message === "string" && data.message
          ? data.message
          : undefined;
    const message =
      authored ||
      (raw && raw.slice(0, 200)) ||
      res.statusText ||
      `HTTP ${res.status}`;

    if (res.status === 405) {
      const requiredMethod = /\bUse (GET|POST|PUT|DELETE)\b/.exec(message)?.[1];
      const error = new Error(
        `Action ${name} was called with ${method}, but it declares ` +
          `http: { method: "${requiredMethod ?? "?"}" }. Pass { method: "${requiredMethod ?? "..."}" } ` +
          `to this call (or use the hook that defaults to it) to match the action's declared method.`,
      );
      (error as any).status = 405;
      (error as any).code = "action_method_mismatch";
      (error as any).sentMethod = method;
      if (requiredMethod) (error as any).requiredMethod = requiredMethod;
      throw error;
    }

    const error = new Error(`Action ${name} failed: ${message}`);
    (error as any).status = res.status;
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterSeconds =
      retryAfterHeader === null ? NaN : Number(retryAfterHeader);
    if (
      Number.isInteger(retryAfterSeconds) &&
      retryAfterSeconds > 0 &&
      retryAfterSeconds <= 300
    ) {
      (error as any).retryAfterMs = retryAfterSeconds * 1000;
    }
    if (authored !== undefined) (error as any).actionMessage = authored;
    if (typeof data?.errorCode === "string") {
      (error as any).errorCode = data.errorCode;
    }
    if (
      data?.details &&
      typeof data.details === "object" &&
      !Array.isArray(data.details)
    ) {
      (error as any).details = data.details;
    }
    throw error;
  }

  if (readFailed) {
    const cause =
      readError instanceof Error ? readError.message : String(readError);
    const error = new Error(
      `Action ${name} returned ${res.status} but the body could not be read: ${cause}`,
    );
    (error as any).status = res.status;
    throw error;
  }

  if (parseFailed) {
    const error = new Error(
      `Action ${name} returned a non-JSON ${res.status} response: ${raw.slice(0, 200)}`,
    );
    (error as any).status = res.status;
    throw error;
  }

  throwIfAborted(outerSignal);
  return (data ?? (null as unknown)) as T;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

function actionTelemetryNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

let pageHiddenEpoch = 0;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pageHiddenEpoch += 1;
  });
}

/**
 * `undefined` when there is no document to ask (SSR, a non-browser caller) —
 * "unknown" must stay absent rather than default to a guessed `false`.
 *
 * `hiddenEpochAtStart`/`hiddenEpochNow` only catch a transition INTO hidden
 * that happens during the call. A call that starts already hidden (a
 * background tab load, a cmd-click, a hidden desktop webview) sees no such
 * transition even if the tab surfaces again before the call completes, so
 * `hiddenAtStart` is checked directly instead of being inferred from a
 * transition that never fires.
 *
 * @internal exported for tests
 */
export function computePageHidden(
  hiddenAtStart: boolean,
  hiddenEpochAtStart: number,
  hiddenEpochNow: number,
  visibilityState: DocumentVisibilityState | undefined,
): boolean | undefined {
  if (visibilityState === undefined) return undefined;
  return (
    hiddenAtStart ||
    hiddenEpochAtStart !== hiddenEpochNow ||
    visibilityState !== "visible"
  );
}

function parseServerTiming(
  response: Response | undefined,
): Map<string, number> {
  const timings = new Map<string, number>();
  const value = response?.headers.get("server-timing");
  if (!value) return timings;

  for (const entry of value.split(",")) {
    const [rawName, ...params] = entry.trim().split(";");
    const name = rawName?.trim();
    if (!name) continue;
    const duration = params
      .map((param) => /^dur=(.+)$/i.exec(param.trim())?.[1])
      .find(Boolean);
    const parsed = duration === undefined ? NaN : Number(duration);
    if (Number.isFinite(parsed)) timings.set(name, parsed);
  }
  return timings;
}

type ActionResponseSampling = {
  track: boolean;
  sampleRate: number;
  sampled: boolean;
};

function getActionResponseSampling(
  error: unknown,
  durationMs: number,
  response: Response | undefined,
): ActionResponseSampling {
  if (error || durationMs >= 1_000) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  if (response && response.status >= 400 && response.status < 500) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  if (
    /\bstartup(?:-db)?\s*;/i.test(response?.headers.get("server-timing") ?? "")
  ) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  const raw = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE;
  const parsed = raw === undefined ? 0.1 : Number(raw);
  const rate = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.1;
  return { track: Math.random() < rate, sampleRate: rate, sampled: true };
}

async function actionFetch<T>(
  name: string,
  method: string,
  params?: Record<string, any>,
  options?: ActionFetchOptions,
): Promise<T> {
  assertAgentNativeApiEnabled(`${method} ${name}`);
  const startedAt = actionTelemetryNow();
  const hiddenEpochAtStart = pageHiddenEpoch;
  const hiddenAtStart =
    typeof document !== "undefined" && document.visibilityState !== "visible";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  let response: Response | undefined;
  let responseAt: number | undefined;
  let error: unknown;

  try {
    return await performActionFetch<T>(name, method, params, {
      ...options,
      onResponse: (nextResponse) => {
        response = nextResponse;
        responseAt = actionTelemetryNow();
      },
    });
  } catch (caught) {
    error = caught;
    throw caught;
  } finally {
    try {
      const completedAt = actionTelemetryNow();
      const durationMs = Math.max(0, completedAt - startedAt);
      const sampling = getActionResponseSampling(error, durationMs, response);
      if (sampling.track) {
        const ttfbMs =
          responseAt === undefined
            ? undefined
            : Math.max(0, responseAt - startedAt);
        const serverTiming = parseServerTiming(response);
        const serverDurationMs = serverTiming.get("app");
        const errorStatus = Number(
          (error as { status?: unknown } | undefined)?.status,
        );
        const statusCode =
          response?.status ??
          (Number.isFinite(errorStatus) ? errorStatus : undefined);
        const timedOut =
          (error as { timedOut?: unknown } | undefined)?.timedOut === true;
        const cancelled = options?.signal?.aborted === true && !timedOut;
        const contentLengthHeader = response?.headers.get("content-length");
        const contentLength =
          contentLengthHeader == null ? undefined : Number(contentLengthHeader);
        const serverBootMs = serverTiming.get("boot");
        const serverInitMs = serverTiming.get("init");
        const pageHidden = computePageHidden(
          hiddenAtStart,
          hiddenEpochAtStart,
          pageHiddenEpoch,
          typeof document === "undefined"
            ? undefined
            : document.visibilityState,
        );

        trackEvent("action.response", {
          request_id:
            response?.headers.get("x-agent-native-request-id") ?? undefined,
          action: name,
          method,
          sample_rate: sampling.sampleRate,
          sample_weight: 1 / sampling.sampleRate,
          sampled: sampling.sampled,
          status_code: statusCode,
          status_class:
            statusCode === undefined
              ? "network"
              : `${Math.floor(statusCode / 100)}xx`,
          success: !error,
          outcome: !error
            ? "success"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : response
                  ? "http-error"
                  : "network-error",
          duration_ms: Math.round(durationMs),
          ttfb_ms: ttfbMs === undefined ? undefined : Math.round(ttfbMs),
          body_ms:
            ttfbMs === undefined ? undefined : Math.round(durationMs - ttfbMs),
          server_duration_ms:
            serverDurationMs === undefined
              ? undefined
              : Math.round(serverDurationMs),
          network_overhead_ms:
            ttfbMs === undefined || serverDurationMs === undefined
              ? undefined
              : Math.max(0, Math.round(ttfbMs - serverDurationMs)),
          framework_ready_wait_ms: serverTiming.get("startup"),
          db_operation_wall_ms: serverTiming.get("db"),
          db_connect_total_ms: serverTiming.get("db-connect"),
          db_slowest_operation_ms: serverTiming.get("db-slowest"),
          startup_db_operation_wall_ms: serverTiming.get("startup-db"),
          startup_db_connect_total_ms: serverTiming.get("startup-db-connect"),
          response_bytes:
            contentLength === undefined ||
            !Number.isFinite(contentLength) ||
            contentLength < 0
              ? undefined
              : contentLength,
          server_boot_ms:
            serverBootMs === undefined ? undefined : Math.round(serverBootMs),
          server_init_ms:
            serverInitMs === undefined ? undefined : Math.round(serverInitMs),
          cold_start: serverTiming.has("app")
            ? serverTiming.has("boot")
            : undefined,
          page_hidden: pageHidden,
          timeout_ms: timeoutMs,
        });
      }
    } catch {
      // Performance telemetry must never change the action result.
    }
  }
}

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
    headers: options.headers,
  });
}

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as Error).name === "AbortError"
  );
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export type RetriedActionCallOptions = Omit<
  ClientActionCallOptions,
  "method"
> & { method?: "GET" };

export async function callActionWithRetry<
  TResult = undefined,
  TName extends ActionName = ActionName,
>(
  actionName: TName,
  params?: ActionParams<TName>,
  options: RetriedActionCallOptions = {},
): Promise<TResult extends undefined ? ActionResult<TName> : TResult> {
  const method = (options as ClientActionCallOptions).method;
  if (method !== undefined && method !== "GET") {
    throw new Error(
      `callActionWithRetry refuses ${method} for "${String(actionName)}": ` +
        "retrying a write can duplicate a mutation the origin already " +
        "committed. Use callAction for writes.",
    );
  }
  let failureCount = 0;
  for (;;) {
    try {
      return await callAction<TResult, TName>(actionName, params, {
        ...options,
        method: "GET",
      });
    } catch (error) {
      if (
        isAbortError(error) ||
        isAborted(options.signal) ||
        !defaultActionQueryRetry(failureCount, error)
      ) {
        throw error;
      }
      const delayMs = defaultActionQueryRetryDelay(failureCount);
      failureCount += 1;
      await abortableDelay(delayMs, options.signal);
      if (isAborted(options.signal)) throw error;
    }
  }
}

export type KeepaliveActionCallRejectionReason =
  | "body-too-large"
  | "budget-exhausted"
  | "api-disabled";

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

  if (agentNativeApiDisabledReason()) {
    return {
      accepted: false,
      bodyBytes,
      reason: "api-disabled",
      completion: null,
    };
  }

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

/**
 * Wraps a caller-supplied `refetchInterval` so polling stops once the query's
 * last error is a terminal auth failure (401/403) instead of reissuing the
 * identical rejection on every tick — the same condition useDbSync's
 * `hasTerminalAuthFailure` already skips sync-driven invalidation for. A
 * remount, a mutation's invalidation, or an explicit `refetch()` still
 * retries: this only gates the interval timer, not the query's error state.
 *
 * @internal exported for tests
 */
export function guardActionQueryRefetchInterval<TData = unknown>(
  refetchInterval: NonNullable<UseQueryOptions<TData>["refetchInterval"]>,
): NonNullable<UseQueryOptions<TData>["refetchInterval"]> {
  return (query) => {
    if (isTerminalAuthFailure(query.state.error)) return false;
    return typeof refetchInterval === "function"
      ? refetchInterval(query)
      : refetchInterval;
  };
}

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
  const apiDisabled = Boolean(agentNativeApiDisabledReason());
  const { refetchInterval, ...restOptions } = options ?? {};
  return useQuery<R>({
    queryKey: ["action", actionName, params],
    queryFn: ({ signal }) =>
      actionFetch<R>(actionName, "GET", params, { signal }),
    retry: defaultActionQueryRetry,
    retryDelay: defaultActionQueryRetryDelay,
    ...restOptions,
    ...(refetchInterval !== undefined
      ? { refetchInterval: guardActionQueryRefetchInterval(refetchInterval) }
      : {}),
    ...(apiDisabled ? { enabled: false as const } : {}),
  });
}

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
    timeoutMs?: number;
  },
) {
  const queryClient = useQueryClient();
  const {
    method: methodOpt,
    onSuccess,
    skipActionQueryInvalidation = false,
    timeoutMs,
    ...restOptions
  } = options ?? ({} as any);
  const method = methodOpt ?? "POST";

  type D = TData extends undefined ? ActionResult<TName> : TData;
  type V = TVariables extends undefined ? ActionParams<TName> : TVariables;

  return useMutation<D, Error, V>({
    ...restOptions,
    mutationFn: (params) =>
      actionFetch<D>(actionName, method, params as Record<string, any>, {
        timeoutMs,
      }),
    onSuccess: (...args: [any, any, any]) => {
      if (!skipActionQueryInvalidation) {
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      }
      return (onSuccess as Function)?.(...args);
    },
  });
}
