import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  { key: "BIGQUERY_PROJECT_ID", label: "BigQuery", required: false },
  { key: "GOOGLE_APPLICATION_CREDENTIALS_JSON", label: "Google Cloud", required: false },
  { key: "HUBSPOT_ACCESS_TOKEN", label: "HubSpot", required: false },
  { key: "DATAFORSEO_LOGIN", label: "DataForSEO", required: false },
  { key: "DATAFORSEO_PASSWORD", label: "DataForSEO Password", required: false },
  { key: "NOTION_API_KEY", label: "Notion", required: false },
  { key: "TWITTER_BEARER_TOKEN", label: "Twitter/X", required: false },
  { key: "PYLON_API_KEY", label: "Pylon", required: false },
  { key: "COMMONROOM_API_KEY", label: "Common Room", required: false },
  { key: "GONG_API_KEY", label: "Gong", required: false },
  { key: "APOLLO_API_KEY", label: "Apollo", required: false },
  { key: "GRAFANA_URL", label: "Grafana URL", required: false },
  { key: "GRAFANA_TOKEN", label: "Grafana Token", required: false },
  { key: "SENTRY_AUTH_TOKEN", label: "Sentry", required: false },
  { key: "SLACK_TOKEN", label: "Slack", required: false },
  { key: "JIRA_EMAIL", label: "Jira Email", required: false },
  { key: "JIRA_TOKEN", label: "Jira Token", required: false },
  { key: "GITHUB_TOKEN", label: "GitHub", required: false },
  { key: "STRIPE_SECRET_KEY", label: "Stripe", required: false },
];
