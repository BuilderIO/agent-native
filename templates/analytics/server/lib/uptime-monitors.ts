/**
 * Uptime monitoring engine.
 *
 * Mirrors the analytics-alerts engine (server/lib/analytics-alerts.ts) but for
 * synthetic HTTP checks: it pings a user-defined URL on a schedule and alerts
 * when the target is down, returns an unexpected status, is too slow, or its
 * body is missing expected / contains forbidden text.
 *
 * Design notes:
 *  - Data lives in the ownable tables defined in ../db/schema-monitoring.ts.
 *    Every read/write is scoped by owner_email + org_id (see `ownerWhere`).
 *  - Physical table creation + indexes live in the app migration list
 *    (server/plugins/db.ts, versions 92+) so the db.spec.ts "every schema
 *    column has a migration" guard stays green and boot handles it.
 *  - `runMonitorCheck` fetches through an SSRF-safe path: private/loopback/
 *    link-local/metadata addresses are blocked (unless an explicit opt-in env
 *    flag is set), the scheme must be http/https, redirects are validated per
 *    hop, and the response body is capped before text assertions run.
 *  - `evaluateAssertions` / `evaluateCheck` / `matchesStatus` are pure and
 *    unit-tested (uptime-monitors.spec.ts).
 */
import { randomUUID } from "node:crypto";

import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrl,
  isBlockedExtensionUrlWithDns,
} from "@agent-native/core/extensions/url-safety";
import { notifyWithDelivery } from "@agent-native/core/notifications";
import { recordChange } from "@agent-native/core/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

declare global {
  var __AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonitorMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type MonitorSeverity = "warning" | "critical";

/** Runtime status of a monitor / a single check. */
export type MonitorStatus =
  | "up"
  | "down"
  | "degraded"
  | "error"
  | "unknown"
  | "running";

export type AssertionType =
  | "body_contains"
  | "body_absent"
  | "header_contains"
  | "header_equals"
  | "max_latency_ms";

export interface Assertion {
  type: AssertionType;
  value: string | number;
  /** Header name for header_* assertions. */
  header?: string;
}

export type StatusMatcher =
  | { mode: "class"; classes: string[] }
  | { mode: "list"; codes: number[] }
  | { mode: "range"; min: number; max: number };

export interface MonitorInput {
  id?: string;
  name: string;
  url: string;
  method?: MonitorMethod;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatus?: StatusMatcher;
  assertions?: Assertion[];
  followRedirects?: boolean;
  severity?: MonitorSeverity;
  channels?: string[];
  emailRecipients?: string[];
  slackWebhookUrl?: string | null;
  webhookUrl?: string | null;
  cooldownMinutes?: number;
  enabled?: boolean;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: MonitorMethod;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: StatusMatcher;
  assertions: Assertion[];
  followRedirects: boolean;
  severity: MonitorSeverity;
  channels: string[];
  emailRecipients: string[];
  slackWebhookUrl: string | null;
  webhookUrl: string | null;
  cooldownMinutes: number;
  enabled: boolean;
  lastStatus: MonitorStatus | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
  lastStatusCode: number | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
}

export interface MonitorUptime {
  uptime24h: number | null;
  uptime7d: number | null;
  checks24h: number;
}

export type MonitorSummary = Monitor & MonitorUptime;

export interface MonitorCheckResult {
  id: string;
  monitorId: string;
  checkedAt: string;
  ok: boolean;
  status: MonitorStatus;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  failedAssertions: string[];
  diagnostics: MonitorCheckDiagnostics;
}

export type MonitorCheckSource =
  | "netlify-scheduled"
  | "netlify-runtime"
  | "in-process"
  | "manual"
  | "unknown";

export interface MonitorCheckDiagnostics {
  source: MonitorCheckSource;
  runtime: {
    nodeEnv?: string;
    netlify?: boolean;
    deployId?: string;
    deployContext?: string;
    commitRef?: string;
    functionName?: string;
    region?: string;
  };
  request: {
    method: MonitorMethod;
    timeoutMs: number;
    followRedirects: boolean;
    assertionTypes: AssertionType[];
    bodyReadRequired: boolean;
    allowPrivateHosts: boolean;
  };
  timings: {
    totalMs?: number;
    ssrfSetupMs?: number;
    requestMs?: number;
    bodyReadMs?: number;
  };
  response?: {
    finalUrl?: string;
    finalHost?: string;
    statusCode?: number;
    headers?: Record<string, string>;
  };
  error?: {
    kind: "config" | "timeout" | "network" | "body-timeout";
    name?: string;
    message: string;
  };
}

export interface MonitorIncident {
  id: string;
  monitorId: string;
  startedAt: string;
  resolvedAt: string | null;
  status: MonitorStatus;
  severity: MonitorSeverity;
  cause: string;
  lastError: string | null;
  notificationId: string | null;
  notificationDelivered: boolean;
  checksFailed: number;
  createdAt: string;
}

/** Result of a single probe (before persistence). */
export interface CheckOutcome {
  checkedAt: string;
  status: MonitorStatus;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  failedAssertions: string[];
  diagnostics: MonitorCheckDiagnostics;
}

export interface AssertionFailure {
  type: AssertionType;
  message: string;
}

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESPONSE_BODY_BYTES = 512 * 1024; // 512 KB read cap for text assertions
const MAX_REDIRECT_HOPS = 5;
const MONITOR_RUNNING_STALE_MS = 5 * 60 * 1000;
const DEFAULT_RESULT_RETENTION_DAYS = 30;
const DEFAULT_MONITOR_LIMIT_PER_OWNER = 100;
export const DEFAULT_MONITOR_TIMEOUT_MS = 10_000;
const MAX_REQUEST_HEADER_COUNT = 20;
const MAX_REQUEST_HEADER_NAME_LENGTH = 128;
const MAX_REQUEST_HEADER_VALUE_BYTES = 2048;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_ASSERTIONS_PER_MONITOR = 20;
const MAX_ASSERTION_VALUE_BYTES = 2048;
const MAX_ASSERTION_HEADER_LENGTH = 128;
const MAX_MONITOR_DIAGNOSTICS_BYTES = 4096;

const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TRANSIENT_FAILURE_CONFIRMATION_CHECKS = 2;

const ASSERTION_TYPES: AssertionType[] = [
  "body_contains",
  "body_absent",
  "header_contains",
  "header_equals",
  "max_latency_ms",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function detectMonitorCheckSource(): MonitorCheckSource {
  if (globalThis.__AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__ === true) {
    return "netlify-scheduled";
  }
  if (process.env.NETLIFY === "true") return "netlify-runtime";
  if (process.env.NODE_ENV === "production") return "in-process";
  return "unknown";
}

function monitorCheckRuntimeDiagnostics(): MonitorCheckDiagnostics["runtime"] {
  return {
    nodeEnv: process.env.NODE_ENV,
    netlify: process.env.NETLIFY === "true" || undefined,
    deployId: process.env.DEPLOY_ID,
    deployContext: process.env.CONTEXT,
    commitRef: process.env.COMMIT_REF,
    functionName:
      process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY_FUNCTION_NAME,
    region: process.env.AWS_REGION,
  };
}

function safeResponseHeaders(
  headers: Record<string, string>,
): Record<string, string> | undefined {
  const picked: Record<string, string> = {};
  for (const key of [
    "server",
    "x-nf-request-id",
    "cache-status",
    "cdn-cache-control",
    "content-type",
  ]) {
    const value = headers[key];
    if (value) picked[key] = value.slice(0, 300);
  }
  return Object.keys(picked).length ? picked : undefined;
}

function finalUrlDiagnostics(url: string | undefined): {
  finalUrl?: string;
  finalHost?: string;
} {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    return {
      finalHost: parsed.host,
    };
  } catch {
    return {};
  }
}

function defaultMonitorCheckDiagnostics(): MonitorCheckDiagnostics {
  return {
    source: "unknown",
    runtime: {},
    request: {
      method: "GET",
      timeoutMs: DEFAULT_MONITOR_TIMEOUT_MS,
      followRedirects: true,
      assertionTypes: [],
      bodyReadRequired: false,
      allowPrivateHosts: false,
    },
    timings: {},
  };
}

function normalizeMonitorCheckDiagnostics(
  raw: unknown,
): MonitorCheckDiagnostics {
  const fallback = defaultMonitorCheckDiagnostics();
  if (!raw || typeof raw !== "object") return fallback;
  const parsed = raw as Partial<MonitorCheckDiagnostics>;
  return {
    ...fallback,
    ...parsed,
    runtime:
      parsed.runtime && typeof parsed.runtime === "object"
        ? parsed.runtime
        : fallback.runtime,
    request:
      parsed.request && typeof parsed.request === "object"
        ? { ...fallback.request, ...parsed.request }
        : fallback.request,
    timings:
      parsed.timings && typeof parsed.timings === "object"
        ? parsed.timings
        : fallback.timings,
    response:
      parsed.response && typeof parsed.response === "object"
        ? {
            finalHost: parsed.response.finalHost,
            statusCode: parsed.response.statusCode,
            headers: parsed.response.headers,
          }
        : undefined,
    error:
      parsed.error && typeof parsed.error === "object"
        ? parsed.error
        : undefined,
  };
}

function compactDiagnostics(
  diagnostics: MonitorCheckDiagnostics,
): MonitorCheckDiagnostics {
  return {
    ...diagnostics,
    runtime: Object.fromEntries(
      Object.entries(diagnostics.runtime).filter(([, value]) => value != null),
    ) as MonitorCheckDiagnostics["runtime"],
    response: diagnostics.response
      ? {
          ...diagnostics.response,
          headers: diagnostics.response.headers,
        }
      : undefined,
    error: diagnostics.error
      ? {
          ...diagnostics.error,
          message: diagnostics.error.message.slice(0, 500),
        }
      : undefined,
  };
}

function serializeMonitorDiagnostics(
  diagnostics: MonitorCheckDiagnostics,
): string {
  const compact = compactDiagnostics(diagnostics);
  const serialized = JSON.stringify(compact);
  if (byteLength(serialized) <= MAX_MONITOR_DIAGNOSTICS_BYTES) {
    return serialized;
  }
  return JSON.stringify({
    ...compact,
    response: compact.response
      ? { ...compact.response, headers: undefined }
      : undefined,
    truncated: true,
  });
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const normalized = Math.floor(Number(value));
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(min, Math.min(max, normalized));
}

function boolEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Opt-in escape hatch for monitoring internal/private hosts (dev, self-host). */
export function monitorAllowPrivateHosts(): boolean {
  return boolEnv("UPTIME_MONITOR_ALLOW_PRIVATE_HOSTS");
}

function resultRetentionDays(): number {
  const raw = process.env.UPTIME_MONITOR_RESULT_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RESULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 365)
    : DEFAULT_RESULT_RETENTION_DAYS;
}

function monitorLimitPerOwner(): number {
  const raw = process.env.UPTIME_MONITOR_LIMIT_PER_OWNER?.trim();
  if (!raw) return DEFAULT_MONITOR_LIMIT_PER_OWNER;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 1000)
    : DEFAULT_MONITOR_LIMIT_PER_OWNER;
}

function transientFailureConfirmationChecks(): number {
  const raw = process.env.UPTIME_MONITOR_TRANSIENT_FAILURE_CONFIRMATION_CHECKS;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 10)
    : DEFAULT_TRANSIENT_FAILURE_CONFIRMATION_CHECKS;
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Normalization / validation
// ---------------------------------------------------------------------------

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeName(name: string): string {
  const normalized = (name ?? "").trim();
  if (!normalized) throw badRequest("Monitor name is required");
  return normalized.slice(0, 120);
}

function normalizeUrl(url: string): string {
  const normalized = (url ?? "").trim();
  if (!normalized) throw badRequest("Monitor URL is required");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw badRequest("Monitor URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest("Monitor URL must use http or https");
  }
  return normalized;
}

function normalizeMethod(method: string | undefined): MonitorMethod {
  const upper = (method ?? "GET").toUpperCase();
  const allowed: MonitorMethod[] = [
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ];
  return (allowed as string[]).includes(upper)
    ? (upper as MonitorMethod)
    : "GET";
}

function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (Object.keys(out).length >= MAX_REQUEST_HEADER_COUNT) {
      throw badRequest(
        `Monitor request headers are limited to ${MAX_REQUEST_HEADER_COUNT}`,
      );
    }
    const key = String(rawKey).trim();
    if (!key) continue;
    if (key.length > MAX_REQUEST_HEADER_NAME_LENGTH) {
      throw badRequest(
        `Monitor request header names are limited to ${MAX_REQUEST_HEADER_NAME_LENGTH} characters`,
      );
    }
    const value = String(rawValue ?? "");
    if (byteLength(value) > MAX_REQUEST_HEADER_VALUE_BYTES) {
      throw badRequest(
        `Monitor request header values are limited to ${MAX_REQUEST_HEADER_VALUE_BYTES} bytes`,
      );
    }
    out[key] = value;
  }
  return out;
}

export function normalizeStatusMatcher(input: unknown): StatusMatcher {
  const fallback: StatusMatcher = { mode: "class", classes: ["2xx"] };
  if (!input || typeof input !== "object") return fallback;
  const raw = input as Record<string, unknown>;
  if (raw.mode === "list" && Array.isArray(raw.codes)) {
    const codes = raw.codes
      .map((c) => Math.floor(Number(c)))
      .filter((c) => Number.isFinite(c) && c >= 100 && c <= 599);
    return codes.length ? { mode: "list", codes } : fallback;
  }
  if (raw.mode === "range") {
    const min = clampInt(raw.min, 100, 599, 200);
    const max = clampInt(raw.max, 100, 599, 299);
    return { mode: "range", min: Math.min(min, max), max: Math.max(min, max) };
  }
  // Default / mode === "class"
  const classes = Array.isArray(raw.classes)
    ? raw.classes
        .map((c) => String(c).toLowerCase())
        .filter((c) => /^[1-5]xx$/.test(c))
    : [];
  return classes.length ? { mode: "class", classes } : fallback;
}

export function normalizeAssertions(input: unknown): Assertion[] {
  if (!Array.isArray(input)) return [];
  const out: Assertion[] = [];
  for (const raw of input) {
    if (out.length >= MAX_ASSERTIONS_PER_MONITOR) {
      throw badRequest(
        `Monitors are limited to ${MAX_ASSERTIONS_PER_MONITOR} assertions`,
      );
    }
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const type = String(entry.type ?? "") as AssertionType;
    if (!ASSERTION_TYPES.includes(type)) continue;
    if (type === "max_latency_ms") {
      // A latency budget of 0 (or negative/NaN) is meaningless — drop it
      // rather than clamping up to the floor, which would silently create a
      // "1ms" assertion the user never asked for.
      const raw = Math.floor(Number(entry.value));
      if (!Number.isFinite(raw) || raw <= 0) continue;
      out.push({ type, value: Math.min(raw, 600_000) });
      continue;
    }
    const value = String(entry.value ?? "").trim();
    if (!value) continue;
    if (byteLength(value) > MAX_ASSERTION_VALUE_BYTES) {
      throw badRequest(
        `Monitor assertion values are limited to ${MAX_ASSERTION_VALUE_BYTES} bytes`,
      );
    }
    if (type === "header_contains" || type === "header_equals") {
      const header = String(entry.header ?? "").trim();
      if (!header) continue;
      if (header.length > MAX_ASSERTION_HEADER_LENGTH) {
        throw badRequest(
          `Monitor assertion header names are limited to ${MAX_ASSERTION_HEADER_LENGTH} characters`,
        );
      }
      out.push({ type, value, header });
      continue;
    }
    out.push({ type, value });
  }
  return out;
}

function normalizeChannels(
  channels: string[] | undefined,
  emailRecipients: string[],
): string[] {
  const source =
    channels && channels.length
      ? channels
      : emailRecipients.length
        ? ["inbox", "email"]
        : ["inbox"];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of source) {
    const channel = String(raw ?? "").trim();
    if (!channel || seen.has(channel)) continue;
    seen.add(channel);
    normalized.push(channel);
  }
  return normalized.length ? normalized : ["inbox"];
}

function normalizeEmailRecipients(recipients: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of recipients ?? []) {
    const email = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
}

function normalizeOptionalHttpUrl(
  value: string | null | undefined,
  label: string,
): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw badRequest(`${label} must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest(`${label} must be an absolute http(s) URL`);
  }
  return trimmed;
}

function ensureInboxChannel(channels: string[]): string[] {
  const normalized = channels.map((c) => c.trim()).filter(Boolean);
  return normalized.includes("inbox") ? normalized : ["inbox", ...normalized];
}

function monitorNotifyMetadata(monitor: Monitor): Record<string, unknown> {
  return {
    kind: "uptime_monitor",
    monitorId: monitor.id,
    monitorName: monitor.name,
    url: monitor.url,
    emailRecipients: monitor.emailRecipients,
    requestedChannels: monitor.channels,
  };
}

function monitorNotifyDeliveryMetadata(
  monitor: Monitor,
): Record<string, string> | undefined {
  const delivery: Record<string, string> = {};
  if (monitor.slackWebhookUrl)
    delivery.slackWebhookUrl = monitor.slackWebhookUrl;
  if (monitor.webhookUrl) delivery.webhookUrl = monitor.webhookUrl;
  return Object.keys(delivery).length > 0 ? delivery : undefined;
}

// ---------------------------------------------------------------------------
// Pure evaluation core (unit-tested)
// ---------------------------------------------------------------------------

export function matchesStatus(
  statusCode: number | null,
  matcher: StatusMatcher,
): boolean {
  if (statusCode == null || !Number.isFinite(statusCode)) return false;
  if (matcher.mode === "list") {
    return matcher.codes.includes(statusCode);
  }
  if (matcher.mode === "range") {
    return statusCode >= matcher.min && statusCode <= matcher.max;
  }
  const cls = `${Math.floor(statusCode / 100)}xx`;
  return matcher.classes.map((c) => c.toLowerCase()).includes(cls);
}

export interface AssertionContext {
  statusCode: number | null;
  latencyMs: number | null;
  bodyText: string;
  headers: Record<string, string>;
}

export function evaluateAssertions(
  assertions: Assertion[],
  ctx: AssertionContext,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  for (const assertion of assertions) {
    switch (assertion.type) {
      case "body_contains": {
        const needle = String(assertion.value);
        if (!ctx.bodyText.includes(needle)) {
          failures.push({
            type: assertion.type,
            message: `Body is missing expected text: "${needle}"`,
          });
        }
        break;
      }
      case "body_absent": {
        const needle = String(assertion.value);
        if (ctx.bodyText.includes(needle)) {
          failures.push({
            type: assertion.type,
            message: `Body contains forbidden text: "${needle}"`,
          });
        }
        break;
      }
      case "header_contains": {
        const name = (assertion.header ?? "").toLowerCase();
        const actual = ctx.headers[name];
        const needle = String(assertion.value);
        if (actual == null || !actual.includes(needle)) {
          failures.push({
            type: assertion.type,
            message: `Header "${assertion.header}" does not contain "${needle}"`,
          });
        }
        break;
      }
      case "header_equals": {
        const name = (assertion.header ?? "").toLowerCase();
        const actual = ctx.headers[name];
        const expected = String(assertion.value);
        if (actual !== expected) {
          failures.push({
            type: assertion.type,
            message:
              actual == null
                ? `Header "${assertion.header}" is missing`
                : `Header "${assertion.header}" did not match the expected value`,
          });
        }
        break;
      }
      case "max_latency_ms": {
        const max = Number(assertion.value);
        if (
          ctx.latencyMs != null &&
          Number.isFinite(max) &&
          ctx.latencyMs > max
        ) {
          failures.push({
            type: assertion.type,
            message: `Response took ${ctx.latencyMs}ms (max ${max}ms)`,
          });
        }
        break;
      }
    }
  }
  return failures;
}

export interface EvaluateCheckParams {
  statusCode: number | null;
  latencyMs: number | null;
  bodyText: string;
  headers: Record<string, string>;
  matcher: StatusMatcher;
  assertions: Assertion[];
  /** Non-null when the request could not complete. */
  fetchError?: string | null;
  /** "config" → misconfiguration (status "error"); "network" → down. */
  errorKind?: "config" | "network" | null;
}

/**
 * Pure classifier. Turns a probe's raw signals into a status + failure list:
 *  - fetchError present   → "error" (config) or "down" (network/timeout)
 *  - status mismatch OR a body/header assertion fails → "down"
 *  - only a latency assertion fails → "degraded"
 *  - otherwise → "up"
 */
export function evaluateCheck(params: EvaluateCheckParams): {
  status: MonitorStatus;
  ok: boolean;
  failedAssertions: string[];
} {
  if (params.fetchError) {
    return {
      status: params.errorKind === "config" ? "error" : "down",
      ok: false,
      failedAssertions: [params.fetchError],
    };
  }

  const messages: string[] = [];
  const statusMatched = matchesStatus(params.statusCode, params.matcher);
  if (!statusMatched) {
    messages.push(`Unexpected status ${params.statusCode ?? "n/a"}`);
  }

  const assertionFailures = evaluateAssertions(params.assertions, {
    statusCode: params.statusCode,
    latencyMs: params.latencyMs,
    bodyText: params.bodyText,
    headers: params.headers,
  });
  for (const failure of assertionFailures) messages.push(failure.message);

  const hardFailure =
    !statusMatched ||
    assertionFailures.some((f) => f.type !== "max_latency_ms");
  const latencyFailure = assertionFailures.some(
    (f) => f.type === "max_latency_ms",
  );

  let status: MonitorStatus = "up";
  if (hardFailure) status = "down";
  else if (latencyFailure) status = "degraded";

  return { status, ok: status === "up", failedAssertions: messages };
}

// ---------------------------------------------------------------------------
// SSRF-safe fetch + probe
// ---------------------------------------------------------------------------

// A single SSRF-safe dispatcher (undici Agent) is reused across every probe.
// Building a fresh Agent per check disabled HTTP keep-alive — each check paid a
// cold DNS + TCP + TLS handshake, inflating the recorded latency well above the
// site's real response time (and occasionally spiking near the timeout) — and
// leaked Agents, which are never closed. The connect-time private-IP guard runs
// on every new socket, so reuse keeps the exact same SSRF protection.
// `undefined` = not built yet; the resolved value may be `null` on runtimes
// without undici / node:dns, in which case callers fall back to plain `fetch`.
let sharedSsrfDispatcherPromise: Promise<unknown | null> | undefined;

function getSharedSsrfDispatcher(): Promise<unknown | null> {
  if (!sharedSsrfDispatcherPromise) {
    sharedSsrfDispatcherPromise = createSsrfSafeDispatcher().catch(() => null);
  }
  return sharedSsrfDispatcherPromise;
}

async function prepareMonitorFetch(
  url: string,
  opts: { allowPrivateHosts: boolean },
): Promise<{ dispatcher: unknown | undefined }> {
  const dispatcher = opts.allowPrivateHosts
    ? undefined
    : ((await getSharedSsrfDispatcher()) ?? undefined);

  if (!opts.allowPrivateHosts && (await isBlockedExtensionUrlWithDns(url))) {
    throw new Error(
      `SSRF blocked: refusing to fetch private/internal address (${url})`,
    );
  }

  return { dispatcher };
}

async function safeMonitorFetch(
  url: string,
  init: RequestInit,
  opts: {
    followRedirects: boolean;
    maxRedirects: number;
    allowPrivateHosts: boolean;
    /** Prebuilt outside the abort window so SSRF setup is not billed as site latency. */
    dispatcher?: unknown;
    /** When true, the caller already DNS-checked `url` before starting the timer. */
    initialDnsChecked?: boolean;
  },
): Promise<Response> {
  const dispatcher =
    opts.dispatcher !== undefined
      ? opts.dispatcher
      : opts.allowPrivateHosts
        ? undefined
        : ((await getSharedSsrfDispatcher()) ?? undefined);

  let currentUrl = url;
  const maxHops = opts.followRedirects ? opts.maxRedirects : 0;

  for (let hop = 0; hop <= maxHops; hop++) {
    const skipDns = hop === 0 && opts.initialDnsChecked;
    if (
      !skipDns &&
      !opts.allowPrivateHosts &&
      (await isBlockedExtensionUrlWithDns(currentUrl))
    ) {
      throw new Error(
        `SSRF blocked: refusing to fetch private/internal address (${currentUrl})`,
      );
    }
    const fetchOpts: RequestInit & { dispatcher?: unknown } = {
      ...init,
      redirect: "manual",
    };
    if (dispatcher) fetchOpts.dispatcher = dispatcher;

    const response = await fetch(currentUrl, fetchOpts as RequestInit);
    const isRedirect = response.status >= 300 && response.status < 400;
    if (opts.followRedirects && isRedirect) {
      const location = response.headers.get("location");
      if (!location) return response;
      await cancelResponseBody(response);
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return response;
  }
  throw new Error(
    `SSRF blocked: too many redirects (>${opts.maxRedirects}) while fetching ${url}`,
  );
}

async function cancelResponseBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Best-effort cleanup only.
  }
}

async function readCappedText(
  res: Response,
  cap: number,
  timeoutMs?: number,
): Promise<{ text: string; timedOut: boolean }> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const body = res.body;
  if (!body) {
    try {
      const text =
        timeoutMs && timeoutMs > 0
          ? await Promise.race([
              res.text(),
              new Promise<string>((resolve) => {
                timer = setTimeout(() => {
                  timedOut = true;
                  resolve("");
                }, timeoutMs);
              }),
            ])
          : await res.text();
      return { text: text.length > cap ? text.slice(0, cap) : text, timedOut };
    } catch {
      return { text: "", timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const reader = body.getReader();
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } catch {
    // Partial body is fine for text assertions.
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  const size = Math.min(total, cap);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= size) break;
    const slice =
      chunk.length > size - offset ? chunk.subarray(0, size - offset) : chunk;
    merged.set(slice, offset);
    offset += slice.length;
  }
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
    timedOut,
  };
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function needsResponseBody(assertions: Assertion[]): boolean {
  return assertions.some(
    (assertion) =>
      assertion.type === "body_contains" || assertion.type === "body_absent",
  );
}

/**
 * Execute one probe for `monitor`. Performs an SSRF-safe fetch with an
 * AbortController timeout, measures latency, caps the response body, and
 * classifies the result. Never throws — failures are captured in the outcome.
 *
 * The abort budget covers only the HTTP fetch (headers / redirect chain), not
 * SSRF dispatcher/DNS setup or optional body reads. Billing setup time against
 * `timeoutMs` produced false "Timed out after Nms" alerts when the site itself
 * was fine.
 */
export async function runMonitorCheck(
  monitor: Pick<
    Monitor,
    | "url"
    | "method"
    | "requestHeaders"
    | "requestBody"
    | "timeoutMs"
    | "expectedStatus"
    | "assertions"
    | "followRedirects"
  >,
  opts: { allowPrivateHosts?: boolean; source?: MonitorCheckSource } = {},
): Promise<CheckOutcome> {
  const checkedAt = nowIso();
  const matcher = monitor.expectedStatus;
  const assertions = monitor.assertions;
  const allowPrivateHosts =
    opts.allowPrivateHosts ?? monitorAllowPrivateHosts();
  const timeoutMs = clampInt(
    monitor.timeoutMs,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_MONITOR_TIMEOUT_MS,
  );
  const method = normalizeMethod(monitor.method);
  const diagnostics: MonitorCheckDiagnostics = {
    source: opts.source ?? detectMonitorCheckSource(),
    runtime: monitorCheckRuntimeDiagnostics(),
    request: {
      method,
      timeoutMs,
      followRedirects: monitor.followRedirects,
      assertionTypes: assertions.map((assertion) => assertion.type),
      bodyReadRequired: method !== "HEAD" && needsResponseBody(assertions),
      allowPrivateHosts,
    },
    timings: {},
  };
  const totalStart = Date.now();
  const finish = <T extends Omit<CheckOutcome, "diagnostics">>(
    outcome: T,
  ): T & { diagnostics: MonitorCheckDiagnostics } => {
    diagnostics.timings.totalMs = Date.now() - totalStart;
    return { ...outcome, diagnostics };
  };

  // Fast, deterministic pre-flight guard (scheme + literal private hosts).
  if (!allowPrivateHosts && isBlockedExtensionUrl(monitor.url)) {
    diagnostics.error = {
      kind: "config",
      message: "SSRF blocked: private/internal or non-http(s) address",
    };
    return finish({
      checkedAt,
      statusCode: null,
      latencyMs: null,
      ...evaluateCheck({
        statusCode: null,
        latencyMs: null,
        bodyText: "",
        headers: {},
        matcher,
        assertions,
        fetchError: `SSRF blocked: ${monitor.url} is a private, internal, or non-http(s) address`,
        errorKind: "config",
      }),
      error: "SSRF blocked: private/internal or non-http(s) address",
    });
  }

  let dispatcher: unknown | undefined;
  try {
    const ssrfStart = Date.now();
    ({ dispatcher } = await prepareMonitorFetch(monitor.url, {
      allowPrivateHosts,
    }));
    diagnostics.timings.ssrfSetupMs = Date.now() - ssrfStart;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err ?? "check failed");
    const isConfig = message.startsWith("SSRF blocked");
    const errorText = message.slice(0, 500);
    diagnostics.timings.ssrfSetupMs = Date.now() - totalStart;
    diagnostics.error = {
      kind: isConfig ? "config" : "network",
      name: err instanceof Error ? err.name : undefined,
      message: errorText,
    };
    const outcome = evaluateCheck({
      statusCode: null,
      latencyMs: null,
      bodyText: "",
      headers: {},
      matcher,
      assertions,
      fetchError: errorText,
      errorKind: isConfig ? "config" : "network",
    });
    return finish({
      checkedAt,
      statusCode: null,
      latencyMs: null,
      status: outcome.status,
      ok: outcome.ok,
      failedAssertions: outcome.failedAssertions,
      error: errorText,
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const requestStart = Date.now();

  try {
    const hasBody =
      method !== "GET" &&
      method !== "HEAD" &&
      monitor.requestBody != null &&
      monitor.requestBody !== "";
    const init: RequestInit = {
      method,
      headers: monitor.requestHeaders,
      signal: controller.signal,
      body: hasBody ? (monitor.requestBody ?? undefined) : undefined,
    };

    const response = await safeMonitorFetch(monitor.url, init, {
      followRedirects: monitor.followRedirects,
      maxRedirects: MAX_REDIRECT_HOPS,
      allowPrivateHosts,
      dispatcher,
      initialDnsChecked: Boolean(dispatcher),
    });
    diagnostics.timings.requestMs = Date.now() - requestStart;

    // Stop the abort timer as soon as headers arrive so a slow/optional body
    // read cannot be mislabeled as a request timeout with a null status code.
    clearTimeout(timer);

    const latencyMs = diagnostics.timings.requestMs;
    const statusCode = response.status;
    const headers = headersToObject(response.headers);
    diagnostics.response = {
      ...finalUrlDiagnostics(response.url),
      statusCode,
      headers: safeResponseHeaders(headers),
    };
    let bodyText = "";
    let bodyReadError: string | null = null;
    if (method !== "HEAD" && needsResponseBody(assertions)) {
      const bodyReadStart = Date.now();
      const body = await readCappedText(
        response,
        MAX_RESPONSE_BODY_BYTES,
        timeoutMs,
      );
      diagnostics.timings.bodyReadMs = Date.now() - bodyReadStart;
      bodyText = body.text;
      if (body.timedOut) {
        bodyReadError = `Response body read timed out after ${timeoutMs}ms`;
        diagnostics.error = {
          kind: "body-timeout",
          message: bodyReadError,
        };
      }
    } else {
      await cancelResponseBody(response);
    }

    const outcome = evaluateCheck({
      statusCode,
      latencyMs,
      bodyText,
      headers,
      matcher,
      assertions,
    });
    const failedAssertions = bodyReadError
      ? [...outcome.failedAssertions, bodyReadError]
      : outcome.failedAssertions;
    const status = bodyReadError ? "down" : outcome.status;

    return finish({
      checkedAt,
      statusCode,
      latencyMs,
      status,
      ok: status === "up" && outcome.ok,
      failedAssertions,
      error: failedAssertions.length ? failedAssertions.join("; ") : null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err ?? "check failed");
    const isConfig = message.startsWith("SSRF blocked");
    // Only our timer sets `timedOut`. Prefer the real SSRF/config message when
    // both happened (e.g. abort fired while a redirect DNS check was in flight).
    const isTimeout = timedOut && !isConfig;
    const errorText = isTimeout
      ? `Timed out after ${timeoutMs}ms`
      : message.slice(0, 500);
    diagnostics.timings.requestMs = Date.now() - requestStart;
    diagnostics.error = {
      kind: isConfig ? "config" : isTimeout ? "timeout" : "network",
      name: err instanceof Error ? err.name : undefined,
      message: errorText,
    };
    const outcome = evaluateCheck({
      statusCode: null,
      latencyMs: isTimeout ? timeoutMs : null,
      bodyText: "",
      headers: {},
      matcher,
      assertions,
      fetchError: errorText,
      errorKind: isConfig ? "config" : "network",
    });
    return finish({
      checkedAt,
      statusCode: null,
      latencyMs: isTimeout ? timeoutMs : null,
      status: outcome.status,
      ok: outcome.ok,
      failedAssertions: outcome.failedAssertions,
      error: errorText,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Row mapping + scoping
// ---------------------------------------------------------------------------

function rowToMonitor(row: any): Monitor {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: normalizeMethod(row.method),
    requestHeaders: safeJsonParse<Record<string, string>>(
      row.requestHeaders,
      {},
    ),
    requestBody: row.requestBody ?? null,
    intervalSeconds: Number(row.intervalSeconds ?? 300),
    timeoutMs: Number(row.timeoutMs ?? DEFAULT_MONITOR_TIMEOUT_MS),
    expectedStatus: normalizeStatusMatcher(
      safeJsonParse<unknown>(row.expectedStatus, null),
    ),
    assertions: normalizeAssertions(safeJsonParse<unknown>(row.assertions, [])),
    followRedirects: row.followRedirects === true || row.followRedirects === 1,
    severity: row.severity === "warning" ? "warning" : "critical",
    channels: safeJsonParse<string[]>(row.channels, ["inbox"]),
    emailRecipients: safeJsonParse<string[]>(row.emailRecipients, []),
    slackWebhookUrl: row.slackWebhookUrl?.trim() || null,
    webhookUrl: row.webhookUrl?.trim() || null,
    cooldownMinutes: Number(row.cooldownMinutes ?? 15),
    enabled: row.enabled === true || row.enabled === 1,
    lastStatus: (row.lastStatus ?? null) as MonitorStatus | null,
    lastCheckedAt: row.lastCheckedAt ?? null,
    lastSuccessAt: row.lastSuccessAt ?? null,
    lastError: row.lastError ?? null,
    lastLatencyMs: row.lastLatencyMs ?? null,
    lastStatusCode: row.lastStatusCode ?? null,
    consecutiveFailures: Number(row.consecutiveFailures ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
  };
}

function rowToResult(row: any): MonitorCheckResult {
  return {
    id: row.id,
    monitorId: row.monitorId,
    checkedAt: row.checkedAt,
    ok: row.ok === true || row.ok === 1,
    status: (row.status ?? "up") as MonitorStatus,
    statusCode: row.statusCode ?? null,
    latencyMs: row.latencyMs ?? null,
    error: row.error ?? null,
    failedAssertions: safeJsonParse<string[]>(row.failedAssertions, []),
    diagnostics: normalizeMonitorCheckDiagnostics(
      safeJsonParse<unknown>(row.diagnostics, {}),
    ),
  };
}

function rowToIncident(row: any): MonitorIncident {
  return {
    id: row.id,
    monitorId: row.monitorId,
    startedAt: row.startedAt,
    resolvedAt: row.resolvedAt ?? null,
    status: (row.status ?? "down") as MonitorStatus,
    severity: row.severity === "warning" ? "warning" : "critical",
    cause: row.cause ?? "",
    lastError: row.lastError ?? null,
    notificationId: row.notificationId ?? null,
    notificationDelivered:
      row.notificationDelivered === true ||
      row.notificationDelivered === 1 ||
      Boolean(row.notificationId),
    checksFailed: Number(row.checksFailed ?? 1),
    createdAt: row.createdAt,
  };
}

function ownerWhere(ctx: AccessCtx, id?: string) {
  const table = schema.monitors;
  const clauses = [
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  ];
  if (id) clauses.push(eq(table.id, id));
  return and(...clauses);
}

function resultsOwnerWhere(ctx: AccessCtx) {
  const table = schema.monitorCheckResults;
  return and(
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  );
}

function incidentsOwnerWhere(ctx: AccessCtx) {
  const table = schema.monitorIncidents;
  return and(
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  );
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listMonitors(ctx: AccessCtx): Promise<MonitorSummary[]> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.monitors)
    .where(ownerWhere(ctx))
    .orderBy(asc(schema.monitors.name));
  const monitors = rows.map(rowToMonitor);
  const uptime = await computeUptime(
    ctx,
    monitors.map((m: Monitor) => m.id),
  );
  return monitors.map((monitor: Monitor) => ({
    ...monitor,
    ...(uptime.get(monitor.id) ?? {
      uptime24h: null,
      uptime7d: null,
      checks24h: 0,
    }),
  }));
}

export async function getMonitor(
  id: string,
  ctx: AccessCtx,
): Promise<{
  monitor: MonitorSummary;
  recentResults: MonitorCheckResult[];
  incidents: MonitorIncident[];
} | null> {
  const db = getDb() as any;
  const [row] = await db
    .select()
    .from(schema.monitors)
    .where(ownerWhere(ctx, id));
  if (!row) return null;
  const monitor = rowToMonitor(row);

  const [resultRows, incidentRows, uptime] = await Promise.all([
    db
      .select()
      .from(schema.monitorCheckResults)
      .where(
        and(
          resultsOwnerWhere(ctx),
          eq(schema.monitorCheckResults.monitorId, id),
        ),
      )
      .orderBy(desc(schema.monitorCheckResults.checkedAt))
      .limit(100),
    db
      .select()
      .from(schema.monitorIncidents)
      .where(
        and(
          incidentsOwnerWhere(ctx),
          eq(schema.monitorIncidents.monitorId, id),
        ),
      )
      .orderBy(desc(schema.monitorIncidents.startedAt))
      .limit(50),
    computeUptime(ctx, [id]),
  ]);

  return {
    monitor: {
      ...monitor,
      ...(uptime.get(id) ?? {
        uptime24h: null,
        uptime7d: null,
        checks24h: 0,
      }),
    },
    recentResults: resultRows.map(rowToResult),
    incidents: incidentRows.map(rowToIncident),
  };
}

async function computeUptime(
  ctx: AccessCtx,
  ids: string[],
): Promise<Map<string, MonitorUptime>> {
  const result = new Map<string, MonitorUptime>();
  if (ids.length === 0) return result;
  const db = getDb() as any;
  const table = schema.monitorCheckResults;
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db
    .select({
      monitorId: table.monitorId,
      total24h: sql<number>`sum(case when ${table.checkedAt} >= ${since24h} then 1 else 0 end)`,
      ok24h: sql<number>`sum(case when ${table.checkedAt} >= ${since24h} and ${table.ok} then 1 else 0 end)`,
      total7d: sql<number>`sum(case when ${table.checkedAt} >= ${since7d} then 1 else 0 end)`,
      ok7d: sql<number>`sum(case when ${table.checkedAt} >= ${since7d} and ${table.ok} then 1 else 0 end)`,
    })
    .from(table)
    .where(and(resultsOwnerWhere(ctx), gte(table.checkedAt, since7d)))
    .groupBy(table.monitorId);

  const wanted = new Set(ids);
  for (const row of rows) {
    if (!wanted.has(row.monitorId)) continue;
    const total24h = Number(row.total24h ?? 0);
    const ok24h = Number(row.ok24h ?? 0);
    const total7d = Number(row.total7d ?? 0);
    const ok7d = Number(row.ok7d ?? 0);
    result.set(row.monitorId, {
      uptime24h: total24h > 0 ? (ok24h / total24h) * 100 : null,
      uptime7d: total7d > 0 ? (ok7d / total7d) * 100 : null,
      checks24h: total24h,
    });
  }
  return result;
}

export async function saveMonitor(
  input: MonitorInput,
  ctx: AccessCtx,
): Promise<Monitor> {
  const db = getDb() as any;
  const updatedAt = nowIso();
  const id = input.id || randomUUID();

  const name = normalizeName(input.name);
  const url = normalizeUrl(input.url);
  const method = normalizeMethod(input.method);
  const requestHeaders = normalizeHeaders(input.requestHeaders);
  const requestBody = input.requestBody?.trim() ? input.requestBody : null;
  if (requestBody && byteLength(requestBody) > MAX_REQUEST_BODY_BYTES) {
    throw badRequest(
      `Monitor request bodies are limited to ${MAX_REQUEST_BODY_BYTES} bytes`,
    );
  }
  const intervalSeconds = clampInt(
    input.intervalSeconds ?? 300,
    MIN_INTERVAL_SECONDS,
    MAX_INTERVAL_SECONDS,
    300,
  );
  const timeoutMs = clampInt(
    input.timeoutMs ?? DEFAULT_MONITOR_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_MONITOR_TIMEOUT_MS,
  );
  const expectedStatus = normalizeStatusMatcher(input.expectedStatus);
  const assertions = normalizeAssertions(input.assertions);
  const followRedirects = input.followRedirects ?? true;
  const severity = input.severity === "warning" ? "warning" : "critical";
  const emailRecipients = normalizeEmailRecipients(input.emailRecipients);
  const channels = normalizeChannels(input.channels, emailRecipients);
  const slackWebhookUrl = normalizeOptionalHttpUrl(
    input.slackWebhookUrl,
    "Slack webhook URL",
  );
  const webhookUrl = normalizeOptionalHttpUrl(input.webhookUrl, "Webhook URL");
  const cooldownMinutes = clampInt(input.cooldownMinutes ?? 15, 0, 24 * 60, 15);
  const enabled = input.enabled ?? true;

  const shared = {
    name,
    url,
    method,
    requestHeaders: JSON.stringify(requestHeaders),
    requestBody,
    intervalSeconds,
    timeoutMs,
    expectedStatus: JSON.stringify(expectedStatus),
    assertions: JSON.stringify(assertions),
    followRedirects,
    severity,
    channels: JSON.stringify(channels),
    emailRecipients: JSON.stringify(emailRecipients),
    slackWebhookUrl,
    webhookUrl,
    cooldownMinutes,
    enabled,
  };

  if (input.id) {
    const existing = await getMonitor(input.id, ctx);
    if (!existing) {
      throw Object.assign(new Error("Monitor not found"), { statusCode: 404 });
    }
    await db
      .update(schema.monitors)
      .set({ ...shared, updatedAt })
      .where(ownerWhere(ctx, id));
  } else {
    const [{ total = 0 } = { total: 0 }] = await db
      .select({ total: count() })
      .from(schema.monitors)
      .where(ownerWhere(ctx));
    const limit = monitorLimitPerOwner();
    if (Number(total) >= limit) {
      throw Object.assign(new Error(`Monitor limit reached (${limit})`), {
        statusCode: 429,
      });
    }
    await db.insert(schema.monitors).values({
      id,
      ...shared,
      lastStatus: "unknown",
      consecutiveFailures: 0,
      createdAt: updatedAt,
      updatedAt,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
    });
  }

  const [row] = await db
    .select()
    .from(schema.monitors)
    .where(ownerWhere(ctx, id));
  if (!row) throw new Error("Failed to save monitor");
  const saved = rowToMonitor(row);
  recordChange({
    source: "monitors",
    type: "change",
    key: saved.id,
    owner: saved.ownerEmail,
    orgId: saved.orgId ?? undefined,
  });
  return saved;
}

export async function deleteMonitor(id: string, ctx: AccessCtx): Promise<void> {
  const [row] = await (getDb() as any)
    .select()
    .from(schema.monitors)
    .where(ownerWhere(ctx, id));
  if (!row) {
    throw Object.assign(new Error("Monitor not found"), { statusCode: 404 });
  }
  const monitor = rowToMonitor(row);
  const db = getDb() as any;
  await db.delete(schema.monitors).where(ownerWhere(ctx, id));
  await db
    .delete(schema.monitorCheckResults)
    .where(
      and(resultsOwnerWhere(ctx), eq(schema.monitorCheckResults.monitorId, id)),
    );
  await db
    .delete(schema.monitorIncidents)
    .where(
      and(incidentsOwnerWhere(ctx), eq(schema.monitorIncidents.monitorId, id)),
    );
  recordChange({
    source: "monitors",
    type: "delete",
    key: id,
    owner: monitor.ownerEmail,
    orgId: monitor.orgId ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Sweep helpers: claim / due selection
// ---------------------------------------------------------------------------

function monitorNotRunningWhere(now: Date) {
  const table = schema.monitors;
  const staleBefore = new Date(
    now.getTime() - MONITOR_RUNNING_STALE_MS,
  ).toISOString();
  return or(
    isNull(table.lastStatus),
    sql`${table.lastStatus} <> 'running'`,
    isNull(table.lastCheckedAt),
    lte(table.lastCheckedAt, staleBefore),
  );
}

function monitorPreviousCheckWhere(monitor: Monitor) {
  const table = schema.monitors;
  return monitor.lastCheckedAt
    ? eq(table.lastCheckedAt, monitor.lastCheckedAt)
    : isNull(table.lastCheckedAt);
}

/** True when enough time has elapsed since the last check to run again. */
export function isMonitorDue(
  monitor: Monitor,
  now: Date = new Date(),
): boolean {
  if (!monitor.lastCheckedAt) return true;
  const last = Date.parse(monitor.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= monitor.intervalSeconds * 1000;
}

export async function listDueMonitors(options: {
  limit: number;
  ownerEmail?: string;
  orgId?: string | null;
  now?: Date;
}): Promise<Monitor[]> {
  const db = getDb() as any;
  const table = schema.monitors;
  const now = options.now ?? new Date();
  const clauses: any[] = [eq(table.enabled, true), monitorNotRunningWhere(now)];
  if (options.ownerEmail) {
    clauses.push(
      sql`lower(${table.ownerEmail}) = ${options.ownerEmail.toLowerCase()}`,
    );
  }
  if (options.orgId !== undefined) {
    clauses.push(
      options.orgId ? eq(table.orgId, options.orgId) : isNull(table.orgId),
    );
  }
  const limit = clampInt(options.limit, 1, 500, 100);
  const rows = await db
    .select()
    .from(table)
    .where(and(...clauses))
    .orderBy(
      sql`case when ${table.lastCheckedAt} is null then 0 else 1 end`,
      asc(table.lastCheckedAt),
      asc(table.createdAt),
    )
    .limit(Math.min(limit * 5, 500));
  return rows
    .map(rowToMonitor)
    .filter((m: Monitor) => isMonitorDue(m, now))
    .slice(0, limit);
}

/**
 * Atomically claim a monitor for this sweep so concurrent sweeps don't
 * double-run it. Mirrors claimAnalyticsAlertRuleEvaluation.
 */
export async function claimMonitorRun(
  monitor: Monitor,
  now: Date = new Date(),
): Promise<boolean> {
  const db = getDb() as any;
  const table = schema.monitors;
  const claimedAt = now.toISOString();
  const rows = await db
    .update(table)
    .set({ lastStatus: "running", lastCheckedAt: claimedAt })
    .where(
      and(
        eq(table.id, monitor.id),
        eq(table.enabled, true),
        monitorNotRunningWhere(now),
        monitorPreviousCheckWhere(monitor),
      ),
    )
    .returning({ id: table.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Persist result + status
// ---------------------------------------------------------------------------

export async function recordMonitorResult(
  monitor: Monitor,
  outcome: CheckOutcome,
): Promise<void> {
  const db = getDb() as any;
  await db.insert(schema.monitorCheckResults).values({
    id: randomUUID(),
    monitorId: monitor.id,
    checkedAt: outcome.checkedAt,
    ok: outcome.ok,
    status: outcome.status,
    statusCode: outcome.statusCode,
    latencyMs: outcome.latencyMs,
    error: outcome.error,
    failedAssertions: JSON.stringify(outcome.failedAssertions),
    diagnostics: serializeMonitorDiagnostics(outcome.diagnostics),
    createdAt: outcome.checkedAt,
    ownerEmail: monitor.ownerEmail,
    orgId: monitor.orgId,
  });

  const consecutiveFailures = outcome.ok
    ? 0
    : (monitor.consecutiveFailures ?? 0) + 1;
  // Note: no updatedAt bump — status writes must not churn the config
  // timestamp (mirrors analytics-alerts markRuleStatus).
  await db
    .update(schema.monitors)
    .set({
      lastStatus: outcome.status,
      lastCheckedAt: outcome.checkedAt,
      lastError: outcome.error,
      lastLatencyMs: outcome.latencyMs,
      lastStatusCode: outcome.statusCode,
      lastSuccessAt: outcome.ok ? outcome.checkedAt : monitor.lastSuccessAt,
      consecutiveFailures,
    })
    .where(eq(schema.monitors.id, monitor.id));

  // Emit a change so open UIs invalidate via useDbSync() after each probe —
  // this is the only sync signal for background-sweep results.
  recordChange({
    source: "monitors",
    type: "change",
    key: monitor.id,
    owner: monitor.ownerEmail,
    orgId: monitor.orgId ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Incident management + notifications
// ---------------------------------------------------------------------------

function describeCause(outcome: CheckOutcome): string {
  if (outcome.error) return outcome.error.slice(0, 300);
  if (outcome.statusCode != null) return `HTTP ${outcome.statusCode}`;
  return "Check failed";
}

function isTransientNoResponseFailure(outcome: CheckOutcome): boolean {
  return (
    outcome.status === "down" &&
    outcome.statusCode == null &&
    Boolean(outcome.error)
  );
}

function isTransientDegradedFailure(outcome: CheckOutcome): boolean {
  return (
    outcome.status === "degraded" &&
    outcome.failedAssertions.some((assertion) =>
      assertion.startsWith("Response took "),
    )
  );
}

export function shouldOpenMonitorIncident(
  outcome: CheckOutcome,
  priorConsecutiveFailures: number,
  confirmationChecks = transientFailureConfirmationChecks(),
): boolean {
  const needsConfirmation =
    isTransientNoResponseFailure(outcome) ||
    isTransientDegradedFailure(outcome);
  const needed = needsConfirmation
    ? Math.max(1, Math.min(10, Math.floor(confirmationChecks)))
    : 1;
  return Math.max(0, Math.floor(priorConsecutiveFailures)) + 1 >= needed;
}

async function getOpenIncident(
  monitorId: string,
  ctx: AccessCtx,
): Promise<MonitorIncident | null> {
  const db = getDb() as any;
  const [row] = await db
    .select()
    .from(schema.monitorIncidents)
    .where(
      and(
        incidentsOwnerWhere(ctx),
        eq(schema.monitorIncidents.monitorId, monitorId),
        isNull(schema.monitorIncidents.resolvedAt),
      ),
    )
    .orderBy(desc(schema.monitorIncidents.startedAt))
    .limit(1);
  return row ? rowToIncident(row) : null;
}

async function recentlyResolvedWithinCooldown(
  monitor: Monitor,
  ctx: AccessCtx,
  now: Date,
): Promise<boolean> {
  if (monitor.cooldownMinutes <= 0) return false;
  const db = getDb() as any;
  const [row] = await db
    .select({ resolvedAt: schema.monitorIncidents.resolvedAt })
    .from(schema.monitorIncidents)
    .where(
      and(
        incidentsOwnerWhere(ctx),
        eq(schema.monitorIncidents.monitorId, monitor.id),
      ),
    )
    .orderBy(desc(schema.monitorIncidents.startedAt))
    .limit(1);
  if (!row?.resolvedAt) return false;
  const resolved = Date.parse(row.resolvedAt);
  if (!Number.isFinite(resolved)) return false;
  return now.getTime() - resolved < monitor.cooldownMinutes * 60 * 1000;
}

async function getFailureStreakStartedAt(
  monitor: Monitor,
  ctx: AccessCtx,
  fallback: string,
): Promise<string> {
  const db = getDb() as any;
  const table = schema.monitorCheckResults;
  const clauses: any[] = [
    resultsOwnerWhere(ctx),
    eq(table.monitorId, monitor.id),
    eq(table.ok, false),
  ];
  if (monitor.lastSuccessAt)
    clauses.push(gt(table.checkedAt, monitor.lastSuccessAt));
  const [row] = await db
    .select({ checkedAt: table.checkedAt })
    .from(table)
    .where(and(...clauses))
    .orderBy(asc(table.checkedAt))
    .limit(1);
  return row?.checkedAt ?? fallback;
}

async function notifyMonitorDown(monitor: Monitor, outcome: CheckOutcome) {
  const host = hostFromUrl(monitor.url);
  const label = outcome.status === "degraded" ? "degraded" : "down";
  const severity: "warning" | "critical" =
    outcome.status === "degraded" ? "warning" : monitor.severity;
  const detail = outcome.error ? ` — ${outcome.error}` : "";
  const latency =
    outcome.latencyMs != null ? ` Latency ${outcome.latencyMs}ms.` : "";
  return notifyWithDelivery(
    {
      severity,
      title: `Monitor ${label}: ${monitor.name}`,
      body: `${host} is ${label}${detail}.${latency}`,
      channels: ensureInboxChannel(monitor.channels),
      metadata: {
        ...monitorNotifyMetadata(monitor),
        ...(monitorNotifyDeliveryMetadata(monitor)
          ? { delivery: monitorNotifyDeliveryMetadata(monitor) }
          : {}),
        status: outcome.status,
        statusCode: outcome.statusCode,
        latencyMs: outcome.latencyMs,
        failedAssertions: outcome.failedAssertions,
      },
    },
    { owner: monitor.ownerEmail },
  );
}

async function notifyMonitorRecovered(
  monitor: Monitor,
  outcome: CheckOutcome,
  incident: MonitorIncident,
) {
  const host = hostFromUrl(monitor.url);
  const startedMs = Date.parse(incident.startedAt);
  const downFor = Number.isFinite(startedMs)
    ? humanizeDuration(Date.parse(outcome.checkedAt) - startedMs)
    : null;
  const latency =
    outcome.latencyMs != null ? ` Latency ${outcome.latencyMs}ms.` : "";
  return notifyWithDelivery(
    {
      severity: "info",
      title: `Monitor recovered: ${monitor.name}`,
      body: `${host} is back up${downFor ? ` after ${downFor} of downtime` : ""}.${latency}`,
      channels: ensureInboxChannel(monitor.channels),
      metadata: {
        ...monitorNotifyMetadata(monitor),
        ...(monitorNotifyDeliveryMetadata(monitor)
          ? { delivery: monitorNotifyDeliveryMetadata(monitor) }
          : {}),
        status: "up",
        statusCode: outcome.statusCode,
        latencyMs: outcome.latencyMs,
        incidentId: incident.id,
      },
    },
    { owner: monitor.ownerEmail },
  );
}

function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export interface EvaluateMonitorResult {
  status: MonitorStatus;
  incidentId?: string;
  notified: boolean;
  recovered?: boolean;
}

/**
 * Open / update / resolve incidents based on the latest outcome and send
 * notifications. On a transition into confirmed failure it opens an incident
 * and notifies (respecting an anti-flap cooldown); on recovery it resolves the
 * open incident and sends a recovery notice.
 */
export async function evaluateAndNotifyMonitor(
  monitor: Monitor,
  outcome: CheckOutcome,
  ctx: AccessCtx,
  now: Date = new Date(),
): Promise<EvaluateMonitorResult> {
  const db = getDb() as any;
  const open = await getOpenIncident(monitor.id, ctx);

  if (!outcome.ok) {
    const cause = describeCause(outcome);
    const priorConsecutiveFailures = monitor.consecutiveFailures ?? 0;
    const nextChecksFailed = priorConsecutiveFailures + 1;
    if (open) {
      const nextStatus =
        open.status === "down" ? "down" : (outcome.status as MonitorStatus);
      await db
        .update(schema.monitorIncidents)
        .set({
          checksFailed: (open.checksFailed ?? 1) + 1,
          lastError: outcome.error,
          cause,
          status: nextStatus,
        })
        .where(eq(schema.monitorIncidents.id, open.id));
      return { status: outcome.status, incidentId: open.id, notified: false };
    }

    if (!shouldOpenMonitorIncident(outcome, priorConsecutiveFailures)) {
      return { status: outcome.status, notified: false };
    }

    const suppressed = await recentlyResolvedWithinCooldown(monitor, ctx, now);
    let notificationId: string | undefined;
    let notificationDelivered = false;
    if (!suppressed) {
      try {
        const delivery = await notifyMonitorDown(monitor, outcome);
        notificationId = delivery.notification?.id;
        notificationDelivered =
          Boolean(notificationId) || delivery.deliveredChannels.length > 0;
      } catch (err) {
        console.error(
          `[uptime-monitors] notify failed for ${monitor.id}:`,
          err,
        );
      }
    }
    const incidentId = randomUUID();
    const startedAt =
      nextChecksFailed > 1
        ? await getFailureStreakStartedAt(monitor, ctx, outcome.checkedAt)
        : outcome.checkedAt;
    await db.insert(schema.monitorIncidents).values({
      id: incidentId,
      monitorId: monitor.id,
      startedAt,
      resolvedAt: null,
      status: outcome.status === "degraded" ? "degraded" : "down",
      severity: monitor.severity,
      cause,
      lastError: outcome.error,
      notificationId: notificationId ?? null,
      notificationDelivered,
      checksFailed: nextChecksFailed,
      createdAt: outcome.checkedAt,
      ownerEmail: monitor.ownerEmail,
      orgId: monitor.orgId,
    });
    return {
      status: outcome.status,
      incidentId,
      notified: notificationDelivered,
    };
  }

  // Recovery.
  if (open) {
    await db
      .update(schema.monitorIncidents)
      .set({ resolvedAt: outcome.checkedAt })
      .where(eq(schema.monitorIncidents.id, open.id));
    let notified = false;
    if (open.notificationDelivered) {
      try {
        await notifyMonitorRecovered(monitor, outcome, open);
        notified = true;
      } catch (err) {
        console.error(
          `[uptime-monitors] recovery notify failed for ${monitor.id}:`,
          err,
        );
      }
    }
    return { status: "up", incidentId: open.id, notified, recovered: true };
  }
  return { status: "up", notified: false };
}

/**
 * Run one monitor end-to-end: probe, persist the result + status, then
 * open/resolve incidents and notify. Used by the sweep job and the on-demand
 * run-monitor-check action.
 */
export async function runAndProcessMonitor(
  monitor: Monitor,
  ctx: AccessCtx,
  opts: { allowPrivateHosts?: boolean; source?: MonitorCheckSource } = {},
): Promise<CheckOutcome> {
  const outcome = await runMonitorCheck(monitor, opts);
  // recordMonitorResult() emits the "monitors" change for the UI.
  await recordMonitorResult(monitor, outcome);
  await evaluateAndNotifyMonitor(monitor, outcome, ctx);
  return outcome;
}

/**
 * Run one check now for a specific monitor id (on-demand). Returns the outcome
 * and the refreshed monitor detail.
 */
export async function runMonitorNow(
  id: string,
  ctx: AccessCtx,
): Promise<CheckOutcome> {
  const [row] = await (getDb() as any)
    .select()
    .from(schema.monitors)
    .where(ownerWhere(ctx, id));
  if (!row) {
    throw Object.assign(new Error("Monitor not found"), { statusCode: 404 });
  }
  const monitor = rowToMonitor(row);
  const claimed = await claimMonitorRun(monitor);
  if (!claimed) {
    throw Object.assign(new Error("Monitor check is already running"), {
      statusCode: 409,
    });
  }
  return runAndProcessMonitor(monitor, ctx, { source: "manual" });
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Delete check results older than the retention window so the table can't grow
 * unbounded. This is a global maintenance prune by age (not a per-user read),
 * so it intentionally isn't owner-scoped.
 */
export async function pruneOldCheckResults(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - resultRetentionDays() * 24 * 60 * 60 * 1000,
  ).toISOString();
  const db = getDb() as any;
  const deleted = await db
    .delete(schema.monitorCheckResults)
    .where(lte(schema.monitorCheckResults.checkedAt, cutoff))
    .returning({ id: schema.monitorCheckResults.id });
  return Array.isArray(deleted) ? deleted.length : 0;
}
