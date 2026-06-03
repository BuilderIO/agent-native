import { createHash } from "node:crypto";
import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "@agent-native/core/extensions/url-safety";
import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  type CredentialContext,
} from "./credentials-context";
import { getAccessToken as getGoogleCloudAccessToken } from "./gcloud";
import { resolveAnalyticsProviderCredential } from "./provider-credentials";
import { signRs256Jwt } from "./sign-jwt";

export const ANALYTICS_PROVIDER_API_IDS = [
  "amplitude",
  "apollo",
  "bigquery",
  "commonroom",
  "dataforseo",
  "ga4",
  "gcloud",
  "github",
  "gong",
  "grafana",
  "hubspot",
  "jira",
  "mixpanel",
  "notion",
  "posthog",
  "prometheus",
  "pylon",
  "sentry",
  "slack",
  "stripe",
  "twitter",
] as const;

export type AnalyticsProviderApiId =
  (typeof ANALYTICS_PROVIDER_API_IDS)[number];

export type ProviderApiMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD";

export interface ProviderApiRequestArgs {
  provider: AnalyticsProviderApiId;
  method?: ProviderApiMethod;
  path: string;
  query?: unknown;
  headers?: Record<string, unknown>;
  body?: unknown;
  auth?: "default" | "none";
  timeoutMs?: number;
  maxBytes?: number;
}

type AuthKind =
  | { type: "none" }
  | {
      type: "bearer";
      keys: readonly string[];
      workspaceProvider?: string;
    }
  | {
      type: "basic";
      usernameKey: string;
      passwordKey: string;
    }
  | {
      type: "basic-raw";
      key: string;
    }
  | {
      type: "api-key-header";
      key: string;
      header: string;
    }
  | {
      type: "google-cloud";
    }
  | {
      type: "google-service-account";
      scopes: readonly string[];
    }
  | {
      type: "prometheus";
    };

interface ProviderApiConfig {
  id: AnalyticsProviderApiId;
  label: string;
  defaultBaseUrl: string;
  baseUrlCredentialKey?: string;
  auth: AuthKind;
  credentialKeys: readonly string[];
  docsUrls: readonly string[];
  specUrls?: readonly string[];
  allowedHostSuffixes?: readonly string[];
  defaultHeaders?: Record<string, string>;
  placeholders?: readonly ProviderPlaceholder[];
  examples?: readonly ProviderApiExample[];
  notes?: readonly string[];
}

interface ProviderPlaceholder {
  name: string;
  credentialKey: string;
  label: string;
}

interface ProviderApiExample {
  label: string;
  method: ProviderApiMethod;
  path: string;
  body?: unknown;
}

interface ResolvedProviderCredential {
  key: string;
  value: string;
  source: string;
  provider: string;
  connectionId?: string;
  connectionLabel?: string;
}

interface ResolvedAuth {
  headers: Record<string, string>;
  credentialSources: Array<Omit<ResolvedProviderCredential, "value">>;
  secretValues: string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_MAX_BYTES = 4 * 1024 * 1024;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BLOCKED_OUTBOUND_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const WORKSPACE_CREDENTIAL_PROVIDERS = new Set([
  "github",
  "hubspot",
  "notion",
  "slack",
]);

const PROVIDER_CONFIGS: Record<AnalyticsProviderApiId, ProviderApiConfig> = {
  amplitude: {
    id: "amplitude",
    label: "Amplitude",
    defaultBaseUrl: "https://amplitude.com/api/2",
    auth: {
      type: "basic",
      usernameKey: "AMPLITUDE_API_KEY",
      passwordKey: "AMPLITUDE_SECRET_KEY",
    },
    credentialKeys: ["AMPLITUDE_API_KEY", "AMPLITUDE_SECRET_KEY"],
    docsUrls: ["https://amplitude.com/docs/apis"],
    allowedHostSuffixes: ["amplitude.com"],
    examples: [
      {
        label: "Export events",
        method: "GET",
        path: "/export?start=20260601T00&end=20260602T00",
      },
    ],
  },
  apollo: {
    id: "apollo",
    label: "Apollo",
    defaultBaseUrl: "https://api.apollo.io",
    auth: {
      type: "api-key-header",
      key: "APOLLO_API_KEY",
      header: "x-api-key",
    },
    credentialKeys: ["APOLLO_API_KEY"],
    docsUrls: ["https://docs.apollo.io/reference/api-reference"],
    examples: [
      {
        label: "Search people",
        method: "POST",
        path: "/api/v1/mixed_people/search",
        body: { q_keywords: "vp marketing", page: 1, per_page: 10 },
      },
    ],
  },
  bigquery: {
    id: "bigquery",
    label: "BigQuery REST API",
    defaultBaseUrl: "https://bigquery.googleapis.com/bigquery/v2",
    auth: { type: "google-cloud" },
    credentialKeys: [
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "BIGQUERY_PROJECT_ID",
    ],
    docsUrls: ["https://cloud.google.com/bigquery/docs/reference/rest"],
    specUrls: ["https://bigquery.googleapis.com/$discovery/rest?version=v2"],
    allowedHostSuffixes: ["googleapis.com"],
    placeholders: [
      {
        name: "projectId",
        credentialKey: "BIGQUERY_PROJECT_ID",
        label: "Configured BigQuery project ID",
      },
    ],
    examples: [
      {
        label: "List datasets",
        method: "GET",
        path: "/projects/{projectId}/datasets",
      },
      {
        label: "Run query",
        method: "POST",
        path: "/projects/{projectId}/queries",
        body: { query: "SELECT 1", useLegacySql: false },
      },
    ],
  },
  commonroom: {
    id: "commonroom",
    label: "Common Room",
    defaultBaseUrl: "https://api.commonroom.io/community/v1",
    auth: {
      type: "bearer",
      keys: ["COMMONROOM_API_TOKEN"],
    },
    credentialKeys: ["COMMONROOM_API_TOKEN"],
    docsUrls: ["https://developer.commonroom.io/reference/overview"],
    examples: [{ label: "List members", method: "GET", path: "/members" }],
  },
  dataforseo: {
    id: "dataforseo",
    label: "DataForSEO",
    defaultBaseUrl: "https://api.dataforseo.com/v3",
    auth: {
      type: "basic",
      usernameKey: "DATAFORSEO_LOGIN",
      passwordKey: "DATAFORSEO_PASSWORD",
    },
    credentialKeys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    docsUrls: ["https://docs.dataforseo.com/v3/"],
    examples: [
      {
        label: "SERP task post",
        method: "POST",
        path: "/serp/google/organic/task_post",
        body: [
          { keyword: "builder.io", location_code: 2840, language_code: "en" },
        ],
      },
    ],
  },
  ga4: {
    id: "ga4",
    label: "Google Analytics Data API",
    defaultBaseUrl: "https://analyticsdata.googleapis.com/v1beta",
    auth: {
      type: "google-service-account",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    },
    credentialKeys: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GA4_PROPERTY_ID"],
    docsUrls: [
      "https://developers.google.com/analytics/devguides/reporting/data/v1/rest",
    ],
    specUrls: [
      "https://analyticsdata.googleapis.com/$discovery/rest?version=v1beta",
    ],
    allowedHostSuffixes: ["googleapis.com"],
    placeholders: [
      {
        name: "propertyId",
        credentialKey: "GA4_PROPERTY_ID",
        label: "Configured GA4 property ID",
      },
    ],
    examples: [
      {
        label: "Run report",
        method: "POST",
        path: "/properties/{propertyId}:runReport",
        body: {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          metrics: [{ name: "activeUsers" }],
        },
      },
    ],
  },
  gcloud: {
    id: "gcloud",
    label: "Google Cloud APIs",
    defaultBaseUrl: "https://cloudresourcemanager.googleapis.com",
    auth: { type: "google-cloud" },
    credentialKeys: [
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "BIGQUERY_PROJECT_ID",
    ],
    docsUrls: ["https://cloud.google.com/apis/docs/overview"],
    specUrls: ["https://www.googleapis.com/discovery/v1/apis"],
    allowedHostSuffixes: ["googleapis.com"],
    placeholders: [
      {
        name: "projectId",
        credentialKey: "BIGQUERY_PROJECT_ID",
        label: "Configured Google Cloud project ID",
      },
    ],
    examples: [
      {
        label: "Get project",
        method: "GET",
        path: "https://cloudresourcemanager.googleapis.com/v1/projects/{projectId}",
      },
    ],
  },
  github: {
    id: "github",
    label: "GitHub REST API",
    defaultBaseUrl: "https://api.github.com",
    auth: {
      type: "bearer",
      keys: ["GITHUB_TOKEN"],
      workspaceProvider: "github",
    },
    credentialKeys: ["GITHUB_TOKEN"],
    docsUrls: ["https://docs.github.com/rest"],
    specUrls: [
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    ],
    defaultHeaders: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    examples: [{ label: "Authenticated user", method: "GET", path: "/user" }],
  },
  gong: {
    id: "gong",
    label: "Gong",
    defaultBaseUrl: "https://api.gong.io/v2",
    baseUrlCredentialKey: "GONG_API_BASE",
    auth: {
      type: "basic",
      usernameKey: "GONG_ACCESS_KEY",
      passwordKey: "GONG_ACCESS_SECRET",
    },
    credentialKeys: ["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET", "GONG_API_BASE"],
    docsUrls: ["https://gong.app.gong.io/settings/api/documentation"],
    examples: [
      { label: "List calls", method: "GET", path: "/calls" },
      {
        label: "Call transcript",
        method: "POST",
        path: "/calls/transcript",
        body: { filter: { callIds: ["<call-id>"] } },
      },
    ],
  },
  grafana: {
    id: "grafana",
    label: "Grafana",
    defaultBaseUrl: "https://grafana.example.com",
    baseUrlCredentialKey: "GRAFANA_URL",
    auth: {
      type: "bearer",
      keys: ["GRAFANA_API_TOKEN"],
    },
    credentialKeys: ["GRAFANA_URL", "GRAFANA_API_TOKEN"],
    docsUrls: ["https://grafana.com/docs/grafana/latest/developers/http_api/"],
    examples: [
      { label: "List dashboards", method: "GET", path: "/api/search" },
    ],
  },
  hubspot: {
    id: "hubspot",
    label: "HubSpot",
    defaultBaseUrl: "https://api.hubapi.com",
    auth: {
      type: "bearer",
      keys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
      workspaceProvider: "hubspot",
    },
    credentialKeys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
    docsUrls: ["https://developers.hubspot.com/docs/api/overview"],
    examples: [
      {
        label: "Search deals with any HubSpot CRM filter",
        method: "POST",
        path: "/crm/v3/objects/deals/search",
        body: {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "products",
                  operator: "CONTAINS_TOKEN",
                  value: "Publish",
                },
              ],
            },
          ],
          properties: ["dealname", "products", "dealstage", "closedate"],
          limit: 100,
        },
      },
      {
        label: "List deal property metadata",
        method: "GET",
        path: "/crm/v3/properties/deals",
      },
    ],
  },
  jira: {
    id: "jira",
    label: "Jira Cloud",
    defaultBaseUrl: "https://example.atlassian.net",
    baseUrlCredentialKey: "JIRA_BASE_URL",
    auth: {
      type: "basic",
      usernameKey: "JIRA_USER_EMAIL",
      passwordKey: "JIRA_API_TOKEN",
    },
    credentialKeys: ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
    docsUrls: [
      "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
    ],
    specUrls: [
      "https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json",
    ],
    examples: [
      {
        label: "JQL search",
        method: "GET",
        path: "/rest/api/3/search/jql",
        body: undefined,
      },
    ],
  },
  mixpanel: {
    id: "mixpanel",
    label: "Mixpanel",
    defaultBaseUrl: "https://mixpanel.com/api/query",
    auth: {
      type: "basic-raw",
      key: "MIXPANEL_SERVICE_ACCOUNT",
    },
    credentialKeys: ["MIXPANEL_PROJECT_ID", "MIXPANEL_SERVICE_ACCOUNT"],
    docsUrls: ["https://developer.mixpanel.com/reference/overview"],
    allowedHostSuffixes: ["mixpanel.com"],
    placeholders: [
      {
        name: "projectId",
        credentialKey: "MIXPANEL_PROJECT_ID",
        label: "Configured Mixpanel project ID",
      },
    ],
    examples: [
      {
        label: "Query events",
        method: "GET",
        path: "/events",
        body: undefined,
      },
    ],
    notes: [
      "Mixpanel uses multiple API hosts. You may pass full URLs for mixpanel.com or data.mixpanel.com endpoints.",
    ],
  },
  notion: {
    id: "notion",
    label: "Notion",
    defaultBaseUrl: "https://api.notion.com/v1",
    auth: {
      type: "bearer",
      keys: ["NOTION_API_KEY"],
      workspaceProvider: "notion",
    },
    credentialKeys: ["NOTION_API_KEY"],
    docsUrls: ["https://developers.notion.com/reference/intro"],
    defaultHeaders: { "Notion-Version": "2022-06-28" },
    examples: [{ label: "Search", method: "POST", path: "/search", body: {} }],
  },
  posthog: {
    id: "posthog",
    label: "PostHog",
    defaultBaseUrl: "https://app.posthog.com",
    baseUrlCredentialKey: "POSTHOG_HOST",
    auth: {
      type: "bearer",
      keys: ["POSTHOG_API_KEY"],
    },
    credentialKeys: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID", "POSTHOG_HOST"],
    docsUrls: ["https://posthog.com/docs/api"],
    placeholders: [
      {
        name: "projectId",
        credentialKey: "POSTHOG_PROJECT_ID",
        label: "Configured PostHog project ID",
      },
    ],
    examples: [
      {
        label: "List events",
        method: "GET",
        path: "/api/projects/{projectId}/events/",
      },
    ],
  },
  prometheus: {
    id: "prometheus",
    label: "Prometheus",
    defaultBaseUrl: "https://prometheus.example.com",
    baseUrlCredentialKey: "PROMETHEUS_URL",
    auth: { type: "prometheus" },
    credentialKeys: [
      "PROMETHEUS_URL",
      "PROMETHEUS_USERNAME",
      "PROMETHEUS_PASSWORD",
      "PROMETHEUS_BEARER_TOKEN",
    ],
    docsUrls: ["https://prometheus.io/docs/prometheus/latest/querying/api/"],
    examples: [
      {
        label: "Instant query",
        method: "GET",
        path: "/api/v1/query",
      },
    ],
  },
  pylon: {
    id: "pylon",
    label: "Pylon",
    defaultBaseUrl: "https://api.usepylon.com",
    auth: {
      type: "bearer",
      keys: ["PYLON_API_KEY"],
    },
    credentialKeys: ["PYLON_API_KEY"],
    docsUrls: ["https://docs.usepylon.com/pylon-docs/developer/api-reference"],
    examples: [{ label: "List issues", method: "GET", path: "/issues" }],
  },
  sentry: {
    id: "sentry",
    label: "Sentry",
    defaultBaseUrl: "https://sentry.io/api/0",
    auth: {
      type: "bearer",
      keys: ["SENTRY_AUTH_TOKEN", "SENTRY_SERVER_TOKEN"],
    },
    credentialKeys: [
      "SENTRY_AUTH_TOKEN",
      "SENTRY_SERVER_TOKEN",
      "SENTRY_ORG_SLUG",
    ],
    docsUrls: ["https://docs.sentry.io/api/"],
    placeholders: [
      {
        name: "orgSlug",
        credentialKey: "SENTRY_ORG_SLUG",
        label: "Configured Sentry organization slug",
      },
    ],
    examples: [
      {
        label: "List issues for org",
        method: "GET",
        path: "/organizations/{orgSlug}/issues/",
      },
    ],
  },
  slack: {
    id: "slack",
    label: "Slack Web API",
    defaultBaseUrl: "https://slack.com/api",
    auth: {
      type: "bearer",
      keys: ["SLACK_BOT_TOKEN"],
      workspaceProvider: "slack",
    },
    credentialKeys: ["SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN_2"],
    docsUrls: ["https://api.slack.com/web"],
    specUrls: [
      "https://api.slack.com/specs/openapi/v2/slack_web_openapi_v2_without_examples.json",
    ],
    examples: [
      { label: "Search messages", method: "GET", path: "/search.messages" },
      { label: "Post message", method: "POST", path: "/chat.postMessage" },
    ],
  },
  stripe: {
    id: "stripe",
    label: "Stripe",
    defaultBaseUrl: "https://api.stripe.com/v1",
    auth: {
      type: "bearer",
      keys: ["STRIPE_SECRET_KEY"],
    },
    credentialKeys: ["STRIPE_SECRET_KEY"],
    docsUrls: ["https://docs.stripe.com/api"],
    specUrls: [
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    ],
    examples: [{ label: "List customers", method: "GET", path: "/customers" }],
  },
  twitter: {
    id: "twitter",
    label: "Twitter/X via twitterapi.io",
    defaultBaseUrl: "https://api.twitterapi.io",
    auth: {
      type: "api-key-header",
      key: "TWITTER_BEARER_TOKEN",
      header: "X-API-Key",
    },
    credentialKeys: ["TWITTER_BEARER_TOKEN"],
    docsUrls: ["https://twitterapi.io/docs"],
    examples: [
      {
        label: "User tweets",
        method: "GET",
        path: "/twitter/user/last_tweets",
      },
    ],
  },
};

export function getProviderApiConfig(
  provider: AnalyticsProviderApiId,
): ProviderApiConfig {
  return PROVIDER_CONFIGS[provider];
}

export function listProviderApiCatalog(provider?: AnalyticsProviderApiId) {
  const configs = provider
    ? [getProviderApiConfig(provider)]
    : ANALYTICS_PROVIDER_API_IDS.map((id) => getProviderApiConfig(id));
  return configs.map((config) => ({
    id: config.id,
    label: config.label,
    defaultBaseUrl: config.defaultBaseUrl,
    baseUrlCredentialKey: config.baseUrlCredentialKey ?? null,
    auth: describeAuth(config.auth),
    credentialKeys: config.credentialKeys,
    docsUrls: config.docsUrls,
    specUrls: config.specUrls ?? [],
    allowedHostSuffixes: config.allowedHostSuffixes ?? [],
    placeholders: config.placeholders ?? [],
    defaultHeaders: config.defaultHeaders ?? {},
    examples: config.examples ?? [],
    notes: config.notes ?? [],
  }));
}

export async function fetchProviderApiDocs(options: {
  provider: AnalyticsProviderApiId;
  url?: string;
  maxBytes?: number;
}) {
  const config = getProviderApiConfig(options.provider);
  const catalog = listProviderApiCatalog(options.provider)[0];
  if (!options.url) return { provider: options.provider, catalog };

  const url = new URL(options.url);
  const allowed = [
    ...config.docsUrls,
    ...(config.specUrls ?? []),
    config.defaultBaseUrl,
  ].some((allowedUrl) => sameOriginOrChild(url, new URL(allowedUrl)));
  if (!allowed) {
    throw new Error(
      `Docs URL must be one of the registered ${config.label} docs/spec origins.`,
    );
  }
  if (await isBlockedExtensionUrlWithDns(url.href)) {
    throw new Error(`Blocked private/internal docs URL: ${url.href}`);
  }

  const response = await fetchWithTimeout(url.href, {
    method: "GET",
    maxBytes: clampMaxBytes(options.maxBytes),
  });
  return {
    provider: options.provider,
    catalog,
    request: { url: url.href },
    response,
  };
}

export async function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  const config = getProviderApiConfig(args.provider);
  const ctx = requireRequestCredentialContext(config.credentialKeys[0]);
  const baseUrl = await resolveBaseUrl(config, ctx);
  const placeholders = await resolvePlaceholders(config, ctx);
  const method = normalizeMethod(args.method);
  const url = buildProviderUrl({
    config,
    baseUrl,
    rawPath: substituteString(args.path, placeholders),
    query: substituteUnknown(args.query, placeholders),
  });
  if (await isBlockedExtensionUrlWithDns(url.href)) {
    throw new Error(`Blocked private/internal provider URL: ${url.href}`);
  }

  const auth =
    args.auth === "none" ? emptyAuth() : await resolveAuth(config, ctx);
  const extraHeaders = substituteUnknown(args.headers ?? {}, placeholders);
  const headers = sanitizeOutboundHeaders({
    ...(config.defaultHeaders ?? {}),
    ...(isPlainRecord(extraHeaders) ? extraHeaders : {}),
    ...auth.headers,
  });
  const body = prepareBody(substituteUnknown(args.body, placeholders), headers);
  const response = await fetchWithTimeout(url.href, {
    method,
    headers,
    body,
    maxBytes: clampMaxBytes(args.maxBytes),
    timeoutMs: clampTimeout(args.timeoutMs),
    secretValues: auth.secretValues,
  });

  return {
    provider: {
      id: config.id,
      label: config.label,
      docsUrls: config.docsUrls,
      specUrls: config.specUrls ?? [],
    },
    request: {
      method,
      url: redactString(url.href, auth.secretValues),
      path: redactString(`${url.pathname}${url.search}`, auth.secretValues),
      auth: args.auth === "none" ? "none" : describeAuth(config.auth),
      credentialSources: auth.credentialSources.map((source) => ({
        ...source,
        fingerprint: fingerprint(source.key),
      })),
      headerNames: Object.keys(headers).filter(
        (name) => name.toLowerCase() !== "authorization",
      ),
    },
    response,
    guidance:
      "This was a raw provider API request. Use provider docs/spec URLs to choose endpoints and include method/path/status plus relevant filters in the methodology. Prefer this escape hatch whenever canned actions are too narrow.",
  };
}

function describeAuth(auth: AuthKind): string {
  if (auth.type === "none") return "none";
  if (auth.type === "bearer") return "bearer";
  if (auth.type === "basic") return "basic";
  if (auth.type === "basic-raw") return "basic";
  if (auth.type === "api-key-header") return `api-key-header:${auth.header}`;
  if (auth.type === "google-cloud") return "google-service-account";
  if (auth.type === "google-service-account") return "google-service-account";
  return "prometheus-basic-or-bearer";
}

async function resolveBaseUrl(
  config: ProviderApiConfig,
  ctx: CredentialContext,
): Promise<string> {
  if (!config.baseUrlCredentialKey) return config.defaultBaseUrl;
  const configured = await resolveCredential(config.baseUrlCredentialKey, ctx);
  return (configured || config.defaultBaseUrl).replace(/\/+$/, "");
}

async function resolvePlaceholders(
  config: ProviderApiConfig,
  ctx: CredentialContext,
): Promise<Record<string, string>> {
  const placeholders: Record<string, string> = {};
  for (const placeholder of config.placeholders ?? []) {
    const value = await resolveCredential(placeholder.credentialKey, ctx);
    if (value) placeholders[placeholder.name] = value;
  }
  return placeholders;
}

function substituteString(
  value: string,
  placeholders: Record<string, string>,
): string {
  let result = value;
  for (const [name, replacement] of Object.entries(placeholders)) {
    result = result.split(`{${name}}`).join(replacement);
  }
  return result;
}

function substituteUnknown(
  value: unknown,
  placeholders: Record<string, string>,
): unknown {
  if (typeof value === "string") return substituteString(value, placeholders);
  if (Array.isArray(value)) {
    return value.map((item) => substituteUnknown(item, placeholders));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        substituteUnknown(entry, placeholders),
      ]),
    );
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildProviderUrl(options: {
  config: ProviderApiConfig;
  baseUrl: string;
  rawPath: string;
  query: unknown;
}): URL {
  const base = new URL(options.baseUrl);
  const rawPath = options.rawPath.trim();
  const url = /^https?:\/\//i.test(rawPath)
    ? new URL(rawPath)
    : new URL(rawPath.startsWith("/") ? rawPath : `/${rawPath}`, base);

  if (!isAllowedProviderUrl(url, base, options.config)) {
    throw new Error(
      `${options.config.label} API requests must stay on the configured provider host or registered provider host suffix.`,
    );
  }

  for (const [key, value] of queryEntries(options.query)) {
    url.searchParams.append(key, value);
  }

  return url;
}

function isAllowedProviderUrl(
  url: URL,
  base: URL,
  config: ProviderApiConfig,
): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.origin === base.origin) return true;
  const host = url.hostname.toLowerCase();
  return (config.allowedHostSuffixes ?? []).some((suffix) => {
    const normalized = suffix.toLowerCase().replace(/^\./, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function sameOriginOrChild(candidate: URL, allowed: URL): boolean {
  return (
    candidate.origin === allowed.origin &&
    (candidate.pathname === allowed.pathname ||
      candidate.pathname.startsWith(allowed.pathname.replace(/\/?$/, "/")))
  );
}

function queryEntries(value: unknown): Array<[string, string]> {
  if (!value) return [];
  if (typeof value === "string") {
    const params = new URLSearchParams(value.replace(/^\?/, ""));
    return Array.from(params.entries());
  }
  if (typeof value !== "object" || Array.isArray(value)) return [];
  const entries: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      for (const item of raw) entries.push([key, String(item)]);
    } else {
      entries.push([key, String(raw)]);
    }
  }
  return entries;
}

async function resolveAuth(
  config: ProviderApiConfig,
  ctx: CredentialContext,
): Promise<ResolvedAuth> {
  const auth = config.auth;
  if (auth.type === "none") return emptyAuth();
  if (auth.type === "bearer") {
    const credential = await resolveAnyCredential(
      config.id,
      auth.workspaceProvider,
      auth.keys,
      ctx,
    );
    return {
      headers: { Authorization: `Bearer ${credential.value}` },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value],
    };
  }
  if (auth.type === "basic") {
    const username = await resolveRequiredCredential(
      config.id,
      undefined,
      auth.usernameKey,
      ctx,
    );
    const password =
      auth.passwordKey === auth.usernameKey
        ? username
        : await resolveRequiredCredential(
            config.id,
            undefined,
            auth.passwordKey,
            ctx,
          );
    const encoded = Buffer.from(`${username.value}:${password.value}`).toString(
      "base64",
    );
    return {
      headers: { Authorization: `Basic ${encoded}` },
      credentialSources: [
        omitCredentialValue(username),
        ...(password.key === username.key
          ? []
          : [omitCredentialValue(password)]),
      ],
      secretValues: [username.value, password.value, encoded],
    };
  }
  if (auth.type === "basic-raw") {
    const credential = await resolveRequiredCredential(
      config.id,
      undefined,
      auth.key,
      ctx,
    );
    const encoded = Buffer.from(credential.value).toString("base64");
    return {
      headers: { Authorization: `Basic ${encoded}` },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value, encoded],
    };
  }
  if (auth.type === "api-key-header") {
    const credential = await resolveRequiredCredential(
      config.id,
      undefined,
      auth.key,
      ctx,
    );
    return {
      headers: { [auth.header]: credential.value },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value],
    };
  }
  if (auth.type === "google-cloud") {
    const token = await getGoogleCloudAccessToken();
    return {
      headers: { Authorization: `Bearer ${token}` },
      credentialSources: [
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          provider: config.id,
          source: "analytics_local",
        },
      ],
      secretValues: [token],
    };
  }
  if (auth.type === "google-service-account") {
    const token = await getGoogleServiceAccountToken(auth.scopes, ctx);
    return {
      headers: { Authorization: `Bearer ${token}` },
      credentialSources: [
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          provider: config.id,
          source: "analytics_local",
        },
      ],
      secretValues: [token],
    };
  }
  const bearer = await resolveCredential("PROMETHEUS_BEARER_TOKEN", ctx);
  if (bearer) {
    return {
      headers: { Authorization: `Bearer ${bearer}` },
      credentialSources: [
        {
          key: "PROMETHEUS_BEARER_TOKEN",
          provider: config.id,
          source: "analytics_local",
        },
      ],
      secretValues: [bearer],
    };
  }
  const username = await resolveCredential("PROMETHEUS_USERNAME", ctx);
  const password = await resolveCredential("PROMETHEUS_PASSWORD", ctx);
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    return {
      headers: { Authorization: `Basic ${encoded}` },
      credentialSources: [
        {
          key: "PROMETHEUS_USERNAME",
          provider: config.id,
          source: "analytics_local",
        },
        {
          key: "PROMETHEUS_PASSWORD",
          provider: config.id,
          source: "analytics_local",
        },
      ],
      secretValues: [username, password, encoded],
    };
  }
  return emptyAuth();
}

function emptyAuth(): ResolvedAuth {
  return { headers: {}, credentialSources: [], secretValues: [] };
}

async function resolveAnyCredential(
  provider: AnalyticsProviderApiId,
  workspaceProvider: string | undefined,
  keys: readonly string[],
  ctx: CredentialContext,
): Promise<ResolvedProviderCredential> {
  for (const key of keys) {
    const credential = await resolveOptionalCredential(
      provider,
      workspaceProvider,
      key,
      ctx,
    );
    if (credential?.value) return credential;
  }
  throw new Error(
    `${provider} credential not configured. Tried: ${keys.join(", ")}`,
  );
}

async function resolveRequiredCredential(
  provider: AnalyticsProviderApiId,
  workspaceProvider: string | undefined,
  key: string,
  ctx: CredentialContext,
): Promise<ResolvedProviderCredential> {
  const credential = await resolveOptionalCredential(
    provider,
    workspaceProvider,
    key,
    ctx,
  );
  if (!credential?.value) throw new Error(`${key} not configured`);
  return credential;
}

async function resolveOptionalCredential(
  provider: AnalyticsProviderApiId,
  workspaceProvider: string | undefined,
  key: string,
  ctx: CredentialContext,
): Promise<ResolvedProviderCredential | null> {
  const providerForWorkspace = workspaceProvider ?? provider;
  if (WORKSPACE_CREDENTIAL_PROVIDERS.has(providerForWorkspace)) {
    const credential = await resolveAnalyticsProviderCredential({
      provider: providerForWorkspace,
      keys: [key],
      ctx,
      workspaceConnection: true,
    });
    if (credential) {
      return {
        key: credential.key,
        value: credential.value,
        source: credential.source,
        provider: credential.provider,
        connectionId: credential.connectionId,
        connectionLabel: credential.connectionLabel,
      };
    }
  }

  const value = await resolveCredential(key, ctx);
  if (!value) return null;
  return {
    key,
    value,
    source: "analytics_local",
    provider,
  };
}

function omitCredentialValue(
  credential: ResolvedProviderCredential,
): Omit<ResolvedProviderCredential, "value"> {
  const { value: _value, ...rest } = credential;
  return rest;
}

const googleTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

async function getGoogleServiceAccountToken(
  scopes: readonly string[],
  ctx: CredentialContext,
): Promise<string> {
  const credsJson = await resolveCredential(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    ctx,
  );
  if (!credsJson)
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured");
  const cacheKey = createHash("sha256")
    .update(`${ctx.orgId ?? ctx.userEmail}:${scopes.join(" ")}`)
    .digest("hex");
  const cached = googleTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;

  const creds = JSON.parse(credsJson) as {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
  };
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON must be a service account JSON key.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const aud = creds.token_uri || "https://oauth2.googleapis.com/token";
  const jwt = await signRs256Jwt(
    {
      iss: creds.client_email,
      scope: scopes.join(" "),
      aud,
      iat: now,
      exp: now + 3600,
    },
    creds.private_key,
  );
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  googleTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

function normalizeMethod(
  method: ProviderApiMethod | undefined,
): ProviderApiMethod {
  const normalized = String(method || "GET").toUpperCase();
  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE" ||
    normalized === "HEAD"
  ) {
    return normalized;
  }
  throw new Error(`Unsupported HTTP method: ${method}`);
}

function sanitizeOutboundHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME_RE.test(name) || BLOCKED_OUTBOUND_HEADERS.has(lower)) {
      continue;
    }
    if (rawValue === undefined || rawValue === null) continue;
    const headerValue = String(rawValue);
    if (/[\r\n]/.test(headerValue)) continue;
    headers[name] = headerValue;
  }
  return headers;
}

function prepareBody(
  body: unknown,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  const hasContentType = Object.keys(headers).some(
    (name) => name.toLowerCase() === "content-type",
  );
  if (!hasContentType) headers["Content-Type"] = "application/json";
  return JSON.stringify(body);
}

async function fetchWithTimeout(
  optionsUrl: string,
  options: {
    method?: ProviderApiMethod;
    headers?: Record<string, string>;
    body?: BodyInit;
    timeoutMs?: number;
    maxBytes?: number;
    secretValues?: string[];
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    clampTimeout(options.timeoutMs),
  );
  try {
    const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;
    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: "manual",
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;
    const startedAt = Date.now();
    const res = await fetch(optionsUrl, fetchOptions);
    const elapsedMs = Date.now() - startedAt;
    const rawText = await readResponseTextWithLimit(
      res,
      clampMaxBytes(options.maxBytes),
    );
    const secretValues = options.secretValues ?? [];
    const redactedText = redactString(rawText.text, secretValues);
    const parsed = tryParseJson(redactedText);
    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      elapsedMs,
      headers: redactSecrets(headersToObject(res.headers), secretValues),
      contentType: res.headers.get("content-type") ?? null,
      size: rawText.size,
      truncated: rawText.truncated,
      text: parsed === undefined ? redactedText : undefined,
      json: parsed,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; size: number }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return {
      text: `(response too large - ${contentLength} bytes, max ${maxBytes})`,
      truncated: true,
      size: Number(contentLength),
    };
  }
  const buffer = await response.arrayBuffer();
  const size = buffer.byteLength;
  const bytes = new Uint8Array(buffer.slice(0, maxBytes));
  return {
    text: new TextDecoder().decode(bytes),
    truncated: size > maxBytes,
    size,
  };
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") result[key] = value;
  });
  return result;
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function redactSecrets<T>(value: T, secretValues: string[]): T {
  if (secretValues.length === 0) return value;
  if (typeof value === "string") return redactString(value, secretValues) as T;
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secretValues)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactSecrets(entry, secretValues),
      ]),
    ) as T;
  }
  return value;
}

function redactString(text: string, secretValues: string[]): string {
  let output = text;
  for (const secret of secretValues.sort((a, b) => b.length - a.length)) {
    if (!secret) continue;
    output = output.split(secret).join("[redacted]");
    try {
      output = output.split(encodeURIComponent(secret)).join("[redacted]");
    } catch {}
  }
  return output;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs!)));
}

function clampMaxBytes(maxBytes: number | undefined): number {
  if (!Number.isFinite(maxBytes)) return DEFAULT_MAX_BYTES;
  return Math.max(1_000, Math.min(MAX_MAX_BYTES, Math.floor(maxBytes!)));
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
