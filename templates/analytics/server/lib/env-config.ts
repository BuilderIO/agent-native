import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  // Google Analytics (GA4 Data API)
  { key: "GA4_PROPERTY_ID", label: "GA4 Property ID", required: false },
  // BigQuery / Google Cloud
  { key: "BIGQUERY_PROJECT_ID", label: "BigQuery", required: false },
  {
    key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    label: "Google Cloud",
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
  { key: "MIXPANEL_PROJECT_ID", label: "Mixpanel Project ID", required: false },
  {
    key: "MIXPANEL_SERVICE_ACCOUNT",
    label: "Mixpanel Service Account",
    required: false,
  },
  // PostHog
  { key: "POSTHOG_API_KEY", label: "PostHog API Key", required: false },
  { key: "POSTHOG_PROJECT_ID", label: "PostHog Project ID", required: false },
  // PostgreSQL
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
  // Google Cloud
  { key: "GCLOUD_PROJECT_ID", label: "Google Cloud Project", required: false },
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
  { key: "DATAFORSEO_PASSWORD", label: "DataForSEO Password", required: false },
];
