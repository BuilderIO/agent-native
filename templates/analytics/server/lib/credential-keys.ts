export interface CredentialKeyConfig {
  key: string;
  label: string;
  required: boolean;
}

export interface CredentialProviderConfig {
  provider: string;
  label: string;
  requiredKeys: string[];
  requiredMode?: "all" | "any";
  optionalKeys?: string[];
}

/**
 * All per-user/account credential keys. These are stored in the SQL
 * settings table, NOT as env vars. The resolveCredential() helper
 * deliberately never reads process.env because env vars are deploy-global.
 */
export const credentialKeys: CredentialKeyConfig[] = [
  // Google Cloud / Analytics / BigQuery
  {
    key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    label: "Google Cloud",
    required: false,
  },
  { key: "GA4_PROPERTY_ID", label: "GA4 Property ID", required: false },
  {
    key: "BIGQUERY_PROJECT_ID",
    label: "BigQuery Project ID",
    required: false,
  },
  {
    key: "ANALYTICS_BIGQUERY_EVENTS_TABLE",
    label: "BigQuery Events Table",
    required: false,
  },
  // Amplitude
  { key: "AMPLITUDE_API_KEY", label: "Amplitude API Key", required: false },
  {
    key: "AMPLITUDE_SECRET_KEY",
    label: "Amplitude Secret Key",
    required: false,
  },
  // Mixpanel
  {
    key: "MIXPANEL_PROJECT_ID",
    label: "Mixpanel Project ID",
    required: false,
  },
  {
    key: "MIXPANEL_SERVICE_ACCOUNT",
    label: "Mixpanel Service Account",
    required: false,
  },
  // PostHog
  { key: "POSTHOG_API_KEY", label: "PostHog API Key", required: false },
  { key: "POSTHOG_PROJECT_ID", label: "PostHog Project ID", required: false },
  { key: "POSTHOG_HOST", label: "PostHog Host", required: false },
  // PostgreSQL (user's external DB, not the app's DATABASE_URL)
  { key: "POSTGRES_URL", label: "PostgreSQL URL", required: false },
  // Stripe
  { key: "STRIPE_SECRET_KEY", label: "Stripe", required: false },
  // HubSpot
  {
    key: "HUBSPOT_PRIVATE_APP_TOKEN",
    label: "HubSpot private app token",
    required: false,
  },
  {
    key: "HUBSPOT_ACCESS_TOKEN",
    label: "HubSpot access token (legacy)",
    required: false,
  },
  // Gong
  { key: "GONG_ACCESS_KEY", label: "Gong Access Key", required: false },
  { key: "GONG_ACCESS_SECRET", label: "Gong Access Secret", required: false },
  { key: "GONG_API_BASE", label: "Gong API Base URL", required: false },
  // Apollo
  { key: "APOLLO_API_KEY", label: "Apollo", required: false },
  // GitHub
  { key: "GITHUB_TOKEN", label: "GitHub token", required: false },
  // Jira
  { key: "JIRA_BASE_URL", label: "Jira Base URL", required: false },
  { key: "JIRA_USER_EMAIL", label: "Jira Email", required: false },
  { key: "JIRA_API_TOKEN", label: "Jira API Token", required: false },
  // Sentry
  { key: "SENTRY_SERVER_TOKEN", label: "Sentry Server Token", required: false },
  { key: "SENTRY_AUTH_TOKEN", label: "Sentry", required: false },
  { key: "SENTRY_ORG_SLUG", label: "Sentry Organization", required: false },
  // Grafana
  { key: "GRAFANA_URL", label: "Grafana URL", required: false },
  { key: "GRAFANA_API_TOKEN", label: "Grafana API Token", required: false },
  // Prometheus
  { key: "PROMETHEUS_URL", label: "Prometheus URL", required: false },
  { key: "PROMETHEUS_USERNAME", label: "Prometheus Username", required: false },
  { key: "PROMETHEUS_PASSWORD", label: "Prometheus Password", required: false },
  {
    key: "PROMETHEUS_BEARER_TOKEN",
    label: "Prometheus Bearer Token",
    required: false,
  },
  // Slack
  { key: "SLACK_BOT_TOKEN", label: "Slack Bot Token", required: false },
  {
    key: "SLACK_BOT_TOKEN_2",
    label: "Slack Bot Token (secondary)",
    required: false,
  },
  // Notion
  { key: "NOTION_API_KEY", label: "Notion", required: false },
  // Twitter/X
  { key: "TWITTER_BEARER_TOKEN", label: "Twitter/X", required: false },
  // Pylon
  { key: "PYLON_API_KEY", label: "Pylon", required: false },
  // Common Room
  { key: "COMMONROOM_API_TOKEN", label: "Common Room", required: false },
  // DataForSEO
  { key: "DATAFORSEO_LOGIN", label: "DataForSEO", required: false },
  {
    key: "DATAFORSEO_PASSWORD",
    label: "DataForSEO Password",
    required: false,
  },
];

/**
 * Keys that act as overrides for a default value — providers list them under
 * `optionalKeys`. A blank submission for one of these keys means "go back to
 * the default", which the credentials POST handler treats as a delete. Keys
 * that are required by *any* provider are excluded so a typo on a critical
 * field can never silently erase it.
 */
export function buildOptionalCredentialKeys(
  configs: CredentialProviderConfig[],
): Set<string> {
  const requiredAnywhere = new Set(configs.flatMap((cfg) => cfg.requiredKeys));
  return new Set(
    configs
      .flatMap((cfg) => cfg.optionalKeys ?? [])
      .filter((key) => !requiredAnywhere.has(key)),
  );
}

export interface CredentialUpdatePartition {
  toSave: Array<{ key: string; value: string }>;
  toDelete: string[];
  blankRequired: string[];
}

/**
 * Split incoming credential updates into the keys that should be saved and
 * the optional keys whose blank value means "clear and use the default".
 * `blankRequired` collects any blank values for required keys so the caller
 * can reject them before touching storage.
 */
export function partitionCredentialUpdate(
  vars: Array<{ key: string; value: string }>,
  optionalKeys: Set<string>,
): CredentialUpdatePartition {
  const toSave: Array<{ key: string; value: string }> = [];
  const toDelete: string[] = [];
  const blankRequired: string[] = [];
  for (const { key, value } of vars) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) {
      toSave.push({ key, value: trimmed });
    } else if (optionalKeys.has(key)) {
      toDelete.push(key);
    } else {
      blankRequired.push(key);
    }
  }
  return { toSave, toDelete, blankRequired };
}

export const credentialProviderConfigs: CredentialProviderConfig[] = [
  {
    provider: "google-analytics",
    label: "Google Analytics",
    requiredKeys: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GA4_PROPERTY_ID"],
  },
  {
    provider: "bigquery",
    label: "BigQuery",
    requiredKeys: [
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "BIGQUERY_PROJECT_ID",
    ],
    optionalKeys: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
  },
  {
    provider: "amplitude",
    label: "Amplitude",
    requiredKeys: ["AMPLITUDE_API_KEY", "AMPLITUDE_SECRET_KEY"],
  },
  {
    provider: "mixpanel",
    label: "Mixpanel",
    requiredKeys: ["MIXPANEL_PROJECT_ID", "MIXPANEL_SERVICE_ACCOUNT"],
  },
  {
    provider: "posthog",
    label: "PostHog",
    requiredKeys: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"],
    optionalKeys: ["POSTHOG_HOST"],
  },
  {
    provider: "postgres",
    label: "PostgreSQL",
    requiredKeys: ["POSTGRES_URL"],
  },
  {
    provider: "stripe",
    label: "Stripe",
    requiredKeys: ["STRIPE_SECRET_KEY"],
  },
  {
    provider: "hubspot",
    label: "HubSpot",
    requiredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
    requiredMode: "any",
  },
  {
    provider: "gong",
    label: "Gong",
    requiredKeys: ["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET"],
    optionalKeys: ["GONG_API_BASE"],
  },
  {
    provider: "apollo",
    label: "Apollo",
    requiredKeys: ["APOLLO_API_KEY"],
  },
  {
    provider: "github",
    label: "GitHub",
    requiredKeys: ["GITHUB_TOKEN"],
  },
  {
    provider: "jira",
    label: "Jira",
    requiredKeys: ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
  },
  {
    provider: "sentry",
    label: "Sentry",
    requiredKeys: ["SENTRY_AUTH_TOKEN"],
    optionalKeys: ["SENTRY_ORG_SLUG", "SENTRY_SERVER_TOKEN"],
  },
  {
    provider: "grafana",
    label: "Grafana",
    requiredKeys: ["GRAFANA_URL", "GRAFANA_API_TOKEN"],
  },
  {
    provider: "prometheus",
    label: "Prometheus",
    requiredKeys: ["PROMETHEUS_URL"],
    optionalKeys: [
      "PROMETHEUS_USERNAME",
      "PROMETHEUS_PASSWORD",
      "PROMETHEUS_BEARER_TOKEN",
    ],
  },
  {
    provider: "gcloud",
    label: "Google Cloud",
    requiredKeys: ["GOOGLE_APPLICATION_CREDENTIALS_JSON"],
  },
  {
    provider: "slack",
    label: "Slack",
    requiredKeys: ["SLACK_BOT_TOKEN"],
    optionalKeys: ["SLACK_BOT_TOKEN_2"],
  },
  {
    provider: "notion",
    label: "Notion",
    requiredKeys: ["NOTION_API_KEY"],
  },
  {
    provider: "twitter",
    label: "X / Twitter",
    requiredKeys: ["TWITTER_BEARER_TOKEN"],
  },
  {
    provider: "pylon",
    label: "Pylon",
    requiredKeys: ["PYLON_API_KEY"],
  },
  {
    provider: "commonroom",
    label: "Common Room",
    requiredKeys: ["COMMONROOM_API_TOKEN"],
  },
  {
    provider: "dataforseo",
    label: "DataForSEO",
    requiredKeys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
  },
];

export const optionalCredentialKeys = buildOptionalCredentialKeys(
  credentialProviderConfigs,
);

const credentialAliases: Record<string, string[]> = {
  amplitude: ["AMPLITUDE_API_KEY", "AMPLITUDE_SECRET_KEY"],
  apollo: ["APOLLO_API_KEY"],
  bigquery: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "BIGQUERY_PROJECT_ID"],
  commonroom: ["COMMONROOM_API_TOKEN"],
  dataforseo: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
  ga4: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GA4_PROPERTY_ID"],
  googleanalytics: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GA4_PROPERTY_ID"],
  github: ["GITHUB_TOKEN"],
  repositories: ["GITHUB_TOKEN"],
  repos: ["GITHUB_TOKEN"],
  gcloud: ["GOOGLE_APPLICATION_CREDENTIALS_JSON"],
  gong: ["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET", "GONG_API_BASE"],
  grafana: ["GRAFANA_URL", "GRAFANA_API_TOKEN"],
  hubspot: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
  jira: ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
  mixpanel: ["MIXPANEL_PROJECT_ID", "MIXPANEL_SERVICE_ACCOUNT"],
  notion: ["NOTION_API_KEY"],
  postgres: ["POSTGRES_URL"],
  postgresql: ["POSTGRES_URL"],
  posthog: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID", "POSTHOG_HOST"],
  prometheus: [
    "PROMETHEUS_URL",
    "PROMETHEUS_USERNAME",
    "PROMETHEUS_PASSWORD",
    "PROMETHEUS_BEARER_TOKEN",
  ],
  prom: [
    "PROMETHEUS_URL",
    "PROMETHEUS_USERNAME",
    "PROMETHEUS_PASSWORD",
    "PROMETHEUS_BEARER_TOKEN",
  ],
  pylon: ["PYLON_API_KEY"],
  sentry: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG_SLUG", "SENTRY_SERVER_TOKEN"],
  slack: ["SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN_2"],
  stripe: ["STRIPE_SECRET_KEY"],
  twitter: ["TWITTER_BEARER_TOKEN"],
  x: ["TWITTER_BEARER_TOKEN"],
};

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function resolveCredentialConfigs(key?: string): {
  configs: CredentialKeyConfig[];
  known: boolean;
} {
  if (!key) return { configs: credentialKeys, known: true };

  const normalized = normalizeLookup(key);
  const aliasKeys = credentialAliases[normalized];
  if (aliasKeys) {
    const wanted = new Set(aliasKeys);
    return {
      configs: credentialKeys.filter((cfg) => wanted.has(cfg.key)),
      known: true,
    };
  }

  const configs = credentialKeys.filter(
    (cfg) =>
      normalizeLookup(cfg.key) === normalized ||
      normalizeLookup(cfg.label) === normalized,
  );
  return { configs, known: configs.length > 0 };
}
