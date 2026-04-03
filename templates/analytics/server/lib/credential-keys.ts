export interface CredentialKeyConfig {
  key: string;
  label: string;
  required: boolean;
}

/**
 * All per-user/account credential keys. These are stored in the SQL
 * settings table, NOT as env vars. The resolveCredential() helper
 * checks process.env first for backward compat with .env files.
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
  // PostgreSQL (user's external DB, not the app's DATABASE_URL)
  { key: "POSTGRES_URL", label: "PostgreSQL URL", required: false },
  // Stripe
  { key: "STRIPE_SECRET_KEY", label: "Stripe", required: false },
  // HubSpot
  { key: "HUBSPOT_ACCESS_TOKEN", label: "HubSpot", required: false },
  // Gong
  { key: "GONG_API_KEY", label: "Gong", required: false },
  // Apollo
  { key: "APOLLO_API_KEY", label: "Apollo", required: false },
  // GitHub
  { key: "GITHUB_TOKEN", label: "GitHub", required: false },
  // Jira
  { key: "JIRA_EMAIL", label: "Jira Email", required: false },
  { key: "JIRA_TOKEN", label: "Jira Token", required: false },
  // Sentry
  { key: "SENTRY_AUTH_TOKEN", label: "Sentry", required: false },
  // Grafana
  { key: "GRAFANA_URL", label: "Grafana URL", required: false },
  { key: "GRAFANA_TOKEN", label: "Grafana Token", required: false },
  // Slack
  { key: "SLACK_TOKEN", label: "Slack", required: false },
  // Notion
  { key: "NOTION_API_KEY", label: "Notion", required: false },
  // Twitter/X
  { key: "TWITTER_BEARER_TOKEN", label: "Twitter/X", required: false },
  // Pylon
  { key: "PYLON_API_KEY", label: "Pylon", required: false },
  // Common Room
  { key: "COMMONROOM_API_KEY", label: "Common Room", required: false },
  // DataForSEO
  { key: "DATAFORSEO_LOGIN", label: "DataForSEO", required: false },
  {
    key: "DATAFORSEO_PASSWORD",
    label: "DataForSEO Password",
    required: false,
  },
];
