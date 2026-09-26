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
import {
  createTrackingEventScope,
  flushTrackingEvents,
  type TrackingEventScope,
} from "../observability/tracing.js";
import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import { track } from "../tracking/index.js";
import { getAppBasePathFromViteEnv } from "./app-base-path.js";
import { runWithRequestContext } from "./request-context.js";

const TELEMETRY_EVENT_NAME = "http.response";
const REQUEST_ID_HEADER = "x-agent-native-request-id";
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
const REQUEST_TRACKING_SCOPE_KEY = Symbol.for(
  "@agent-native/core/http-response-telemetry.tracking-scope",
);
const installedApps = new WeakSet<object>();

interface TrustedActionRoute {
  actionName: string;
  routeTemplate: string;
}

const trustedActionRoutesByApp = new WeakMap<
  object,
  Map<string, TrustedActionRoute>
>();

interface HttpRequestTelemetryState {
  startedAt: number;
  requestId: string;
  actionName?: string;
  routeTemplate?: string;
  trackingScope: TrackingEventScope;
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

export function getOrCreateHttpRequestTrackingScope(
  event: H3Event,
): TrackingEventScope {
  const context = event.context as Record<PropertyKey, unknown>;
  const existing = context[REQUEST_TRACKING_SCOPE_KEY];
  if (existing) return existing as TrackingEventScope;
  const scope = createTrackingEventScope();
  context[REQUEST_TRACKING_SCOPE_KEY] = scope;
  return scope;
}

function normalizedRoutePath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function trustedActionRouteForPath(
  nitroApp: object,
  pathname: string,
): TrustedActionRoute | undefined {
  const trustedActionRoutes = trustedActionRoutesByApp.get(nitroApp);
  if (!trustedActionRoutes) return undefined;
  const normalizedPathname = normalizedRoutePath(pathname);
  const exactRoute = trustedActionRoutes.get(normalizedPathname);
  if (exactRoute) return exactRoute;

  const pathSegments = normalizedPathname.split("/").filter(Boolean);
  const routeEntries: Array<[string, TrustedActionRoute]> = [
    ...trustedActionRoutes.entries(),
  ];
  return routeEntries
    .filter(([routePath]) => routePath.includes(":"))
    .sort(([leftPath], [rightPath]) => {
      const leftSegments = leftPath.split("/").filter(Boolean);
      const rightSegments = rightPath.split("/").filter(Boolean);
      const leftStatic = leftSegments.filter(
        (segment) => !segment.startsWith(":"),
      ).length;
      const rightStatic = rightSegments.filter(
        (segment) => !segment.startsWith(":"),
      ).length;
      const leftConstrained = leftSegments.filter(
        (segment) => segment.startsWith(":") && segment.includes("("),
      ).length;
      const rightConstrained = rightSegments.filter(
        (segment) => segment.startsWith(":") && segment.includes("("),
      ).length;
      return (
        rightStatic - leftStatic ||
        rightConstrained - leftConstrained ||
        rightSegments.length - leftSegments.length
      );
    })
    .find(([routePath]) => {
      const routeSegments = routePath.split("/").filter(Boolean);
      return (
        routeSegments.length === pathSegments.length &&
        routeSegments.every((segment, index) =>
          routeSegmentMatches(segment, pathSegments[index] ?? ""),
        )
      );
    })?.[1];
}

function routeSegmentMatches(
  routeSegment: string,
  pathSegment: string,
): boolean {
  if (!routeSegment.startsWith(":")) return routeSegment === pathSegment;
  const constraint = /^:[^?(]+(?:\((.*)\))?$/.exec(routeSegment)?.[1];
  if (!constraint) return true;
  try {
    return new RegExp(`^(?:${constraint})$`).test(pathSegment);
  } catch {
    // coercion-ok: invalid declared route constraints cannot match a request.
    return false;
  }
}

export function registerHttpRequestTelemetryActionRoute(
  routePath: string,
  actionName: string,
  routeTemplate: string,
  nitroApp: object,
): void {
  const normalizedRoutePathValue = normalizedRoutePath(routePath);
  const normalizedActionName = actionName.trim();
  const normalizedRouteTemplate = normalizedRoutePath(routeTemplate);
  if (!normalizedActionName || !normalizedRouteTemplate) return;
  const route = {
    actionName: normalizedActionName,
    routeTemplate: normalizedRouteTemplate,
  };
  const trustedActionRoutes =
    trustedActionRoutesByApp.get(nitroApp) ?? new Map();
  trustedActionRoutesByApp.set(nitroApp, trustedActionRoutes);
  trustedActionRoutes.set(normalizedRoutePathValue, route);
  const appBasePath = getAppBasePathFromViteEnv();
  if (appBasePath) {
    trustedActionRoutes.set(
      normalizedRoutePath(`${appBasePath}${normalizedRoutePathValue}`),
      route,
    );
  }
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
  const appBasePath = getAppBasePathFromViteEnv();
  const frameworkPath =
    appBasePath && pathname.startsWith(`${appBasePath}/`)
      ? pathname.slice(appBasePath.length) || "/"
      : pathname;
  if (
    isMcpPublicPath(frameworkPath) ||
    frameworkPath === "/_agent-native" ||
    frameworkPath.startsWith("/_agent-native/")
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

interface TrackingDecision {
  track: boolean;
  sampleRate: number;
  sampled: boolean;
}

function trackingDecision(
  pathname: string,
  statusCode: number,
  state: HttpRequestTelemetryState,
): TrackingDecision {
  if (shouldDisableTelemetry()) {
    return { track: false, sampleRate: 0, sampled: false };
  }
  if (isTrackingIngestPath(pathname)) {
    return { track: false, sampleRate: 0, sampled: false };
  }
  if (pathname.startsWith("/api/analytics/replay")) {
    return { track: false, sampleRate: 0, sampled: false };
  }
  if (statusCode >= 500) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  if (statusCode >= 400 && statusCode < 500 && state.actionName) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  if (state.requestSequence === 1 || state.startupDb) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  if (Date.now() - state.startedAt >= SLOW_REQUEST_MS) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  if (state.db.errorCount > 0 || state.db.timeoutCount > 0) {
    return { track: true, sampleRate: 1, sampled: false };
  }
  const rate = sampleRate();
  if (rate <= 0) return { track: false, sampleRate: rate, sampled: true };
  return { track: Math.random() < rate, sampleRate: rate, sampled: true };
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

function moduleToRequestMs(state: HttpRequestTelemetryState): number {
  return Math.max(
    0,
    state.processAgeAtStartMs - processState.moduleEvalUptimeMs,
  );
}

async function emitTelemetry(
  event: H3Event,
  state: HttpRequestTelemetryState,
  response?: Response,
): Promise<void> {
  const statusCode = responseStatusCode(event, response);
  const pathname = requestPath(event);
  const decision = trackingDecision(pathname, statusCode, state);

  if (decision.track) {
    try {
      const host = hostForEvent(event);
      const actionName = state.actionName;
      const db = getDatabaseRuntimeFingerprint();
      runWithRequestContext({ trackingScope: state.trackingScope }, () => {
        track(TELEMETRY_EVENT_NAME, {
          source: "server",
          ...trackingIdentityProperties(),
          organization: organizationForHost(host),
          method: getMethod(event),
          path: normalizeHttpTelemetryPath(pathname),
          route_kind: routeKind(pathname),
          ...(actionName
            ? {
                action_name: actionName,
                route_template: state.routeTemplate,
              }
            : {}),
          status_code: statusCode,
          status_class: statusClass(statusCode),
          sample_rate: decision.sampleRate,
          sample_weight: 1 / decision.sampleRate,
          sampled: decision.sampled,
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
      });
      // coercion-ok: response telemetry must never affect request handling.
    } catch {
      // Response telemetry is best-effort. Never perturb request handling.
    }
  }
  await flushTrackingEvents(state.trackingScope);
}

function requestTelemetryState(
  event: H3Event,
): HttpRequestTelemetryState | undefined {
  return (event.context as Record<PropertyKey, unknown> | undefined)?.[
    REQUEST_TELEMETRY_KEY
  ] as HttpRequestTelemetryState | undefined;
}

export function getHttpRequestTelemetryId(event: H3Event): string | undefined {
  return requestTelemetryState(event)?.requestId;
}

export function setHttpRequestTelemetryActionName(
  event: H3Event,
  actionName: string,
  routeTemplate = "/_agent-native/actions/:action",
): void {
  const state = requestTelemetryState(event);
  const normalized = actionName.trim();
  if (state && normalized) {
    state.actionName = normalized;
    state.routeTemplate = normalizedRoutePath(routeTemplate);
  }
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

function isSharedCacheable(response: Response): boolean {
  const cacheControl =
    response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (!cacheControl) return false;
  if (/\b(?:no-store|no-cache|private)\b/.test(cacheControl)) return false;
  return (
    /\bpublic\b/.test(cacheControl) || /\bs-maxage=[1-9]/.test(cacheControl)
  );
}

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
      ...trackingIdentityProperties(),
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
    const trackingScope = getOrCreateHttpRequestTrackingScope(event);
    const trustedActionRoute = trustedActionRouteForPath(
      nitroApp,
      requestPath(event),
    );
    const state: HttpRequestTelemetryState = {
      startedAt: Date.now(),
      requestId: randomUUID(),
      ...(trustedActionRoute
        ? {
            actionName: trustedActionRoute.actionName,
            routeTemplate: trustedActionRoute.routeTemplate,
          }
        : {}),
      trackingScope,
      processAgeAtStartMs: Math.max(0, Math.round(process.uptime() * 1_000)),
      requestSequence: ++processState.requestSequence,
      frameworkReadyWaitMs: 0,
      db: createDatabaseRequestTelemetry(),
    };
    (event.context as Record<PropertyKey, unknown>)[REQUEST_TELEMETRY_KEY] =
      state;
    enterDatabaseRequestTelemetry(state.db);
    try {
      event.res.headers.set(REQUEST_ID_HEADER, state.requestId);
      event.res.errHeaders.set(REQUEST_ID_HEADER, state.requestId);
    } catch {
      // coercion-ok: best-effort only. Some adapters don't expose a writable
      // response this early; the "response" hook below still covers the
      // success path, and tracking still has the id either way.
    }
  });

  hooks.hook("response", async (response: Response, event: H3Event) => {
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
      await emitTelemetry(event, state, response);
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
    await emitTelemetry(event, state, response);
  });
}
