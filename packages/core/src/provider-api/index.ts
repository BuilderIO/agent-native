import { createHash } from "node:crypto";
import {
  resolveCredential,
  type CredentialContext,
} from "../credentials/index.js";
import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "../extensions/url-safety.js";
import {
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "../oauth-tokens/index.js";
import { getCredentialContext } from "../server/request-context.js";
import { resolveWorkspaceConnectionCredentialForApp } from "../workspace-connections/credentials.js";
import type { WorkspaceConnectionTemplateUse } from "../connections/catalog.js";

export const PROVIDER_API_IDS = [
  "amplitude",
  "apollo",
  "bigquery",
  "commonroom",
  "dataforseo",
  "ga4",
  "gcloud",
  "github",
  "gmail",
  "gong",
  "google_calendar",
  "google_drive",
  "granola",
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

export type ProviderApiId = (typeof PROVIDER_API_IDS)[number];

export type ProviderApiMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD";

export interface ProviderApiRequestArgs {
  provider: ProviderApiId | string;
  method?: ProviderApiMethod;
  path: string;
  query?: unknown;
  headers?: Record<string, unknown>;
  body?: unknown;
  auth?: "default" | "none";
  timeoutMs?: number;
  maxBytes?: number;
  connectionId?: string | null;
  accountId?: string | null;
}

export type ProviderApiAuthKind =
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
      workspaceProvider?: string;
    }
  | {
      type: "basic-raw";
      key: string;
      workspaceProvider?: string;
    }
  | {
      type: "api-key-header";
      key: string;
      header: string;
      workspaceProvider?: string;
    }
  | {
      type: "google-service-account";
      scopes: readonly string[];
    }
  | {
      type: "oauth-bearer";
      oauthProvider: string;
      tokenLabel: string;
    }
  | {
      type: "prometheus";
    };

export interface ProviderApiConfig {
  id: ProviderApiId;
  label: string;
  defaultBaseUrl: string;
  baseUrlCredentialKey?: string;
  auth: ProviderApiAuthKind;
  credentialKeys: readonly string[];
  docsUrls: readonly string[];
  specUrls?: readonly string[];
  allowedHostSuffixes?: readonly string[];
  defaultHeaders?: Record<string, string>;
  placeholders?: readonly ProviderApiPlaceholder[];
  examples?: readonly ProviderApiExample[];
  notes?: readonly string[];
  templateUses?: readonly WorkspaceConnectionTemplateUse[];
}

export interface ProviderApiPlaceholder {
  name: string;
  credentialKey: string;
  label: string;
}

export interface ProviderApiExample {
  label: string;
  method: ProviderApiMethod;
  path: string;
  body?: unknown;
}

export interface ProviderApiResolvedCredential {
  key: string;
  value: string;
  source: string;
  provider: string;
  connectionId?: string;
  connectionLabel?: string;
  accountId?: string;
  accountLabel?: string | null;
  scope?: string;
}

export interface ProviderApiCredentialLookupOptions {
  appId: string;
  provider: string;
  key: string;
  ctx: CredentialContext;
  workspaceProvider?: string;
  connectionId?: string | null;
  localCredentialSource: string;
}

export type ProviderApiCredentialResolver = (
  options: ProviderApiCredentialLookupOptions,
) => Promise<ProviderApiResolvedCredential | null>;

export interface ProviderApiRuntimeOptions {
  appId: string;
  providerIds?: readonly (ProviderApiId | string)[];
  localCredentialSource?: string;
  getCredentialContext?: () => CredentialContext | null;
  resolveCredential?: ProviderApiCredentialResolver;
}

interface ProviderApiRuntime {
  providerIds: readonly ProviderApiId[];
  listCatalog(
    provider?: ProviderApiId | string,
  ): ReturnType<typeof listProviderApiCatalog>;
  fetchDocs(options: {
    provider: ProviderApiId | string;
    url?: string;
    maxBytes?: number;
  }): Promise<unknown>;
  executeRequest(args: ProviderApiRequestArgs): Promise<unknown>;
}

interface ResolvedAuth {
  headers: Record<string, string>;
  credentialSources: Array<Omit<ProviderApiResolvedCredential, "value">>;
  secretValues: string[];
}

interface OAuthTokens {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expiry_date?: number;
  expiresAt?: number;
  expires_in?: number;
  token_type?: string;
  scope?: string;
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

const PROVIDER_CONFIGS: Record<ProviderApiId, ProviderApiConfig> = {
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    auth: {
      type: "google-service-account",
      scopes: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/bigquery",
      ],
    },
    credentialKeys: [
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "BIGQUERY_PROJECT_ID",
    ],
    docsUrls: ["https://cloud.google.com/bigquery/docs/reference/rest"],
    specUrls: ["https://bigquery.googleapis.com/$discovery/rest?version=v2"],
    allowedHostSuffixes: ["googleapis.com"],
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    auth: {
      type: "google-service-account",
      scopes: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/monitoring.read",
        "https://www.googleapis.com/auth/logging.read",
        "https://www.googleapis.com/auth/bigquery",
      ],
    },
    credentialKeys: [
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "BIGQUERY_PROJECT_ID",
    ],
    docsUrls: ["https://cloud.google.com/apis/docs/overview"],
    specUrls: ["https://www.googleapis.com/discovery/v1/apis"],
    allowedHostSuffixes: ["googleapis.com"],
    templateUses: ["analytics"],
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
    templateUses: ["analytics", "brain", "dispatch"],
    examples: [
      { label: "Authenticated user", method: "GET", path: "/user" },
      { label: "Search issues", method: "GET", path: "/search/issues" },
    ],
  },
  gmail: {
    id: "gmail",
    label: "Gmail API",
    defaultBaseUrl: "https://gmail.googleapis.com/gmail/v1",
    auth: {
      type: "oauth-bearer",
      oauthProvider: "google",
      tokenLabel: "Google OAuth token",
    },
    credentialKeys: ["GOOGLE_OAUTH_ACCOUNT"],
    docsUrls: ["https://developers.google.com/gmail/api/reference/rest"],
    specUrls: ["https://gmail.googleapis.com/$discovery/rest?version=v1"],
    allowedHostSuffixes: ["googleapis.com"],
    templateUses: ["brain", "mail", "dispatch"],
    examples: [
      {
        label: "List messages",
        method: "GET",
        path: "/users/me/messages",
      },
      {
        label: "Search messages",
        method: "GET",
        path: "/users/me/messages",
        body: undefined,
      },
    ],
    notes: [
      "Uses the current user's stored Google OAuth account. Pass accountId when the user has multiple Google accounts connected.",
    ],
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
    templateUses: ["analytics"],
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
  google_calendar: {
    id: "google_calendar",
    label: "Google Calendar API",
    defaultBaseUrl: "https://www.googleapis.com/calendar/v3",
    auth: {
      type: "oauth-bearer",
      oauthProvider: "google",
      tokenLabel: "Google OAuth token",
    },
    credentialKeys: ["GOOGLE_OAUTH_ACCOUNT"],
    docsUrls: ["https://developers.google.com/calendar/api/v3/reference"],
    specUrls: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
    allowedHostSuffixes: ["googleapis.com"],
    templateUses: ["brain", "calendar", "dispatch"],
    examples: [
      {
        label: "List calendars",
        method: "GET",
        path: "/users/me/calendarList",
      },
      {
        label: "Search events",
        method: "GET",
        path: "/calendars/primary/events",
      },
    ],
    notes: [
      "Uses the current user's stored Google OAuth account. Pass accountId when the user has multiple Google accounts connected.",
    ],
  },
  google_drive: {
    id: "google_drive",
    label: "Google Drive API",
    defaultBaseUrl: "https://www.googleapis.com/drive/v3",
    auth: {
      type: "oauth-bearer",
      oauthProvider: "google",
      tokenLabel: "Google OAuth token",
    },
    credentialKeys: ["GOOGLE_OAUTH_ACCOUNT"],
    docsUrls: ["https://developers.google.com/drive/api/reference/rest/v3"],
    specUrls: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    allowedHostSuffixes: ["googleapis.com"],
    templateUses: ["brain", "content", "slides", "dispatch"],
    examples: [
      { label: "List files", method: "GET", path: "/files" },
      { label: "Get file metadata", method: "GET", path: "/files/{fileId}" },
    ],
    notes: [
      "Uses the current user's stored Google OAuth account. Pass accountId when the user has multiple Google accounts connected.",
    ],
  },
  granola: {
    id: "granola",
    label: "Granola Public API",
    defaultBaseUrl: "https://public-api.granola.ai/v1",
    auth: {
      type: "bearer",
      keys: ["GRANOLA_API_KEY"],
      workspaceProvider: "granola",
    },
    credentialKeys: ["GRANOLA_API_KEY"],
    docsUrls: ["https://docs.granola.ai/"],
    templateUses: ["brain", "dispatch"],
    examples: [
      { label: "List notes", method: "GET", path: "/notes" },
      { label: "Get note", method: "GET", path: "/notes/<note-id>" },
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics", "brain", "mail", "dispatch"],
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
    templateUses: ["analytics"],
    examples: [
      {
        label: "JQL search",
        method: "GET",
        path: "/rest/api/3/search/jql",
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics", "brain", "content", "dispatch"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics", "brain", "dispatch"],
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
    templateUses: ["analytics"],
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
    templateUses: ["analytics"],
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
  provider: ProviderApiId | string,
): ProviderApiConfig {
  const config = PROVIDER_CONFIGS[provider as ProviderApiId];
  if (!config) throw new Error(`Unsupported provider API: ${provider}`);
  return config;
}

export function isProviderApiId(provider: string): provider is ProviderApiId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CONFIGS, provider);
}

export function listProviderApiIdsForTemplateUse(
  templateUse: WorkspaceConnectionTemplateUse,
): ProviderApiId[] {
  return PROVIDER_API_IDS.filter((id) =>
    (PROVIDER_CONFIGS[id].templateUses ?? []).includes(templateUse),
  );
}

export function listProviderApiCatalog(
  provider?: ProviderApiId | string,
  options: { providerIds?: readonly (ProviderApiId | string)[] } = {},
) {
  const providerIds = normalizeProviderIds(options.providerIds);
  if (provider) {
    assertProviderAllowed(provider, providerIds);
  }
  const configs = provider
    ? [getProviderApiConfig(provider)]
    : providerIds.map((id) => getProviderApiConfig(id));
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
    templateUses: config.templateUses ?? [],
  }));
}

export function createProviderApiRuntime(
  options: ProviderApiRuntimeOptions,
): ProviderApiRuntime {
  const providerIds = normalizeProviderIds(options.providerIds);
  const runtimeOptions: Required<
    Pick<ProviderApiRuntimeOptions, "appId" | "localCredentialSource">
  > &
    Omit<ProviderApiRuntimeOptions, "appId" | "localCredentialSource"> = {
    ...options,
    providerIds,
    localCredentialSource: options.localCredentialSource ?? "app_local",
  };
  return {
    providerIds,
    listCatalog: (provider) =>
      listProviderApiCatalog(provider, { providerIds }),
    fetchDocs: (docsOptions) =>
      fetchProviderApiDocs(docsOptions, runtimeOptions),
    executeRequest: (args) => executeProviderApiRequest(args, runtimeOptions),
  };
}

export async function fetchProviderApiDocs(
  options: {
    provider: ProviderApiId | string;
    url?: string;
    maxBytes?: number;
  },
  runtime: ProviderApiRuntimeOptions = { appId: "app" },
) {
  assertProviderAllowed(options.provider, runtime.providerIds);
  const config = getProviderApiConfig(options.provider);
  const catalog = listProviderApiCatalog(options.provider)[0];
  if (!options.url) return { provider: config.id, catalog };

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
    provider: config.id,
    catalog,
    request: { url: url.href },
    response,
  };
}

export async function executeProviderApiRequest(
  args: ProviderApiRequestArgs,
  runtime: ProviderApiRuntimeOptions,
) {
  assertProviderAllowed(args.provider, runtime.providerIds);
  const config = getProviderApiConfig(args.provider);
  const ctx = requireRuntimeCredentialContext(
    runtime,
    config.credentialKeys[0] ?? config.id,
  );
  const baseUrl = await resolveBaseUrl(config, runtime, ctx, args);
  const placeholders = await resolvePlaceholders(config, runtime, ctx, args);
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
    args.auth === "none"
      ? emptyAuth()
      : await resolveAuth(config, runtime, ctx, args);
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
      ...(args.accountId ? { accountId: args.accountId } : {}),
      ...(args.connectionId ? { connectionId: args.connectionId } : {}),
    },
    response,
    guidance:
      "This was a raw provider API request. Use provider docs/spec URLs to choose endpoints and include method/path/status plus relevant filters in the methodology. Prefer this escape hatch whenever canned actions are too narrow.",
  };
}

export async function defaultProviderApiCredentialResolver(
  options: ProviderApiCredentialLookupOptions,
): Promise<ProviderApiResolvedCredential | null> {
  if (options.workspaceProvider) {
    const result = await resolveWorkspaceConnectionCredentialForApp({
      appId: options.appId,
      provider: options.workspaceProvider,
      key: options.key,
      connectionId: options.connectionId,
      userEmail: options.ctx.userEmail,
      orgId: options.ctx.orgId,
    });
    if (result.available && result.value) {
      return {
        key: result.provenance?.resolvedKey ?? result.key,
        value: result.value,
        source: "workspace_connection",
        provider: result.provider,
        connectionId: result.provenance?.connectionId,
        connectionLabel: result.provenance?.connectionLabel,
        scope:
          typeof result.provenance?.secretScope === "string"
            ? result.provenance.secretScope
            : undefined,
      };
    }
  }

  const value = await resolveCredential(options.key, options.ctx);
  if (!value) return null;
  return {
    key: options.key,
    value,
    source: options.localCredentialSource,
    provider: options.provider,
  };
}

function normalizeProviderIds(
  providerIds?: readonly (ProviderApiId | string)[],
): ProviderApiId[] {
  if (!providerIds) return [...PROVIDER_API_IDS];
  const result: ProviderApiId[] = [];
  const seen = new Set<string>();
  for (const providerId of providerIds) {
    if (!isProviderApiId(providerId)) {
      throw new Error(`Unsupported provider API: ${providerId}`);
    }
    if (seen.has(providerId)) continue;
    seen.add(providerId);
    result.push(providerId);
  }
  return result;
}

function assertProviderAllowed(
  provider: ProviderApiId | string,
  providerIds?: readonly (ProviderApiId | string)[],
) {
  const allowed = normalizeProviderIds(providerIds);
  if (!allowed.includes(provider as ProviderApiId)) {
    throw new Error(`Provider API ${provider} is not enabled for this app.`);
  }
}

function describeAuth(auth: ProviderApiAuthKind): string {
  if (auth.type === "none") return "none";
  if (auth.type === "bearer") return "bearer";
  if (auth.type === "basic") return "basic";
  if (auth.type === "basic-raw") return "basic";
  if (auth.type === "api-key-header") return `api-key-header:${auth.header}`;
  if (auth.type === "google-service-account") return "google-service-account";
  if (auth.type === "oauth-bearer") return `oauth-bearer:${auth.oauthProvider}`;
  return "prometheus-basic-or-bearer";
}

function requireRuntimeCredentialContext(
  runtime: ProviderApiRuntimeOptions,
  credentialKey: string,
): CredentialContext {
  const ctx = runtime.getCredentialContext?.() ?? getCredentialContext();
  if (!ctx) {
    throw new Error(
      `Cannot resolve credential "${credentialKey}" outside an authenticated request context.`,
    );
  }
  return ctx;
}

async function resolveBaseUrl(
  config: ProviderApiConfig,
  runtime: ProviderApiRuntimeOptions,
  ctx: CredentialContext,
  args: ProviderApiRequestArgs,
): Promise<string> {
  if (!config.baseUrlCredentialKey) return config.defaultBaseUrl;
  const configured = await resolveCredentialValue({
    config,
    runtime,
    ctx,
    key: config.baseUrlCredentialKey,
    args,
  });
  return (configured || config.defaultBaseUrl).replace(/\/+$/, "");
}

async function resolvePlaceholders(
  config: ProviderApiConfig,
  runtime: ProviderApiRuntimeOptions,
  ctx: CredentialContext,
  args: ProviderApiRequestArgs,
): Promise<Record<string, string>> {
  const placeholders: Record<string, string> = {};
  for (const placeholder of config.placeholders ?? []) {
    const value = await resolveCredentialValue({
      config,
      runtime,
      ctx,
      key: placeholder.credentialKey,
      args,
    });
    if (value) placeholders[placeholder.name] = value;
  }
  return placeholders;
}

async function resolveCredentialValue(options: {
  config: ProviderApiConfig;
  runtime: ProviderApiRuntimeOptions;
  ctx: CredentialContext;
  key: string;
  args: ProviderApiRequestArgs;
  workspaceProvider?: string;
}): Promise<string | undefined> {
  const credential = await resolveOptionalCredential({
    provider: options.config.id,
    workspaceProvider: options.workspaceProvider,
    key: options.key,
    ctx: options.ctx,
    runtime: options.runtime,
    connectionId: options.args.connectionId,
  });
  return credential?.value;
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
  runtime: ProviderApiRuntimeOptions,
  ctx: CredentialContext,
  args: ProviderApiRequestArgs,
): Promise<ResolvedAuth> {
  const auth = config.auth;
  if (auth.type === "none") return emptyAuth();
  if (auth.type === "bearer") {
    const credential = await resolveAnyCredential({
      provider: config.id,
      workspaceProvider: auth.workspaceProvider,
      keys: auth.keys,
      ctx,
      runtime,
      connectionId: args.connectionId,
    });
    return {
      headers: { Authorization: `Bearer ${credential.value}` },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value],
    };
  }
  if (auth.type === "basic") {
    const username = await resolveRequiredCredential({
      provider: config.id,
      workspaceProvider: auth.workspaceProvider,
      key: auth.usernameKey,
      ctx,
      runtime,
      connectionId: args.connectionId,
    });
    const password =
      auth.passwordKey === auth.usernameKey
        ? username
        : await resolveRequiredCredential({
            provider: config.id,
            workspaceProvider: auth.workspaceProvider,
            key: auth.passwordKey,
            ctx,
            runtime,
            connectionId: args.connectionId,
          });
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
    const credential = await resolveRequiredCredential({
      provider: config.id,
      workspaceProvider: auth.workspaceProvider,
      key: auth.key,
      ctx,
      runtime,
      connectionId: args.connectionId,
    });
    const encoded = Buffer.from(credential.value).toString("base64");
    return {
      headers: { Authorization: `Basic ${encoded}` },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value, encoded],
    };
  }
  if (auth.type === "api-key-header") {
    const credential = await resolveRequiredCredential({
      provider: config.id,
      workspaceProvider: auth.workspaceProvider,
      key: auth.key,
      ctx,
      runtime,
      connectionId: args.connectionId,
    });
    return {
      headers: { [auth.header]: credential.value },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value],
    };
  }
  if (auth.type === "google-service-account") {
    const token = await getGoogleServiceAccountToken(auth.scopes, runtime, ctx);
    return {
      headers: { Authorization: `Bearer ${token}` },
      credentialSources: [
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          provider: config.id,
          source: runtime.localCredentialSource ?? "app_local",
        },
      ],
      secretValues: [token],
    };
  }
  if (auth.type === "oauth-bearer") {
    const credential = await resolveOAuthBearerToken({
      auth,
      ctx,
      accountId: args.accountId,
    });
    return {
      headers: { Authorization: `Bearer ${credential.value}` },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value],
    };
  }

  const bearer = await resolveCredentialValue({
    config,
    runtime,
    ctx,
    key: "PROMETHEUS_BEARER_TOKEN",
    args,
  });
  if (bearer) {
    return {
      headers: { Authorization: `Bearer ${bearer}` },
      credentialSources: [
        {
          key: "PROMETHEUS_BEARER_TOKEN",
          provider: config.id,
          source: runtime.localCredentialSource ?? "app_local",
        },
      ],
      secretValues: [bearer],
    };
  }
  const username = await resolveCredentialValue({
    config,
    runtime,
    ctx,
    key: "PROMETHEUS_USERNAME",
    args,
  });
  const password = await resolveCredentialValue({
    config,
    runtime,
    ctx,
    key: "PROMETHEUS_PASSWORD",
    args,
  });
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    return {
      headers: { Authorization: `Basic ${encoded}` },
      credentialSources: [
        {
          key: "PROMETHEUS_USERNAME",
          provider: config.id,
          source: runtime.localCredentialSource ?? "app_local",
        },
        {
          key: "PROMETHEUS_PASSWORD",
          provider: config.id,
          source: runtime.localCredentialSource ?? "app_local",
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

async function resolveAnyCredential(options: {
  provider: ProviderApiId;
  workspaceProvider: string | undefined;
  keys: readonly string[];
  ctx: CredentialContext;
  runtime: ProviderApiRuntimeOptions;
  connectionId?: string | null;
}): Promise<ProviderApiResolvedCredential> {
  for (const key of options.keys) {
    const credential = await resolveOptionalCredential({ ...options, key });
    if (credential?.value) return credential;
  }
  throw new Error(
    `${options.provider} credential not configured. Tried: ${options.keys.join(
      ", ",
    )}`,
  );
}

async function resolveRequiredCredential(options: {
  provider: ProviderApiId;
  workspaceProvider: string | undefined;
  key: string;
  ctx: CredentialContext;
  runtime: ProviderApiRuntimeOptions;
  connectionId?: string | null;
}): Promise<ProviderApiResolvedCredential> {
  const credential = await resolveOptionalCredential(options);
  if (!credential?.value) throw new Error(`${options.key} not configured`);
  return credential;
}

async function resolveOptionalCredential(options: {
  provider: ProviderApiId;
  workspaceProvider: string | undefined;
  key: string;
  ctx: CredentialContext;
  runtime: ProviderApiRuntimeOptions;
  connectionId?: string | null;
}): Promise<ProviderApiResolvedCredential | null> {
  const localCredentialSource =
    options.runtime.localCredentialSource ?? "app_local";
  const lookup: ProviderApiCredentialLookupOptions = {
    appId: options.runtime.appId,
    provider: options.provider,
    key: options.key,
    ctx: options.ctx,
    workspaceProvider: options.workspaceProvider,
    connectionId: options.connectionId,
    localCredentialSource,
  };
  if (options.runtime.resolveCredential) {
    return options.runtime.resolveCredential(lookup);
  }
  return defaultProviderApiCredentialResolver(lookup);
}

function omitCredentialValue(
  credential: ProviderApiResolvedCredential,
): Omit<ProviderApiResolvedCredential, "value"> {
  const { value: _value, ...rest } = credential;
  return rest;
}

const googleServiceTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

async function getGoogleServiceAccountToken(
  scopes: readonly string[],
  runtime: ProviderApiRuntimeOptions,
  ctx: CredentialContext,
): Promise<string> {
  const cacheKey = createHash("sha256")
    .update(
      `${runtime.appId}:${ctx.orgId ?? ctx.userEmail}:${scopes.join(" ")}`,
    )
    .digest("hex");
  const cached = googleServiceTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;

  const credsJson = await resolveCredentialValue({
    config: getProviderApiConfig("gcloud"),
    runtime,
    ctx,
    key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    args: { provider: "gcloud", path: "/" },
  });
  if (!credsJson) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured");
  }
  let creds: {
    type?: string;
    client_email?: string;
    private_key?: string;
    token_uri?: string;
  };
  try {
    creds = JSON.parse(credsJson) as typeof creds;
  } catch {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON. Upload a service account JSON key.",
    );
  }
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
  googleServiceTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

async function resolveOAuthBearerToken(options: {
  auth: Extract<ProviderApiAuthKind, { type: "oauth-bearer" }>;
  ctx: CredentialContext;
  accountId?: string | null;
}): Promise<ProviderApiResolvedCredential> {
  const accounts = await listOAuthAccountsByOwner(
    options.auth.oauthProvider,
    options.ctx.userEmail,
  );
  if (accounts.length === 0) {
    throw new Error(
      `${options.auth.tokenLabel} is not connected for ${options.ctx.userEmail}.`,
    );
  }
  const accountId = options.accountId?.trim();
  const account = accountId
    ? accounts.find((entry) => entry.accountId === accountId)
    : accounts[0];
  if (!account) {
    throw new Error(
      `${options.auth.tokenLabel} account ${accountId} is not available to ${options.ctx.userEmail}.`,
    );
  }
  const tokens = account.tokens as OAuthTokens;
  const token = await getValidOAuthAccessToken({
    oauthProvider: options.auth.oauthProvider,
    accountId: account.accountId,
    ownerEmail: options.ctx.userEmail,
    tokens,
  });
  return {
    key: `${options.auth.oauthProvider.toUpperCase()}_OAUTH_TOKEN`,
    value: token,
    source: "oauth_token",
    provider: options.auth.oauthProvider,
    accountId: account.accountId,
    accountLabel: account.displayName,
  };
}

async function getValidOAuthAccessToken(options: {
  oauthProvider: string;
  accountId: string;
  ownerEmail: string;
  tokens: OAuthTokens;
}): Promise<string> {
  const accessToken =
    options.tokens.access_token ?? options.tokens.accessToken ?? "";
  if (!accessToken) {
    throw new Error(
      `${options.oauthProvider} OAuth account has no access token.`,
    );
  }
  const expiresAt = options.tokens.expiry_date ?? options.tokens.expiresAt;
  if (
    !expiresAt ||
    !Number.isFinite(expiresAt) ||
    expiresAt > Date.now() + 60_000
  ) {
    return accessToken;
  }

  const refreshToken =
    options.tokens.refresh_token ?? options.tokens.refreshToken;
  if (!refreshToken) return accessToken;
  if (options.oauthProvider === "google") {
    return refreshGoogleOAuthToken(options, refreshToken);
  }
  throw new Error(
    `${options.oauthProvider} OAuth token is expired and automatic refresh is not configured for provider-api.`,
  );
}

async function refreshGoogleOAuthToken(
  options: {
    oauthProvider: string;
    accountId: string;
    ownerEmail: string;
    tokens: OAuthTokens;
  },
  refreshToken: string,
): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID/SECRET not set for Google OAuth refresh.",
    );
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    const detail = data.error_description ?? data.error ?? res.statusText;
    throw new Error(`Google OAuth refresh failed: ${detail}`);
  }
  const merged: OAuthTokens = {
    ...options.tokens,
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
    token_type: data.token_type ?? options.tokens.token_type,
    scope: data.scope ?? options.tokens.scope,
  };
  await saveOAuthTokens(
    options.oauthProvider,
    options.accountId,
    merged as unknown as Record<string, unknown>,
    options.ownerEmail,
  );
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
  for (const secret of [...secretValues].sort((a, b) => b.length - a.length)) {
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

async function privateKeyCacheKey(privateKeyPem: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(privateKeyPem) as BufferSource,
  );
  return `sha256:${base64UrlEncode(new Uint8Array(digest))}`;
}

async function importRs256Key(privateKeyPem: string): Promise<CryptoKey> {
  const cacheKey = await privateKeyCacheKey(privateKeyPem);
  let cached = keyCache.get(cacheKey);
  if (!cached) {
    cached = crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(privateKeyPem) as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(cacheKey, cached);
  }
  return cached;
}

async function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${base64UrlEncodeString(
    JSON.stringify(header),
  )}.${base64UrlEncodeString(JSON.stringify(payload))}`;

  const key = await importRs256Key(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput) as BufferSource,
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}
