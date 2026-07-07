import { defineEventHandler, getHeader, getMethod } from "h3";
import type { EventHandler, H3Event } from "h3";

import { getDatabaseRuntimeFingerprint } from "../db/runtime-diagnostics.js";
import { track } from "../tracking/index.js";
import { getAppName } from "./app-name.js";

const TELEMETRY_EVENT_NAME = "http.response";
const TRACKING_INGEST_PATHS = new Set([
  "/track",
  "/api/analytics/track",
  "/api/events/track",
  "/_agent-native/track",
]);

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
  if (!raw) return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

function shouldDisableTelemetry(): boolean {
  return boolEnv("AGENT_NATIVE_HTTP_TELEMETRY_DISABLED");
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
  if (pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")) {
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

function shouldTrack(pathname: string, statusCode: number): boolean {
  if (shouldDisableTelemetry()) return false;
  if (TRACKING_INGEST_PATHS.has(pathname)) return false;
  if (pathname.startsWith("/api/analytics/replay")) return false;
  if (statusCode >= 500) return true;
  const rate = sampleRate();
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

function responseStatusCode(event: H3Event): number {
  const raw =
    (event.node?.res as any)?.statusCode ??
    (event.node?.res as any)?.status ??
    (event as any).res?.status ??
    200;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 200;
}

function emitTelemetry(event: H3Event, startedAt: number): void {
  const statusCode = responseStatusCode(event);
  const pathname = requestPath(event);
  if (!shouldTrack(pathname, statusCode)) return;

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
      duration_ms: Math.max(0, Date.now() - startedAt),
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
    });
  } catch {
    // Response telemetry is best-effort. Never perturb request handling.
  }
}

export function createHttpResponseTelemetryMiddleware(): EventHandler {
  return defineEventHandler((event) => {
    const startedAt = Date.now();
    const res = event.node?.res as
      | {
          once?: (event: "finish" | "close", cb: () => void) => void;
          on?: (event: "finish" | "close", cb: () => void) => void;
        }
      | undefined;
    let emitted = false;
    const emitOnce = () => {
      if (emitted) return;
      emitted = true;
      emitTelemetry(event, startedAt);
    };

    if (typeof res?.once === "function") {
      res.once("finish", emitOnce);
      res.once("close", emitOnce);
    } else if (typeof res?.on === "function") {
      res.on("finish", emitOnce);
      res.on("close", emitOnce);
    }
  });
}
