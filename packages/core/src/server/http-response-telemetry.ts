import { randomUUID } from "node:crypto";

import {
  getHeader,
  getMethod,
  getResponseStatus,
  setResponseHeader,
  setServerTiming,
} from "h3";
import type { H3Event } from "h3";

import {
  claimStartupDatabaseTelemetry,
  createDatabaseRequestTelemetry,
  enterDatabaseRequestTelemetry,
  type DatabaseRequestTelemetry,
} from "../db/request-telemetry.js";
import { getDatabaseRuntimeFingerprint } from "../db/runtime-diagnostics.js";
import { isMcpPublicPath } from "../mcp/route-paths.js";
import { track } from "../tracking/index.js";
import { getAppName } from "./app-name.js";

const TELEMETRY_EVENT_NAME = "http.response";
const REQUEST_ID_HEADER = "x-agent-native-request-id";
// Provider delivery posts back to these collectors. Recording the collector
// response would feed another `http.response` event into the same collector.
const TRACKING_INGEST_PATHS = new Set([
  "/track",
  "/api/analytics/track",
  "/api/events/track",
  "/_agent-native/track",
]);
const SLOW_REQUEST_MS = 1_000;
const SLOW_REQUEST_LOG_EVENT = "agent-native.slow_request";
const PROCESS_STATE_KEY = Symbol.for(
  "@agent-native/core/http-response-telemetry.process-state",
);
type ProcessTelemetryState = {
  requestSequence: number;
  moduleEvalUptimeMs: number;
};
type GlobalWithProcessTelemetry = typeof globalThis & {
  [PROCESS_STATE_KEY]?: ProcessTelemetryState;
};
const globalRef = globalThis as GlobalWithProcessTelemetry;
// Process start → this module being evaluated. On a serverless cold start that
// span is the platform's container boot plus server-bundle evaluation, which
// happens entirely before any request handler runs and is therefore invisible
// to every in-handler measurement. Recorded here because module scope is the
// earliest point our own code can observe. Stored on globalThis so the
// earliest-evaluated copy wins if the bundle loads this module twice.
const processState =
  globalRef[PROCESS_STATE_KEY] ??
  (globalRef[PROCESS_STATE_KEY] = {
    requestSequence: 0,
    moduleEvalUptimeMs: Math.max(0, Math.round(process.uptime() * 1_000)),
  });
const REQUEST_TELEMETRY_KEY = Symbol.for(
  "@agent-native/core/http-response-telemetry.request",
);
const installedApps = new WeakSet<object>();

interface HttpRequestTelemetryState {
  startedAt: number;
  requestId: string;
  processAgeAtStartMs: number;
  requestSequence: number;
  frameworkReadyWaitMs: number;
  db: DatabaseRequestTelemetry;
  startupDb?: DatabaseRequestTelemetry;
}

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function boolEnv(key: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    (process.env[key] ?? "").trim().toLowerCase(),
  );
}

function sampleRate(): number {
  const raw = envValue("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE");
  if (!raw) return 0.1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0.1;
  return Math.max(0, Math.min(1, parsed));
}

function shouldDisableTelemetry(): boolean {
  return boolEnv("AGENT_NATIVE_HTTP_TELEMETRY_DISABLED");
}

function isTrackingIngestPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return TRACKING_INGEST_PATHS.has(normalized);
}

function requestPath(event: H3Event): string {
  const raw =
    event.url?.pathname ??
    String(event.node?.req?.url ?? event.path ?? "/").split("?")[0] ??
    "/";
  return raw || "/";
}

function normalizeSegment(segment: string): string {
  if (!segment) return segment;
  if (/^[0-9]+$/.test(segment)) return ":id";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return ":id";
  if (
    /^(run|turn|thread|design|screen|file|msg|key|tok)_[a-z0-9_-]+$/i.test(
      segment,
    )
  ) {
    return ":id";
  }
  if (/^(run|turn)-[0-9]{10,}-[a-z0-9]+$/i.test(segment)) return ":id";
  if (segment.length > 36 && /^[a-z0-9_-]+$/i.test(segment)) return ":id";
  return segment;
}

export function normalizeHttpTelemetryPath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized
    .split("/")
    .map((segment, index) => (index === 0 ? "" : normalizeSegment(segment)))
    .join("/");
}

function statusClass(statusCode: number): string {
  if (!Number.isFinite(statusCode) || statusCode < 100) return "unknown";
  return `${Math.floor(statusCode / 100)}xx`;
}

function routeKind(pathname: string): string {
  if (
    isMcpPublicPath(pathname) ||
    pathname === "/_agent-native" ||
    pathname.startsWith("/_agent-native/")
  ) {
    return "framework";
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  if (pathname.startsWith("/.well-known/")) return "well-known";
  return "app";
}

function hostForEvent(event: H3Event): string | undefined {
  return (
    getHeader(event, "x-forwarded-host") ??
    getHeader(event, "host") ??
    undefined
  );
}

function organizationForHost(host: string | undefined): string | undefined {
  const configured =
    envValue("AGENT_NATIVE_ANALYTICS_ORG_NAME") ??
    envValue("AGENT_NATIVE_ORG_NAME");
  if (configured) return configured;
  const normalized = host?.split(":")[0]?.toLowerCase();
  return normalized?.endsWith(".agent-native.com") ||
    normalized === "agent-native.com"
    ? "Builder.io"
    : undefined;
}

function shouldTrack(
  pathname: string,
  statusCode: number,
  state: HttpRequestTelemetryState,
): boolean {
  if (shouldDisableTelemetry()) return false;
  if (isTrackingIngestPath(pathname)) return false;
  if (pathname.startsWith("/api/analytics/replay")) return false;
  if (statusCode >= 500) return true;
  if (
    statusCode >= 400 &&
    statusCode < 500 &&
    /(?:^|\/)_agent-native\/actions(?:\/|$)/.test(pathname)
  ) {
    return true;
  }
  if (state.requestSequence === 1) return true;
  if (state.startupDb) return true;
  if (Date.now() - state.startedAt >= SLOW_REQUEST_MS) return true;
  if (state.db.errorCount > 0 || state.db.timeoutCount > 0) {
    return true;
  }
  const rate = sampleRate();
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

function responseStatusCode(event: H3Event, response?: Response): number {
  const raw =
    response?.status ??
    (event.node?.res as any)?.statusCode ??
    (event.node?.res as any)?.status ??
    getResponseStatus(event) ??
    200;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 200;
}

function runtimeProvider(): string {
  if (process.env.NETLIFY) return "netlify";
  if (process.env.VERCEL) return "vercel";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) {
    return "aws-lambda";
  }
  if (process.env.CF_PAGES) return "cloudflare-pages";
  return "node";
}

/** Module evaluation → this request starting, i.e. idle boot the app paid for. */
function moduleToRequestMs(state: HttpRequestTelemetryState): number {
  return Math.max(
    0,
    state.processAgeAtStartMs - processState.moduleEvalUptimeMs,
  );
}

function emitTelemetry(
  event: H3Event,
  state: HttpRequestTelemetryState,
  response?: Response,
): void {
  const statusCode = responseStatusCode(event, response);
  const pathname = requestPath(event);
  if (!shouldTrack(pathname, statusCode, state)) return;

  try {
    const host = hostForEvent(event);
    const db = getDatabaseRuntimeFingerprint();
    track(TELEMETRY_EVENT_NAME, {
      source: "server",
      app: getAppName(),
      template: envValue("AGENT_NATIVE_TEMPLATE") ?? getAppName(),
      organization: organizationForHost(host),
      method: getMethod(event),
      path: normalizeHttpTelemetryPath(pathname),
      route_kind: routeKind(pathname),
      status_code: statusCode,
      status_class: statusClass(statusCode),
      duration_ms: Math.max(0, Date.now() - state.startedAt),
      request_id: state.requestId,
      measurement: "nitro_request",
      cold_start: state.requestSequence === 1,
      request_sequence: state.requestSequence,
      process_age_ms: state.processAgeAtStartMs,
      boot_to_module_ms: processState.moduleEvalUptimeMs,
      module_to_request_ms: moduleToRequestMs(state),
      framework_ready_wait_ms: state.frameworkReadyWaitMs,
      runtime_provider: runtimeProvider(),
      function_name: envValue("AWS_LAMBDA_FUNCTION_NAME"),
      function_memory_mb: envValue("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"),
      region: envValue("AWS_REGION") ?? envValue("VERCEL_REGION"),
      host,
      environment: envValue("NODE_ENV"),
      deploy_context: envValue("CONTEXT") ?? envValue("VERCEL_ENV"),
      deploy_id: envValue("DEPLOY_ID") ?? envValue("VERCEL_DEPLOYMENT_ID"),
      commit_ref:
        envValue("COMMIT_REF") ??
        envValue("NETLIFY_COMMIT_REF") ??
        envValue("VERCEL_GIT_COMMIT_SHA") ??
        envValue("GIT_COMMIT_SHA"),
      db_source: db.source,
      db_dialect: db.dialect,
      db_url_hash: db.urlHash,
      db_neon_endpoint: db.neon?.endpointId,
      db_neon_pooled: db.neon?.pooled,
      db_operation_count: state.db.operationCount,
      db_query_count: state.db.queryCount,
      db_connect_count: state.db.connectCount,
      db_retry_count: state.db.retryCount,
      db_error_count: state.db.errorCount,
      db_timeout_count: state.db.timeoutCount,
      db_operation_total_ms: Math.round(state.db.operationTotalMs),
      db_operation_wall_ms: Math.round(state.db.operationWallMs),
      db_query_total_ms: Math.round(state.db.queryTotalMs),
      db_connect_total_ms: Math.round(state.db.connectTotalMs),
      db_slowest_operation_ms: Math.round(state.db.slowestOperationMs),
      startup_db_operation_count: state.startupDb?.operationCount,
      startup_db_query_count: state.startupDb?.queryCount,
      startup_db_connect_count: state.startupDb?.connectCount,
      startup_db_retry_count: state.startupDb?.retryCount,
      startup_db_error_count: state.startupDb?.errorCount,
      startup_db_timeout_count: state.startupDb?.timeoutCount,
      startup_db_operation_total_ms: state.startupDb
        ? Math.round(state.startupDb.operationTotalMs)
        : undefined,
      startup_db_operation_wall_ms: state.startupDb
        ? Math.round(state.startupDb.operationWallMs)
        : undefined,
      startup_db_query_total_ms: state.startupDb
        ? Math.round(state.startupDb.queryTotalMs)
        : undefined,
      startup_db_connect_total_ms: state.startupDb
        ? Math.round(state.startupDb.connectTotalMs)
        : undefined,
      startup_db_slowest_operation_ms: state.startupDb
        ? Math.round(state.startupDb.slowestOperationMs)
        : undefined,
    });
  } catch {
    // Response telemetry is best-effort. Never perturb request handling.
  }
}

function requestTelemetryState(
  event: H3Event,
): HttpRequestTelemetryState | undefined {
  return (event.context as Record<PropertyKey, unknown> | undefined)?.[
    REQUEST_TELEMETRY_KEY
  ] as HttpRequestTelemetryState | undefined;
}

/** Return the durable request id while a request is still being handled. */
export function getHttpRequestTelemetryId(event: H3Event): string | undefined {
  return requestTelemetryState(event)?.requestId;
}

function appendServerTiming(
  response: Response,
  event: H3Event,
  name: string,
  durationMs: number,
  desc?: string,
): void {
  const duration = Math.max(0, Math.round(durationMs));
  const suffix = desc ? `;desc=${JSON.stringify(desc)}` : "";
  try {
    response.headers.append(
      "server-timing",
      `${name};dur=${duration}${suffix}`,
    );
  } catch {
    try {
      setServerTiming(
        event,
        name,
        desc ? { dur: duration, desc } : { dur: duration },
      );
    } catch {
      // Some adapters finalize headers eagerly. Tracking still runs.
    }
  }
}

/**
 * Does this response get stored in a shared (CDN) cache and replayed?
 *
 * SSR HTML and React Router `.data` are one impersonal shell hard-cached for
 * every visitor, so their headers are written ONCE by the origin render and
 * then handed unchanged to everyone who hits the cache afterwards.
 */
function isSharedCacheable(response: Response): boolean {
  const cacheControl =
    response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (!cacheControl) return false;
  if (/\b(?:no-store|no-cache|private)\b/.test(cacheControl)) return false;
  return (
    /\bpublic\b/.test(cacheControl) || /\bs-maxage=[1-9]/.test(cacheControl)
  );
}

/**
 * Per-phase `server-timing` entries do NOT belong on a shared-cacheable
 * response. `app;dur=2159` on a cached shell describes one origin render from
 * an arbitrary point in the past, yet every later visitor reads it as the cost
 * of their own request — a stale number wearing a live number's name.
 *
 * So a cacheable response gets exactly one entry, `origin`, whose description
 * leads with the absolute wall-clock time of the render that produced it. Two
 * visitors comparing notes see the identical timestamp, which is what a replay
 * is. The live per-invocation breakdown goes to the slow-request log line and
 * to tracking instead; neither is ever cached.
 */
function originSnapshotDesc(state: HttpRequestTelemetryState): string {
  const parts = [new Date(state.startedAt).toISOString()];
  if (state.requestSequence === 1) {
    parts.push(
      "cold",
      `boot=${processState.moduleEvalUptimeMs}`,
      `init=${moduleToRequestMs(state)}`,
    );
  }
  if (state.frameworkReadyWaitMs > 0) {
    parts.push(`startup=${Math.round(state.frameworkReadyWaitMs)}`);
  }
  if (state.db.operationCount > 0) {
    parts.push(
      `db=${Math.round(state.db.operationWallMs)}`,
      `dbops=${state.db.operationCount}`,
    );
  }
  return parts.join(" ");
}

/**
 * One structured line per cold or slow request, straight to stdout.
 *
 * Function logs are the only timing surface readable without a deploy, and
 * `track()` silently no-ops when no tracking provider is registered — which is
 * the common case. Deliberately NOT wrapped in a catch: a swallowed emit would
 * leave a slow request indistinguishable from a fast one.
 */
function logSlowRequest(
  event: H3Event,
  state: HttpRequestTelemetryState,
  response: Response | undefined,
  durationMs: number,
  pathname: string,
): void {
  const coldStart = state.requestSequence === 1;
  if (!coldStart && durationMs < SLOW_REQUEST_MS) return;
  console.log(
    JSON.stringify({
      event: SLOW_REQUEST_LOG_EVENT,
      app: getAppName(),
      method: getMethod(event),
      path: normalizeHttpTelemetryPath(pathname),
      status: responseStatusCode(event, response),
      duration_ms: Math.round(durationMs),
      cold_start: coldStart,
      request_sequence: state.requestSequence,
      boot_to_module_ms: processState.moduleEvalUptimeMs,
      module_to_request_ms: moduleToRequestMs(state),
      process_age_ms: state.processAgeAtStartMs,
      framework_ready_wait_ms: Math.round(state.frameworkReadyWaitMs),
      db_ms: Math.round(state.db.operationWallMs),
      db_connect_ms: Math.round(state.db.connectTotalMs),
      db_operation_count: state.db.operationCount,
      db_error_count: state.db.errorCount,
      db_timeout_count: state.db.timeoutCount,
      startup_db_ms: state.startupDb
        ? Math.round(state.startupDb.operationWallMs)
        : undefined,
      shared_cacheable: response ? isSharedCacheable(response) : undefined,
      runtime_provider: runtimeProvider(),
      request_id: state.requestId,
    }),
  );
}

export function recordFrameworkReadyWait(
  event: H3Event,
  durationMs: number,
): void {
  const state = requestTelemetryState(event);
  if (state) {
    state.frameworkReadyWaitMs += Math.max(0, durationMs);
    state.startupDb ??= claimStartupDatabaseTelemetry();
  }
}

export function installHttpResponseTelemetryHooks(nitroApp: any): void {
  if (!nitroApp || installedApps.has(nitroApp)) return;
  const hooks = nitroApp.hooks;
  if (!hooks?.hook) return;
  installedApps.add(nitroApp);

  hooks.hook("request", (event: H3Event) => {
    const state: HttpRequestTelemetryState = {
      startedAt: Date.now(),
      requestId: randomUUID(),
      processAgeAtStartMs: Math.max(0, Math.round(process.uptime() * 1_000)),
      requestSequence: ++processState.requestSequence,
      frameworkReadyWaitMs: 0,
      db: createDatabaseRequestTelemetry(),
    };
    (event.context as Record<PropertyKey, unknown>)[REQUEST_TELEMETRY_KEY] =
      state;
    enterDatabaseRequestTelemetry(state.db);
  });

  hooks.hook("response", (response: Response, event: H3Event) => {
    const state = requestTelemetryState(event);
    if (!state) return;

    const durationMs = Math.max(0, Date.now() - state.startedAt);
    try {
      response.headers.set(REQUEST_ID_HEADER, state.requestId);
    } catch {
      try {
        setResponseHeader(event, REQUEST_ID_HEADER, state.requestId);
      } catch {
        // Some adapters finalize headers eagerly. Tracking still has the id.
      }
    }
    if (isSharedCacheable(response)) {
      appendServerTiming(
        response,
        event,
        "origin",
        durationMs,
        originSnapshotDesc(state),
      );
      logSlowRequest(event, state, response, durationMs, requestPath(event));
      emitTelemetry(event, state, response);
      return;
    }

    appendServerTiming(response, event, "app", durationMs);
    if (state.requestSequence === 1) {
      appendServerTiming(
        response,
        event,
        "boot",
        processState.moduleEvalUptimeMs,
      );
      appendServerTiming(response, event, "init", moduleToRequestMs(state));
    }
    if (state.frameworkReadyWaitMs > 0) {
      appendServerTiming(
        response,
        event,
        "startup",
        state.frameworkReadyWaitMs,
      );
    }
    if (state.db.operationCount > 0) {
      appendServerTiming(response, event, "db-ops", state.db.operationCount);
      appendServerTiming(response, event, "db", state.db.operationWallMs);
      appendServerTiming(
        response,
        event,
        "db-connect",
        state.db.connectTotalMs,
      );
      appendServerTiming(
        response,
        event,
        "db-slowest",
        state.db.slowestOperationMs,
      );
    }
    if (state.startupDb && state.startupDb.operationCount > 0) {
      appendServerTiming(
        response,
        event,
        "startup-db",
        state.startupDb.operationWallMs,
      );
      appendServerTiming(
        response,
        event,
        "startup-db-connect",
        state.startupDb.connectTotalMs,
      );
    }

    logSlowRequest(event, state, response, durationMs, requestPath(event));
    emitTelemetry(event, state, response);
  });
}
