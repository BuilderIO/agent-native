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
  deleteOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "../oauth-tokens/index.js";
import { getCredentialContext } from "../server/request-context.js";
import { resolveWorkspaceConnectionCredentialForApp } from "../workspace-connections/credentials.js";
import type { WorkspaceConnectionTemplateUse } from "../connections/catalog.js";
import type {
  CustomProviderConfig,
  CustomProviderAuthKind,
} from "./custom-registry.js";

export type {
  CustomProviderConfig,
  CustomProviderScope,
  CustomProviderAuthKind,
  UpsertCustomProviderArgs,
} from "./custom-registry.js";
export {
  upsertCustomProvider,
  deleteCustomProvider,
  listCustomProviders,
  getCustomProvider,
  validateCustomBaseUrl,
} from "./custom-registry.js";

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

/** Cursor-pagination config for fetchAllPages. */
export interface FetchAllPagesConfig {
  /**
   * Dot-path into the JSON response body where the next-page cursor lives,
   * e.g. "meta.next_cursor" or "pagination.next_page_token".
   */
  cursorPath: string;
  /**
   * Query parameter name to pass the cursor on the next request,
   * e.g. "cursor" or "page_token".
   */
  cursorParam?: string;
  /**
   * Dot-path in the JSON request body to set to the cursor on the next request.
   * Use this for POST-body pagination, e.g. Gong's top-level `cursor`.
   */
  cursorBodyPath?: string;
  /**
   * Dot-path to the items array in each response body.
   * When omitted, the whole response body is appended to the items array.
   */
  itemsPath?: string;
  /**
   * Maximum number of pages to fetch. Default 10, max 50.
   */
  maxPages?: number;
}

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
  /**
   * When set, write the full response body to this workspace file path instead
   * of returning it in context. Returns a compact summary with status, bytes,
   * path, and a preview. Allows up to 20 MB (vs the normal 4 MB context limit).
   */
  saveToFile?: string;
  /**
   * When set, automatically paginate by cursor until the cursor field is empty
   * or maxPages is reached. Accumulates items from itemsPath (or whole bodies)
   * across all pages. Combine with saveToFile to write the full dataset.
   */
  fetchAllPages?: FetchAllPagesConfig;
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
  /**
   * Template-specific OAuth token provider overrides for built-in provider API
   * configs. Use when an app stores a provider's OAuth grant under a narrower
   * local provider id, e.g. Google Drive scoped to a "google-docs" connection.
   */
  oauthProviderOverrides?: Record<string, string>;
  /**
   * Optional loader for custom providers registered at runtime. When provided,
   * custom providers are merged with the static built-in registry for catalog,
   * docs, and request operations. Custom providers cannot shadow built-in ids.
   */
  getCustomProviders?: () => Promise<CustomProviderConfig[]>;
}

interface ProviderApiRuntime {
  providerIds: readonly ProviderApiId[];
  listCatalog(
    provider?: ProviderApiId | string,
  ): ReturnType<typeof listProviderApiCatalog> | Promise<unknown[]>;
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

const PERMANENT_GOOGLE_OAUTH_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "unauthorized_client",
  "invalid_client",
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_MAX_BYTES = 4 * 1024 * 1024;
/** When saveToFile is used, allow a much larger per-page response since the
 *  content won't enter the model's context window. */
const SAVE_TO_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const FETCH_ALL_PAGES_MAX = 50;
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
    templateUses: ["analytics", "calendar"],
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
    templateUses: ["analytics", "brain", "design", "dispatch"],
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
    templateUses: ["analytics", "calendar"],
    examples: [
      { label: "List calls", method: "GET", path: "/calls" },
      {
        label: "Call transcript",
        method: "POST",
        path: "/calls/transcript",
        body: { filter: { callIds: ["<call-id>"] } },
      },
      {
        label: "Calls with parties/content",
        method: "POST",
        path: "/calls/extensive",
        body: {
          filter: { fromDateTime: "<iso-date-time>" },
          contentSelector: {
            exposedFields: {
              parties: true,
              content: { brief: true, keyPoints: true },
            },
          },
        },
      },
    ],
    notes: [
      "For broad corpus work, call /calls/extensive with provider-api-request and stageAs/saveToFile. Gong returns the next cursor at records.cursor and expects the next cursor in the POST body at cursor, so use pagination { nextCursorPath: 'records.cursor', cursorBodyPath: 'cursor' } for stageAs or fetchAllPages { cursorPath: 'records.cursor', cursorBodyPath: 'cursor' } for saveToFile.",
      "Batch transcripts with POST /calls/transcript and body { filter: { callIds: [...] } } after narrowing or staging call ids.",
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
    templateUses: ["brain", "calendar", "dispatch", "mail"],
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
    templateUses: ["analytics", "brain", "calendar", "mail", "dispatch"],
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
    templateUses: ["analytics", "calendar"],
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
      listProviderApiCatalogWithCustom(
        provider,
        { providerIds },
        runtimeOptions,
      ),
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
  await assertProviderAllowedAsync(options.provider, runtime);

  // Resolve config — may be a built-in or a custom provider.
  const builtIn = isProviderApiId(options.provider)
    ? getProviderApiConfig(options.provider)
    : null;
  const customConfig = builtIn
    ? null
    : await resolveCustomProvider(options.provider, runtime);

  if (!builtIn && !customConfig) {
    const known = await listAllProviderIds(runtime);
    throw new Error(
      `Unknown provider "${options.provider}". Known providers: ${known.join(", ")}`,
    );
  }

  const catalog = builtIn
    ? listProviderApiCatalog(options.provider)[0]
    : customProviderToCatalogEntry(customConfig!);

  if (!options.url) {
    return {
      provider: options.provider,
      catalog,
      guidance:
        "provider-api-docs can fetch ANY public http(s) URL — pass url to retrieve API documentation, OpenAPI specs, changelogs, or any public web page. Registered docsUrls above are curated starting points.",
    };
  }

  // Open docs fetching: allow ANY public https/http URL.
  // The SSRF guard still applies — private/internal addresses are blocked.
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new Error(`Invalid docs URL: ${options.url}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Docs URL must use https: or http: (got ${url.protocol})`);
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

export async function executeProviderApiRequest(
  args: ProviderApiRequestArgs,
  runtime: ProviderApiRuntimeOptions,
) {
  await assertProviderAllowedAsync(args.provider, runtime);

  // Check whether this is a built-in or custom provider.
  const builtIn = isProviderApiId(args.provider)
    ? getProviderApiConfig(args.provider)
    : null;
  const customConfig = builtIn
    ? null
    : await resolveCustomProvider(args.provider, runtime);

  if (!builtIn && !customConfig) {
    const known = await listAllProviderIds(runtime);
    throw new Error(
      `Unknown provider "${args.provider}". Known providers: ${known.join(", ")}`,
    );
  }

  if (customConfig) {
    return executeCustomProviderApiRequest(args, customConfig, runtime);
  }

  // --- built-in provider path (original code) ---
  const config = builtIn!;
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

  // Allow a much larger maxBytes ceiling when writing to a workspace file.
  const effectiveMaxBytes = args.saveToFile
    ? SAVE_TO_FILE_MAX_BYTES
    : clampMaxBytes(args.maxBytes);

  // --- fetchAllPages mode ---
  if (args.fetchAllPages) {
    const pageCfg = args.fetchAllPages;
    const { items, pageCount, lastStatus, lastContentType } =
      await fetchAllPages(pageCfg, async (extra) => {
        const queryWithCursor = extra?.query
          ? mergeQueryObjects(
              substituteUnknown(args.query, placeholders),
              extra.query,
            )
          : substituteUnknown(args.query, placeholders);
        const pageUrl = buildProviderUrl({
          config,
          baseUrl,
          rawPath: substituteString(args.path, placeholders),
          query: queryWithCursor,
        });
        const bodyWithCursor = extra?.bodyCursor
          ? setValueAtPath(
              substituteUnknown(args.body, placeholders),
              extra.bodyCursor.path,
              extra.bodyCursor.value,
            )
          : substituteUnknown(args.body, placeholders);
        const pageBody = prepareBody(bodyWithCursor, { ...headers });
        const resp = await fetchWithTimeout(pageUrl.href, {
          method,
          headers,
          body: pageBody,
          maxBytes: effectiveMaxBytes,
          timeoutMs: clampTimeout(args.timeoutMs),
          secretValues: auth.secretValues,
        });
        return {
          text:
            resp.text ??
            (resp.json !== undefined ? JSON.stringify(resp.json) : ""),
          contentType: resp.contentType,
          status: resp.status,
          ok: resp.ok,
        };
      });

    const allItemsJson = JSON.stringify(items, null, 2);
    const metadata = {
      provider: { id: config.id, label: config.label },
      pagesRead: pageCount,
      totalItems: Array.isArray(items) ? items.length : 0,
      lastStatus,
    };

    if (args.saveToFile) {
      const saved = (await handleSaveToFile(
        args.saveToFile,
        allItemsJson,
        lastContentType ?? "application/json",
        lastStatus,
      )) as Record<string, unknown>;
      return { ...metadata, ...saved };
    }

    return { ...metadata, items };
  }

  // --- Single request ---
  const body = prepareBody(substituteUnknown(args.body, placeholders), headers);
  const response = await fetchWithTimeout(url.href, {
    method,
    headers,
    body,
    maxBytes: effectiveMaxBytes,
    timeoutMs: clampTimeout(args.timeoutMs),
    secretValues: auth.secretValues,
  });

  // saveToFile: write full body to workspace file and return compact summary.
  if (args.saveToFile) {
    const rawText =
      response.text ??
      (response.json !== undefined ? JSON.stringify(response.json) : "");
    const saved = (await handleSaveToFile(
      args.saveToFile,
      rawText,
      response.contentType,
      response.status,
    )) as Record<string, unknown>;
    return {
      provider: { id: config.id, label: config.label },
      request: {
        method,
        url: redactString(url.href, auth.secretValues),
        path: redactString(`${url.pathname}${url.search}`, auth.secretValues),
      },
      ...saved,
    };
  }

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

// ---------------------------------------------------------------------------
// Custom provider execution
// ---------------------------------------------------------------------------

async function executeCustomProviderApiRequest(
  args: ProviderApiRequestArgs,
  customConfig: CustomProviderConfig,
  runtime: ProviderApiRuntimeOptions,
): Promise<unknown> {
  const ctx = requireRuntimeCredentialContext(runtime, customConfig.id);
  const method = normalizeMethod(args.method);
  const baseUrl = customConfig.baseUrl;

  // Build a lightweight ProviderApiConfig-like object so we can reuse
  // buildProviderUrl (which validates allowed hosts).
  const syntheticConfig: ProviderApiConfig = {
    id: customConfig.id as ProviderApiId,
    label: customConfig.label,
    defaultBaseUrl: baseUrl,
    auth: { type: "none" },
    credentialKeys: [],
    docsUrls: customConfig.docsUrls,
    allowedHostSuffixes: customConfig.allowedHostSuffixes,
    defaultHeaders: customConfig.defaultHeaders,
  };

  const url = buildProviderUrl({
    config: syntheticConfig,
    baseUrl,
    rawPath: args.path,
    query: args.query,
  });

  if (await isBlockedExtensionUrlWithDns(url.href)) {
    throw new Error(`Blocked private/internal provider URL: ${url.href}`);
  }

  const auth =
    args.auth === "none"
      ? emptyAuth()
      : await resolveCustomAuth(customConfig, runtime, ctx, args);

  const extraHeaders = args.headers ?? {};
  const headers = sanitizeOutboundHeaders({
    ...(customConfig.defaultHeaders ?? {}),
    ...(isPlainRecord(extraHeaders) ? extraHeaders : {}),
    ...auth.headers,
  });
  const body = prepareBody(args.body, headers);

  const effectiveMaxBytes = args.saveToFile
    ? SAVE_TO_FILE_MAX_BYTES
    : clampMaxBytes(args.maxBytes);

  // --- fetchAllPages mode (same cursor pagination as built-in providers) ---
  if (args.fetchAllPages) {
    const pageCfg = args.fetchAllPages;
    const { items, pageCount, lastStatus, lastContentType } =
      await fetchAllPages(pageCfg, async (extra) => {
        const queryWithCursor = extra?.query
          ? mergeQueryObjects(args.query, extra.query)
          : args.query;
        const pageUrl = buildProviderUrl({
          config: syntheticConfig,
          baseUrl,
          rawPath: args.path,
          query: queryWithCursor,
        });
        const bodyWithCursor = extra?.bodyCursor
          ? setValueAtPath(
              args.body,
              extra.bodyCursor.path,
              extra.bodyCursor.value,
            )
          : args.body;
        const pageBody = prepareBody(bodyWithCursor, { ...headers });
        const resp = await fetchWithTimeout(pageUrl.href, {
          method,
          headers,
          body: pageBody,
          maxBytes: effectiveMaxBytes,
          timeoutMs: clampTimeout(args.timeoutMs),
          secretValues: auth.secretValues,
        });
        return {
          text:
            resp.text ??
            (resp.json !== undefined ? JSON.stringify(resp.json) : ""),
          contentType: resp.contentType,
          status: resp.status,
          ok: resp.ok,
        };
      });

    const allItemsJson = JSON.stringify(items, null, 2);
    const metadata = {
      provider: {
        id: customConfig.id,
        label: customConfig.label,
        custom: true,
      },
      pagesRead: pageCount,
      totalItems: Array.isArray(items) ? items.length : 0,
      lastStatus,
    };

    if (args.saveToFile) {
      const saved = (await handleSaveToFile(
        args.saveToFile,
        allItemsJson,
        lastContentType ?? "application/json",
        lastStatus,
      )) as Record<string, unknown>;
      return { ...metadata, ...saved };
    }

    return { ...metadata, items };
  }

  const response = await fetchWithTimeout(url.href, {
    method,
    headers,
    body,
    maxBytes: effectiveMaxBytes,
    timeoutMs: clampTimeout(args.timeoutMs),
    secretValues: auth.secretValues,
  });

  if (args.saveToFile) {
    const rawText =
      response.text ??
      (response.json !== undefined ? JSON.stringify(response.json) : "");
    const saved = (await handleSaveToFile(
      args.saveToFile,
      rawText,
      response.contentType,
      response.status,
    )) as Record<string, unknown>;
    return {
      provider: {
        id: customConfig.id,
        label: customConfig.label,
        custom: true,
      },
      request: {
        method,
        url: redactString(url.href, auth.secretValues),
        path: redactString(`${url.pathname}${url.search}`, auth.secretValues),
      },
      ...saved,
    };
  }

  return {
    provider: {
      id: customConfig.id,
      label: customConfig.label,
      docsUrls: customConfig.docsUrls,
      specUrls: [],
      custom: true,
    },
    request: {
      method,
      url: redactString(url.href, auth.secretValues),
      path: redactString(`${url.pathname}${url.search}`, auth.secretValues),
      auth:
        args.auth === "none" ? "none" : describeCustomAuth(customConfig.auth),
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
      "This was a raw provider API request to a custom provider. Use provider docs URLs to choose endpoints.",
  };
}

async function resolveCustomAuth(
  customConfig: CustomProviderConfig,
  runtime: ProviderApiRuntimeOptions,
  ctx: CredentialContext,
  args: ProviderApiRequestArgs,
): Promise<ResolvedAuth> {
  const auth = customConfig.auth;
  if (auth.type === "none") return emptyAuth();

  if (auth.type === "bearer") {
    const credential = await resolveRequiredCredentialByKey({
      provider: customConfig.id,
      key: auth.credentialKey,
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
    const username = await resolveRequiredCredentialByKey({
      provider: customConfig.id,
      key: auth.usernameKey,
      ctx,
      runtime,
      connectionId: args.connectionId,
    });
    const password =
      auth.passwordKey === auth.usernameKey
        ? username
        : await resolveRequiredCredentialByKey({
            provider: customConfig.id,
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

  if (auth.type === "api-key-header") {
    const credential = await resolveRequiredCredentialByKey({
      provider: customConfig.id,
      key: auth.credentialKey,
      ctx,
      runtime,
      connectionId: args.connectionId,
    });
    return {
      headers: { [auth.headerName]: credential.value },
      credentialSources: [omitCredentialValue(credential)],
      secretValues: [credential.value],
    };
  }

  return emptyAuth();
}

/** Resolve a credential by key name (no workspace-provider lookup for custom). */
async function resolveRequiredCredentialByKey(options: {
  provider: string;
  key: string;
  ctx: CredentialContext;
  runtime: ProviderApiRuntimeOptions;
  connectionId?: string | null;
}): Promise<ProviderApiResolvedCredential> {
  const localCredentialSource =
    options.runtime.localCredentialSource ?? "app_local";
  const lookup: ProviderApiCredentialLookupOptions = {
    appId: options.runtime.appId,
    provider: options.provider,
    key: options.key,
    ctx: options.ctx,
    workspaceProvider: undefined,
    connectionId: options.connectionId,
    localCredentialSource,
  };
  const resolver =
    options.runtime.resolveCredential ?? defaultProviderApiCredentialResolver;
  const credential = await resolver(lookup);
  if (!credential?.value) {
    throw new Error(
      `Credential "${options.key}" not configured for custom provider "${options.provider}".`,
    );
  }
  return credential;
}

function describeCustomAuth(auth: CustomProviderAuthKind): string {
  if (auth.type === "none") return "none";
  if (auth.type === "bearer") return "bearer";
  if (auth.type === "basic") return "basic";
  if (auth.type === "api-key-header")
    return `api-key-header:${auth.headerName}`;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Catalog helpers with custom provider support
// ---------------------------------------------------------------------------

/**
 * Convert a custom provider to the same catalog shape as built-in providers.
 */
function customProviderToCatalogEntry(config: CustomProviderConfig) {
  return {
    id: config.id,
    label: config.label,
    defaultBaseUrl: config.baseUrl,
    baseUrlCredentialKey: null,
    auth: describeCustomAuth(config.auth),
    credentialKeys: extractCredentialKeysFromCustomAuth(config.auth),
    docsUrls: config.docsUrls,
    specUrls: [] as string[],
    allowedHostSuffixes: config.allowedHostSuffixes,
    placeholders: [] as unknown[],
    defaultHeaders: config.defaultHeaders,
    examples: [] as unknown[],
    notes: config.notes ? [config.notes] : ([] as string[]),
    templateUses: [] as string[],
    custom: true,
  };
}

function extractCredentialKeysFromCustomAuth(
  auth: CustomProviderAuthKind,
): string[] {
  if (auth.type === "bearer") return [auth.credentialKey];
  if (auth.type === "basic") {
    return auth.usernameKey === auth.passwordKey
      ? [auth.usernameKey]
      : [auth.usernameKey, auth.passwordKey];
  }
  if (auth.type === "api-key-header") return [auth.credentialKey];
  return [];
}

/**
 * List catalog entries including custom providers (merged after built-ins).
 */
async function listProviderApiCatalogWithCustom(
  provider: ProviderApiId | string | undefined,
  options: { providerIds?: readonly (ProviderApiId | string)[] },
  runtime: ProviderApiRuntimeOptions,
): Promise<unknown[]> {
  const customConfigs = runtime.getCustomProviders
    ? await runtime.getCustomProviders()
    : [];

  if (provider) {
    // Check built-ins first
    if (isProviderApiId(provider)) {
      return listProviderApiCatalog(provider, options) as unknown[];
    }
    // Check custom
    const custom = customConfigs.find((c) => c.id === provider);
    if (custom) return [customProviderToCatalogEntry(custom)];
    const known = [
      ...normalizeProviderIds(options.providerIds),
      ...customConfigs.map((c) => c.id),
    ];
    throw new Error(
      `Unknown provider "${provider}". Known providers: ${known.join(", ")}`,
    );
  }

  const builtInEntries = listProviderApiCatalog(
    undefined,
    options,
  ) as unknown[];
  const builtInIds = new Set(
    (options.providerIds ?? PROVIDER_API_IDS).map(String),
  );
  const customEntries = customConfigs
    .filter((c) => !builtInIds.has(c.id))
    .map(customProviderToCatalogEntry);
  return [...builtInEntries, ...customEntries];
}

/**
 * Look up a custom provider by id from the runtime loader.
 */
async function resolveCustomProvider(
  id: string,
  runtime: ProviderApiRuntimeOptions,
): Promise<CustomProviderConfig | null> {
  if (!runtime.getCustomProviders) return null;
  const configs = await runtime.getCustomProviders();
  return configs.find((c) => c.id === id) ?? null;
}

/**
 * List all provider ids (built-in + custom) visible to this runtime.
 */
async function listAllProviderIds(
  runtime: ProviderApiRuntimeOptions,
): Promise<string[]> {
  const builtIn = normalizeProviderIds(runtime.providerIds).map(String);
  if (!runtime.getCustomProviders) return builtIn;
  const custom = await runtime.getCustomProviders();
  return [...builtIn, ...custom.map((c) => c.id)];
}

/**
 * Assert that a provider is either a known built-in or a registered custom
 * provider. Throws with a descriptive message listing known providers.
 */
async function assertProviderAllowedAsync(
  provider: string,
  runtime: ProviderApiRuntimeOptions,
): Promise<void> {
  // Built-in check (fast path)
  if (isProviderApiId(provider)) {
    // Still check the providerIds whitelist if set
    const allowed = normalizeProviderIds(runtime.providerIds);
    if (!allowed.includes(provider as ProviderApiId)) {
      throw new Error(`Provider API ${provider} is not enabled for this app.`);
    }
    return;
  }
  // Custom provider check
  const custom = await resolveCustomProvider(provider, runtime);
  if (custom) return;
  const known = await listAllProviderIds(runtime);
  throw new Error(
    `Unknown provider "${provider}". Known providers: ${known.join(", ")}`,
  );
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
    : new URL(joinProviderUrlPath(base, rawPath), base.origin);

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

function joinProviderUrlPath(base: URL, rawPath: string): string {
  const basePath = base.pathname.replace(/\/+$/, "");
  const providerPath = rawPath.replace(/^\/+/, "");
  if (!providerPath) return basePath || "/";
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
    const oauthProvider =
      runtime.oauthProviderOverrides?.[config.id] ?? auth.oauthProvider;
    const credential = await resolveOAuthBearerToken({
      auth: { ...auth, oauthProvider },
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
  if (
    options.oauthProvider === "google" ||
    options.oauthProvider === "google-docs"
  ) {
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
    if (data.error && PERMANENT_GOOGLE_OAUTH_REFRESH_ERRORS.has(data.error)) {
      await deleteOAuthTokens(options.oauthProvider, options.accountId);
    }
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
  const timeoutMs = clampTimeout(options.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const method = options.method ?? "GET";
  const secretValues = options.secretValues ?? [];
  try {
    const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;
    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: "manual",
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;
    try {
      return await fetchProviderResponse(optionsUrl, fetchOptions, {
        maxBytes: options.maxBytes,
        secretValues,
      });
    } catch (error) {
      if (dispatcher && isDispatcherCompatibilityError(error)) {
        const fallbackOptions = { ...fetchOptions };
        delete fallbackOptions.dispatcher;
        return await fetchProviderResponse(optionsUrl, fallbackOptions, {
          maxBytes: options.maxBytes,
          secretValues,
        });
      }
      throw error;
    }
  } catch (error) {
    throw normalizeFetchError(error, {
      method,
      url: optionsUrl,
      timeoutMs,
      secretValues,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderResponse(
  url: string,
  fetchOptions: RequestInit & { dispatcher?: unknown },
  options: {
    maxBytes?: number;
    secretValues: string[];
  },
) {
  const startedAt = Date.now();
  const res = await fetch(url, fetchOptions);
  const elapsedMs = Date.now() - startedAt;
  const rawText = await readResponseTextWithLimit(
    res,
    clampMaxBytes(options.maxBytes),
  );
  const redactedText = redactString(rawText.text, options.secretValues);
  const parsed = tryParseJson(redactedText);
  return {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    elapsedMs,
    headers: redactSecrets(headersToObject(res.headers), options.secretValues),
    contentType: res.headers.get("content-type") ?? null,
    size: rawText.size,
    truncated: rawText.truncated,
    text: parsed === undefined ? redactedText : undefined,
    json: parsed,
  };
}

function isDispatcherCompatibilityError(error: unknown): boolean {
  const err = error as {
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code = typeof err?.cause?.code === "string" ? err.cause.code : "";
  const detail = [
    typeof err?.message === "string" ? err.message : "",
    typeof err?.cause?.message === "string" ? err.cause.message : "",
  ]
    .join(" ")
    .toLowerCase();
  return (
    code === "UND_ERR_INVALID_ARG" &&
    detail.includes("invalid onrequeststart method")
  );
}

function normalizeFetchError(
  error: unknown,
  options: {
    method: ProviderApiMethod;
    url: string;
    timeoutMs: number;
    secretValues: string[];
  },
): Error {
  const target = describeProviderRequestTarget(
    options.url,
    options.secretValues,
  );
  const err = error as {
    name?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  if (err?.name === "AbortError") {
    return new Error(
      `Provider API request timed out after ${options.timeoutMs}ms: ${options.method} ${target}`,
      { cause: error },
    );
  }

  const causeCode =
    typeof err?.cause?.code === "string" && err.cause.code
      ? ` (${err.cause.code})`
      : "";
  const detail =
    typeof err?.cause?.message === "string" && err.cause.message
      ? err.cause.message
      : typeof err?.message === "string" && err.message
        ? err.message
        : String(error);
  return new Error(
    `Provider API request failed${causeCode}: ${options.method} ${target}: ${redactString(detail, options.secretValues)}`,
    { cause: error },
  );
}

function describeProviderRequestTarget(
  rawUrl: string,
  secretValues: string[],
): string {
  try {
    const url = new URL(rawUrl);
    return redactString(
      `${url.host}${url.pathname}${url.search}`,
      secretValues,
    );
  } catch {
    return redactString(rawUrl, secretValues);
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

function mergeQueryObjects(
  base: unknown,
  extra: Record<string, string>,
): unknown {
  if (!base) return extra;
  if (typeof base === "string") {
    const params = new URLSearchParams(base.replace(/^\?/, ""));
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value);
    }
    return params.toString();
  }
  if (typeof base === "object" && !Array.isArray(base)) {
    return { ...(base as Record<string, unknown>), ...extra };
  }
  return extra;
}

function setValueAtPath(base: unknown, path: string, value: unknown): unknown {
  const root =
    base && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return root;

  let current: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    const next =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    current[part] = next;
    current = next;
  }
  current[parts[parts.length - 1]!] = value;
  return root;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs!)));
}

function clampMaxBytes(maxBytes: number | undefined): number {
  if (!Number.isFinite(maxBytes)) return DEFAULT_MAX_BYTES;
  return Math.max(1_000, Math.min(MAX_MAX_BYTES, Math.floor(maxBytes!)));
}

/** Resolve a dot-path from a parsed JSON object, e.g. "meta.next_cursor". */
function dotGet(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Handle saveToFile: write the full provider-api response body to a workspace
 * file and return a compact summary.
 */
async function handleSaveToFile(
  filePath: string,
  responseText: string,
  contentType: string | null,
  status: number,
): Promise<unknown> {
  const { writeWorkspaceFile, SAVE_TO_FILE_MAX_BYTES: maxSaveBytes } =
    await import("../workspace-files/store.js");
  const { getRequestOrgId, getRequestUserEmail } =
    await import("../server/request-context.js");

  const orgId = getRequestOrgId();
  const email = getRequestUserEmail();
  const scope = orgId
    ? { scope: "org" as const, scopeId: orgId }
    : email
      ? { scope: "user" as const, scopeId: email }
      : null;

  if (!scope) {
    throw new Error(
      "saveToFile requires an authenticated request context (no user email or orgId found).",
    );
  }

  const mimeType = contentType?.split(";")[0].trim() ?? "text/plain";
  await writeWorkspaceFile(scope, filePath, responseText, mimeType, {
    maxFileBytes: maxSaveBytes,
  });
  const bytes = Buffer.byteLength(responseText, "utf8");
  const preview = responseText.slice(0, 2000);
  return {
    savedToFile: true,
    savedTo: filePath,
    status,
    bytes,
    contentType: mimeType,
    preview: preview.length < responseText.length ? `${preview}…` : preview,
  };
}

/**
 * Execute paginated requests, accumulating items across pages.
 * Returns the accumulated items array and the last response for metadata.
 */
async function fetchAllPages(
  config: FetchAllPagesConfig,
  executeOnePage: (extra?: {
    query?: Record<string, string>;
    bodyCursor?: { path: string; value: string };
  }) => Promise<{
    text: string;
    contentType: string | null;
    status: number;
    ok: boolean;
  }>,
): Promise<{
  items: unknown[];
  pageCount: number;
  lastStatus: number;
  lastContentType: string | null;
}> {
  const maxPages = Math.min(
    Number.isFinite(config.maxPages) && config.maxPages! > 0
      ? config.maxPages!
      : 10,
    FETCH_ALL_PAGES_MAX,
  );

  const items: unknown[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  let lastStatus = 0;
  let lastContentType: string | null = null;

  if (!config.cursorParam && !config.cursorBodyPath) {
    throw new Error(
      "fetchAllPages requires cursorParam or cursorBodyPath to send the next cursor.",
    );
  }
  if (config.cursorParam && config.cursorBodyPath) {
    throw new Error(
      "fetchAllPages accepts exactly one cursor method: cursorParam or cursorBodyPath.",
    );
  }

  while (pageCount < maxPages) {
    const extra: {
      query?: Record<string, string>;
      bodyCursor?: { path: string; value: string };
    } = {};
    if (cursor) {
      if (config.cursorParam) extra.query = { [config.cursorParam]: cursor };
      if (config.cursorBodyPath) {
        extra.bodyCursor = { path: config.cursorBodyPath, value: cursor };
      }
    }

    const page = await executeOnePage(pageCount > 0 ? extra : undefined);
    lastStatus = page.status;
    lastContentType = page.contentType;
    pageCount++;

    if (!page.ok) {
      const preview = page.text.replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(
        `fetchAllPages request failed with HTTP ${page.status}${
          preview ? `: ${preview}` : ""
        }`,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(page.text);
    } catch {
      body = page.text;
    }

    // Extract items
    if (config.itemsPath) {
      const extracted = dotGet(body, config.itemsPath);
      if (Array.isArray(extracted)) {
        items.push(...extracted);
      } else if (extracted !== undefined) {
        items.push(extracted);
      }
    } else {
      items.push(body);
    }

    // Extract next cursor
    const nextCursor = dotGet(body, config.cursorPath);
    if (
      !nextCursor ||
      nextCursor === "" ||
      nextCursor === null ||
      nextCursor === cursor
    ) {
      break;
    }
    cursor = String(nextCursor);
  }

  return { items, pageCount, lastStatus, lastContentType };
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
