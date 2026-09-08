export const BUG_REPORT_QUERY_FLAG = "bugReport";
export const BUG_REPORT_SUBMITTED_MESSAGE_TYPE =
  "agent-native.clips.bug-report.submitted";
export const BUG_REPORT_AGENT_ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;

export const BUG_REPORT_SEVERITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number];

export interface BugReportContext {
  projectId: string | null;
  title: string | null;
  description: string | null;
  severity: BugReportSeverity;
  sourceUrl: string | null;
  pageTitle: string | null;
  appVersion: string | null;
  environment: string | null;
  reporterEmail: string | null;
  reporterName: string | null;
  reporterId: string | null;
  metadata: Record<string, unknown> | null;
  returnUrl: string | null;
}

export interface BugReportSubmissionMessage {
  type: typeof BUG_REPORT_SUBMITTED_MESSAGE_TYPE;
  recordingId: string;
  recordingUrl: string;
  embedUrl: string;
  agentShareUrl: string | null;
  agentContextUrl: string | null;
  agentAccessExpiresAt: string | null;
  agentAccessStatus: "ready" | "unavailable";
}

export interface BugReportAgentLink {
  url?: string | null;
  contextUrl?: string | null;
  expiresAt?: string | null;
}

export const BUG_REPORT_POPUP_RESPONSE_HEADERS = {
  "Cross-Origin-Opener-Policy": "unsafe-none",
} as const;

const PARAMS = {
  projectId: "projectId",
  title: "title",
  description: "description",
  severity: "severity",
  sourceUrl: "sourceUrl",
  pageTitle: "pageTitle",
  appVersion: "appVersion",
  environment: "environment",
  reporterEmail: "reporterEmail",
  reporterName: "reporterName",
  reporterId: "reporterId",
  metadata: "metadata",
  returnUrl: "returnUrl",
} as const;

function prefixed(key: string): string {
  return `bugReport${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`;
}

function clean(value: string | null, max = 1000): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function param(
  params: URLSearchParams,
  key: keyof typeof PARAMS,
  allowLoose: boolean,
): string | null {
  const raw = params.get(prefixed(PARAMS[key]));
  if (raw !== null) return raw;
  return allowLoose ? params.get(PARAMS[key]) : null;
}

function parseSeverity(value: string | null): BugReportSeverity {
  return BUG_REPORT_SEVERITIES.includes(value as BugReportSeverity)
    ? (value as BugReportSeverity)
    : "normal";
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  const value = clean(raw, 12_000);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { note: value };
  }
  return null;
}

export function hasBugReportQuery(
  params: URLSearchParams,
  options: { allowLoose?: boolean } = {},
): boolean {
  if (params.get(BUG_REPORT_QUERY_FLAG) === "1") return true;
  if (params.get("intent") === "bug-report") return true;
  for (const key of params.keys()) {
    if (key.startsWith("bugReport") && key !== BUG_REPORT_QUERY_FLAG) {
      return true;
    }
    if (
      options.allowLoose &&
      Object.values(PARAMS).includes(
        key as (typeof PARAMS)[keyof typeof PARAMS],
      )
    ) {
      return true;
    }
  }
  return false;
}

export function parseBugReportContext(
  params: URLSearchParams,
  options: { allowLoose?: boolean } = {},
): BugReportContext | null {
  const allowLoose = options.allowLoose ?? false;
  if (!hasBugReportQuery(params, { allowLoose })) return null;

  return {
    projectId: clean(param(params, "projectId", allowLoose), 120),
    title: clean(param(params, "title", allowLoose), 500),
    description: clean(param(params, "description", allowLoose), 5000),
    severity: parseSeverity(param(params, "severity", allowLoose)),
    sourceUrl: clean(param(params, "sourceUrl", allowLoose), 8000),
    pageTitle: clean(param(params, "pageTitle", allowLoose), 500),
    appVersion: clean(param(params, "appVersion", allowLoose), 120),
    environment: clean(param(params, "environment", allowLoose), 120),
    reporterEmail: clean(param(params, "reporterEmail", allowLoose), 320),
    reporterName: clean(param(params, "reporterName", allowLoose), 200),
    reporterId: clean(param(params, "reporterId", allowLoose), 200),
    metadata: parseMetadata(param(params, "metadata", allowLoose)),
    returnUrl: clean(param(params, "returnUrl", allowLoose), 8000),
  };
}

export function bugReportContextToSearchParams(
  context: BugReportContext,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set(BUG_REPORT_QUERY_FLAG, "1");
  const append = (key: keyof typeof PARAMS, value: string | null) => {
    if (value) params.set(prefixed(PARAMS[key]), value);
  };

  append("projectId", context.projectId);
  append("title", context.title);
  append("description", context.description);
  append("severity", context.severity);
  append("sourceUrl", context.sourceUrl);
  append("pageTitle", context.pageTitle);
  append("appVersion", context.appVersion);
  append("environment", context.environment);
  append("reporterEmail", context.reporterEmail);
  append("reporterName", context.reporterName);
  append("reporterId", context.reporterId);
  append("returnUrl", context.returnUrl);
  if (context.metadata) {
    params.set(prefixed(PARAMS.metadata), JSON.stringify(context.metadata));
  }
  return params;
}

export function bugReportTitle(context: BugReportContext | null): string {
  return (
    context?.title || context?.pageTitle || context?.sourceUrl || "Bug report"
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createBugReportSubmissionMessage(input: {
  recordingId: string;
  recordingUrl: string;
  embedUrl: string;
  agentLink: BugReportAgentLink | null;
}): BugReportSubmissionMessage {
  const agentShareUrl = nonEmptyString(input.agentLink?.url)
    ? input.agentLink.url
    : null;
  const agentContextUrl = nonEmptyString(input.agentLink?.contextUrl)
    ? input.agentLink.contextUrl
    : null;
  const agentAccessExpiresAt = nonEmptyString(input.agentLink?.expiresAt)
    ? input.agentLink.expiresAt
    : null;
  const agentAccessReady =
    agentShareUrl !== null &&
    agentContextUrl !== null &&
    agentAccessExpiresAt !== null;

  return {
    type: BUG_REPORT_SUBMITTED_MESSAGE_TYPE,
    recordingId: input.recordingId,
    recordingUrl: input.recordingUrl,
    embedUrl: input.embedUrl,
    agentShareUrl: agentAccessReady ? agentShareUrl : null,
    agentContextUrl: agentAccessReady ? agentContextUrl : null,
    agentAccessExpiresAt: agentAccessReady ? agentAccessExpiresAt : null,
    agentAccessStatus: agentAccessReady ? "ready" : "unavailable",
  };
}

export function bugReportSubmissionTargetOrigins(
  clipsOrigin: string,
  returnUrl: string | null,
): string[] {
  let returnOrigin: string | null = null;
  if (returnUrl) {
    try {
      const parsed = new URL(returnUrl);
      returnOrigin = parsed.origin === "null" ? null : parsed.origin;
    } catch {
      returnOrigin = null;
    }
  }
  return [...new Set([clipsOrigin, returnOrigin].filter(nonEmptyString))];
}

export function isBugReportSubmissionMessage(
  value: unknown,
): value is BugReportSubmissionMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const validAgentAccess =
    (message.agentAccessStatus === "ready" &&
      nonEmptyString(message.agentShareUrl) &&
      nonEmptyString(message.agentContextUrl) &&
      nonEmptyString(message.agentAccessExpiresAt)) ||
    (message.agentAccessStatus === "unavailable" &&
      message.agentShareUrl === null &&
      message.agentContextUrl === null &&
      message.agentAccessExpiresAt === null);
  return (
    message.type === BUG_REPORT_SUBMITTED_MESSAGE_TYPE &&
    nonEmptyString(message.recordingId) &&
    nonEmptyString(message.recordingUrl) &&
    nonEmptyString(message.embedUrl) &&
    validAgentAccess
  );
}
