/**
 * Provider endpoints that take a POST but only read. `provider-api-request`
 * treats every non-GET request as a write, which makes a failed report or
 * search unretryable for the rest of the run, so these endpoints are listed
 * explicitly rather than guessed from the method or the path's wording.
 *
 * A rule matches either an absolute URL on one of its hosts, or a relative
 * path sent through its built-in provider, resolved against that provider's
 * base path the same way the runtime joins it.
 */

interface ReadOnlyPostRule {
  /** Built-in provider whose relative paths this rule covers; omit for absolute URLs only. */
  provider?: string;
  basePath: string;
  hostSuffixes: readonly string[];
  path: RegExp;
  body?: (body: Record<string, unknown>) => boolean;
}

const GA4_REPORT =
  /^\/v1(?:alpha|beta)?\/properties\/[^/:]+:(?:runReport|batchRunReports|runPivotReport|batchRunPivotReports|runRealtimeReport|checkCompatibility)$/;

const READ_ONLY_POST_RULES: readonly ReadOnlyPostRule[] = [
  {
    provider: "ga4",
    basePath: "/v1beta",
    hostSuffixes: ["analyticsdata.googleapis.com"],
    path: GA4_REPORT,
  },
  {
    basePath: "",
    hostSuffixes: ["searchconsole.googleapis.com", "www.googleapis.com"],
    path: /^\/webmasters\/v3\/sites\/[^/]+\/searchAnalytics\/query$/,
  },
  {
    basePath: "",
    hostSuffixes: ["searchconsole.googleapis.com"],
    path: /^\/v1\/urlInspection\/index:inspect$/,
  },
  {
    // A dry run validates and prices a query without running it. A real
    // query can be DML, so only the dry-run flag makes it a read.
    provider: "bigquery",
    basePath: "/bigquery/v2",
    hostSuffixes: ["bigquery.googleapis.com"],
    path: /^\/bigquery\/v2\/projects\/[^/]+\/queries$/,
    body: (body) => body.dryRun === true,
  },
  {
    provider: "bigquery",
    basePath: "/bigquery/v2",
    hostSuffixes: ["bigquery.googleapis.com"],
    path: /^\/bigquery\/v2\/projects\/[^/]+\/jobs$/,
    body: (body) =>
      isRecord(body.configuration) && body.configuration.dryRun === true,
  },
  {
    provider: "hubspot",
    basePath: "",
    hostSuffixes: ["hubapi.com"],
    path: /^\/crm\/v3\/(?:objects\/[^/]+\/(?:search|batch\/read)|properties\/[^/]+\/batch\/read)$/,
  },
  {
    provider: "hubspot",
    basePath: "",
    hostSuffixes: ["hubapi.com"],
    path: /^\/crm\/v[34]\/associations\/[^/]+\/[^/]+\/batch\/read$/,
  },
  {
    provider: "gong",
    basePath: "/v2",
    hostSuffixes: ["api.gong.io"],
    path: /^\/v2\/(?:calls\/(?:extensive|transcript)|users\/extensive|stats\/(?:interaction|activity\/(?:aggregate|aggregate-by-period|day-by-day|scorecards)))$/,
  },
  {
    provider: "notion",
    basePath: "/v1",
    hostSuffixes: ["api.notion.com"],
    path: /^\/v1\/(?:search|databases\/[^/]+\/query|data_sources\/[^/]+\/query)$/,
  },
  {
    provider: "posthog",
    basePath: "",
    hostSuffixes: ["posthog.com"],
    path: /^\/api\/(?:projects|environments)\/[^/]+\/query\/?$/,
  },
  {
    provider: "jira",
    basePath: "",
    hostSuffixes: ["atlassian.net"],
    path: /^\/rest\/api\/3\/(?:search(?:\/jql)?|issue\/bulkfetch)$/,
  },
  {
    provider: "prometheus",
    basePath: "",
    hostSuffixes: [],
    path: /^\/api\/v1\/(?:query|query_range|series|labels)$/,
  },
  {
    provider: "grafana",
    basePath: "",
    hostSuffixes: [],
    path: /^\/api\/ds\/query$/,
  },
  {
    provider: "google_calendar",
    basePath: "/calendar/v3",
    hostSuffixes: ["www.googleapis.com"],
    path: /^\/calendar\/v3\/freeBusy$/,
  },
  {
    provider: "google_sheets",
    basePath: "/v4",
    hostSuffixes: ["sheets.googleapis.com"],
    path: /^\/v4\/spreadsheets\/[^/:]+\/values:batchGetByDataFilter$/,
  },
];

export interface ProviderRequestShape {
  provider?: unknown;
  method?: unknown;
  path?: unknown;
  body?: unknown;
}

/** Whether a POST through `provider-api-request` targets a listed read-only endpoint. */
export function isReadOnlyProviderPost(request: ProviderRequestShape): boolean {
  if (String(request.method ?? "GET").toUpperCase() !== "POST") return false;
  if (typeof request.path !== "string") return false;
  const rawPath = request.path.trim();
  const absolute = parseAbsoluteUrl(rawPath);
  const body = requestBodyRecord(request.body);
  return READ_ONLY_POST_RULES.some((rule) => {
    let pathname: string;
    if (absolute) {
      if (!rule.hostSuffixes.some((suffix) => hostMatches(absolute, suffix))) {
        return false;
      }
      pathname = absolute.pathname;
    } else {
      if (!rule.provider || request.provider !== rule.provider) return false;
      pathname = joinBasePath(rule.basePath, rawPath.split(/[?#]/, 1)[0]);
    }
    if (!rule.path.test(pathname)) return false;
    if (!rule.body) return true;
    return body !== undefined && rule.body(body);
  });
}

function parseAbsoluteUrl(rawPath: string): URL | null {
  if (!/^https?:\/\//i.test(rawPath)) return null;
  try {
    return new URL(rawPath);
  } catch {
    // coercion-ok: an unparseable URL matches no read-only rule, so the
    // request keeps its conservative write classification.
    return null;
  }
}

function hostMatches(url: URL, suffix: string): boolean {
  const host = url.hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** Mirrors the runtime's join: a path already carrying the base path keeps it. */
function joinBasePath(basePath: string, rawPath: string): string {
  const providerPath = rawPath.replace(/^\/+/, "");
  const baseSegments = basePath.split("/").filter(Boolean);
  const providerSegments = providerPath.split("/").filter(Boolean);
  if (
    baseSegments.length > 0 &&
    providerSegments.length >= baseSegments.length &&
    baseSegments.every((segment, index) => segment === providerSegments[index])
  ) {
    return `/${providerPath}`;
  }
  return `${basePath}/${providerPath}`;
}

function requestBodyRecord(body: unknown): Record<string, unknown> | undefined {
  if (isRecord(body)) return body;
  if (typeof body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // coercion-ok: a string body that is not JSON cannot carry a dry-run
    // flag, so body-gated rules do not match and the request stays a write.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
