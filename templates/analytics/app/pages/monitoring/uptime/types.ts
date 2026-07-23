/**
 * Client-side types for the uptime monitoring feature. These mirror the server
 * shapes returned by the monitor actions (see server/lib/uptime-monitors.ts).
 * Kept feature-local so the panel owns its own contract.
 */
import type {
  ResponseTimePoint,
  UptimeBucket,
  UptimeWindows,
} from "@/components/monitoring";

export type MonitorMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type MonitorSeverity = "warning" | "critical";

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
  header?: string;
}

export type StatusMatcher =
  | { mode: "class"; classes: string[] }
  | { mode: "list"; codes: number[] }
  | { mode: "range"; min: number; max: number };

export interface MonitorSummary {
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
  uptime24h: number | null;
  uptime7d: number | null;
  checks24h: number;
}

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

export interface MonitorCheckDiagnostics {
  source:
    | "netlify-scheduled"
    | "netlify-runtime"
    | "in-process"
    | "manual"
    | "unknown";
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
  checksFailed: number;
  createdAt: string;
}

export interface MonitorDetail {
  monitor: MonitorSummary;
  recentResults: MonitorCheckResult[];
  incidents: MonitorIncident[];
}

/**
 * Aggregated stats for one monitor, as returned by the `get-monitor-stats`
 * action (one entry per requested monitor). Structurally identical to the
 * server `MonitorStats` shape; the reusable chart components consume the
 * `windows` / `timeline` / `responseSeries` fields directly.
 */
export interface MonitorStats {
  monitorId: string;
  status: MonitorStatus | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  windows: UptimeWindows;
  timeline: UptimeBucket[];
  responseSeries: ResponseTimePoint[];
  avgResponseMs: number | null;
  incidentCount: number;
  mtbfMs: number | null;
}

export interface CheckOutcome {
  checkedAt: string;
  status: MonitorStatus;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  failedAssertions: string[];
}

/** Payload accepted by the save-monitor action. */
export interface SaveMonitorInput {
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
