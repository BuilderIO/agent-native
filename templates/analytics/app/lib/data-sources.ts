import type { ComponentType } from "react";
import {
  IconChartBar,
  IconDatabase,
  IconActivity,
  IconCreditCard,
  IconShoppingCart,
  IconPhone,
  IconUserSearch,
  IconGitPullRequest,
  IconTicket,
  IconBug,
  IconChartLine,
  IconMessage,
  IconFileText,
  IconBrandX,
  IconHeadset,
  IconUsers,
  IconSearch,
  IconCloud,
  IconGauge,
} from "@tabler/icons-react";

export type DataSourceCategory =
  | "analytics"
  | "database"
  | "payments"
  | "crm"
  | "engineering"
  | "communication"
  | "support"
  | "seo";

export interface WalkthroughStep {
  title: string;
  description: string;
  url?: string;
  linkText?: string;
  inputKey?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputType?: "text" | "password" | "textarea";
}

export interface DataSource {
  id: string;
  name: string;
  description: string;
  category: DataSourceCategory;
  icon: ComponentType<Record<string, unknown>>;
  envKeys: string[];
  walkthroughSteps: WalkthroughStep[];
  docsUrl: string;
}

export const categoryLabels: Record<DataSourceCategory, string> = {
  analytics: "Analytics & Product",
  database: "IconDatabase",
  payments: "Payments",
  crm: "CRM & Sales",
  engineering: "Engineering",
  communication: "Communication",
  support: "Support",
  seo: "SEO",
};

export const categoryOrder: DataSourceCategory[] = [
  "analytics",
  "database",
  "payments",
  "crm",
  "engineering",
  "communication",
  "support",
  "seo",
];

export const dataSources: DataSource[] = [
  // --- Analytics & Product ---
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "GA4 website and app analytics via the Data API",
    category: "analytics",
    icon: IconChartBar,
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GA4_PROPERTY_ID"],
    docsUrl:
      "https://developers.google.com/analytics/devguides/reporting/data/v1",
    walkthroughSteps: [
      {
        title: "Create a Google IconCloud project",
        description:
          "If you don't already have one, create a project in the Google IconCloud Console.",
        url: "https://console.cloud.google.com/projectcreate",
        linkText: "Create project",
      },
      {
        title: "Enable the Google Analytics Data API",
        description:
          'IconSearch for "Google Analytics Data API" and click Enable.',
        url: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com",
        linkText: "Enable API",
      },
      {
        title: "Create a service account",
        description:
          "Go to IAM & Admin > Service Accounts, create a new service account, and download the JSON key file.",
        url: "https://console.cloud.google.com/iam-admin/serviceaccounts",
        linkText: "Service Accounts",
      },
      {
        title: "Add the service account to GA4",
        description:
          "In Google Analytics, go to Admin > Property Access Management and add the service account email as a Viewer.",
        url: "https://analytics.google.com/analytics/web/#/a-p/admin",
        linkText: "GA4 Admin",
      },
      {
        title: "Enter your service account credentials",
        description:
          "Paste the contents of your service account JSON key file.",
        inputKey: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        inputLabel: "Service Account JSON",
        inputPlaceholder: '{"type": "service_account", ...}',
        inputType: "textarea",
      },
      {
        title: "Enter your GA4 Property ID",
        description:
          'Find this in GA4 under Admin > Property Settings. It\'s a numeric ID like "123456789".',
        inputKey: "GA4_PROPERTY_ID",
        inputLabel: "GA4 Property ID",
        inputPlaceholder: "123456789",
        inputType: "text",
      },
    ],
  },
  {
    id: "bigquery",
    name: "BigQuery",
    description: "Query your data warehouse directly with SQL",
    category: "analytics",
    icon: IconDatabase,
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "BIGQUERY_PROJECT_ID"],
    docsUrl: "https://cloud.google.com/bigquery/docs",
    walkthroughSteps: [
      {
        title: "Create a Google IconCloud project",
        description:
          "If you don't already have one, create a project in the Google IconCloud Console.",
        url: "https://console.cloud.google.com/projectcreate",
        linkText: "Create project",
      },
      {
        title: "Enable the BigQuery API",
        description: "Enable the BigQuery API for your project.",
        url: "https://console.cloud.google.com/apis/library/bigquery.googleapis.com",
        linkText: "Enable API",
      },
      {
        title: "Create a service account",
        description:
          'Create a service account with "BigQuery Data Viewer" and "BigQuery Job User" roles, then download the JSON key.',
        url: "https://console.cloud.google.com/iam-admin/serviceaccounts",
        linkText: "Service Accounts",
      },
      {
        title: "Enter your service account credentials",
        description:
          "Paste the contents of your service account JSON key file.",
        inputKey: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        inputLabel: "Service Account JSON",
        inputPlaceholder: '{"type": "service_account", ...}',
        inputType: "textarea",
      },
      {
        title: "Enter your BigQuery Project ID",
        description:
          "The Google IconCloud project ID where your BigQuery data lives.",
        inputKey: "BIGQUERY_PROJECT_ID",
        inputLabel: "Project ID",
        inputPlaceholder: "my-project-123",
        inputType: "text",
      },
    ],
  },
  {
    id: "amplitude",
    name: "Amplitude",
    description: "Product analytics — events, funnels, retention",
    category: "analytics",
    icon: IconActivity,
    envKeys: ["AMPLITUDE_API_KEY", "AMPLITUDE_SECRET_KEY"],
    docsUrl: "https://www.docs.developers.amplitude.com/analytics/apis/",
    walkthroughSteps: [
      {
        title: "Go to Amplitude Settings",
        description:
          'In Amplitude, go to Settings > Projects, select your project, and find the API keys under "General".',
        url: "https://app.amplitude.com/analytics/settings/projects",
        linkText: "Amplitude Settings",
      },
      {
        title: "Enter your API Key",
        description: "Copy the API Key from your project settings.",
        inputKey: "AMPLITUDE_API_KEY",
        inputLabel: "API Key",
        inputPlaceholder: "your-amplitude-api-key",
        inputType: "password",
      },
      {
        title: "Enter your Secret Key",
        description: "Copy the Secret Key from your project settings.",
        inputKey: "AMPLITUDE_SECRET_KEY",
        inputLabel: "Secret Key",
        inputPlaceholder: "your-amplitude-secret-key",
        inputType: "password",
      },
    ],
  },
  {
    id: "mixpanel",
    name: "Mixpanel",
    description: "Product analytics — events, funnels, user flows",
    category: "analytics",
    icon: IconChartLine,
    envKeys: ["MIXPANEL_PROJECT_ID", "MIXPANEL_SERVICE_ACCOUNT"],
    docsUrl: "https://developer.mixpanel.com/reference/overview",
    walkthroughSteps: [
      {
        title: "Find your Project ID",
        description:
          "In Mixpanel, go to Settings > Project Settings. Your Project ID is listed at the top.",
        url: "https://mixpanel.com/settings/project",
        linkText: "Mixpanel Settings",
      },
      {
        title: "Create a Service Account",
        description:
          'Go to Settings > Service Accounts and create one with "Analyst" role. Copy the username and secret.',
        url: "https://mixpanel.com/settings/project#serviceaccounts",
        linkText: "Service Accounts",
      },
      {
        title: "Enter your Project ID",
        description:
          "The numeric project ID from your Mixpanel project settings.",
        inputKey: "MIXPANEL_PROJECT_ID",
        inputLabel: "Project ID",
        inputPlaceholder: "123456",
        inputType: "text",
      },
      {
        title: "Enter your Service Account credentials",
        description:
          'Enter in "username:secret" format (e.g., "my-sa.abc123.mp-service-account:mySecretKey").',
        inputKey: "MIXPANEL_SERVICE_ACCOUNT",
        inputLabel: "Service Account (username:secret)",
        inputPlaceholder: "username:secret",
        inputType: "password",
      },
    ],
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Open-source product analytics and feature flags",
    category: "analytics",
    icon: IconGauge,
    envKeys: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"],
    docsUrl: "https://posthog.com/docs/api",
    walkthroughSteps: [
      {
        title: "Get your API key",
        description:
          "In PostHog, go to Settings > Project > Personal API Keys and create a new key.",
        url: "https://app.posthog.com/settings/project#personal-api-keys",
        linkText: "PostHog Settings",
      },
      {
        title: "Enter your API Key",
        description: "Paste the personal API key you just created.",
        inputKey: "POSTHOG_API_KEY",
        inputLabel: "Personal API Key",
        inputPlaceholder: "phx_...",
        inputType: "password",
      },
      {
        title: "Enter your Project ID",
        description:
          "Find this in Settings > Project. It's the numeric ID shown at the top.",
        inputKey: "POSTHOG_PROJECT_ID",
        inputLabel: "Project ID",
        inputPlaceholder: "12345",
        inputType: "text",
      },
    ],
  },

  // --- IconDatabase ---
  {
    id: "postgresql",
    name: "PostgreSQL",
    description: "Query any PostgreSQL database directly",
    category: "database",
    icon: IconDatabase,
    envKeys: ["POSTGRES_URL"],
    docsUrl: "https://www.postgresql.org/docs/",
    walkthroughSteps: [
      {
        title: "Get your connection string",
        description:
          "Get the connection URL from your database provider (Supabase, Neon, Railway, RDS, etc.). It should look like: postgresql://user:password@host:5432/dbname",
        url: "https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING",
        linkText: "Connection string docs",
      },
      {
        title: "Enter your connection URL",
        description:
          "Paste the full PostgreSQL connection string. Make sure it includes the password.",
        inputKey: "POSTGRES_URL",
        inputLabel: "Connection URL",
        inputPlaceholder: "postgresql://user:password@host:5432/dbname",
        inputType: "password",
      },
    ],
  },

  // --- Payments ---
  {
    id: "stripe",
    name: "Stripe",
    description: "Revenue, subscriptions, and payment analytics",
    category: "payments",
    icon: IconCreditCard,
    envKeys: ["STRIPE_SECRET_KEY"],
    docsUrl: "https://stripe.com/docs/api",
    walkthroughSteps: [
      {
        title: "Go to the Stripe Dashboard",
        description:
          "Navigate to Developers > API keys. Create a restricted key with read-only access, or use your secret key.",
        url: "https://dashboard.stripe.com/apikeys",
        linkText: "Stripe API Keys",
      },
      {
        title: "Enter your Secret Key",
        description:
          'Paste your secret key (starts with "sk_live_" or "sk_test_").',
        inputKey: "STRIPE_SECRET_KEY",
        inputLabel: "Secret Key",
        inputPlaceholder: "sk_live_...",
        inputType: "password",
      },
    ],
  },

  // --- CRM & Sales ---
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM deals, contacts, companies, and pipelines",
    category: "crm",
    icon: IconShoppingCart,
    envKeys: ["HUBSPOT_ACCESS_TOKEN"],
    docsUrl: "https://developers.hubspot.com/docs/api/overview",
    walkthroughSteps: [
      {
        title: "Create a Private App",
        description:
          "In HubSpot, go to Settings > Integrations > Private Apps. Create a new private app with scopes: crm.objects.contacts.read, crm.objects.deals.read, crm.objects.companies.read.",
        url: "https://app.hubspot.com/private-apps/",
        linkText: "Private Apps",
      },
      {
        title: "Enter your Access Token",
        description: "Copy the access token from your private app.",
        inputKey: "HUBSPOT_ACCESS_TOKEN",
        inputLabel: "Access Token",
        inputPlaceholder: "pat-na1-...",
        inputType: "password",
      },
    ],
  },
  {
    id: "gong",
    name: "Gong",
    description: "Sales call recordings, transcripts, and analytics",
    category: "crm",
    icon: IconPhone,
    envKeys: ["GONG_API_KEY"],
    docsUrl: "https://gong.app.gong.io/settings/api/documentation",
    walkthroughSteps: [
      {
        title: "Generate API credentials",
        description:
          "In Gong, go to Settings > API. Generate a new API key and secret.",
        url: "https://app.gong.io/company/api",
        linkText: "Gong API Settings",
      },
      {
        title: "Enter your API Key",
        description:
          'Enter your API credentials in "accessKey:accessKeySecret" format.',
        inputKey: "GONG_API_KEY",
        inputLabel: "API Key (key:secret)",
        inputPlaceholder: "accessKey:accessKeySecret",
        inputType: "password",
      },
    ],
  },
  {
    id: "apollo",
    name: "Apollo",
    description: "Contact and company enrichment for prospecting",
    category: "crm",
    icon: IconUserSearch,
    envKeys: ["APOLLO_API_KEY"],
    docsUrl: "https://apolloio.github.io/apollo-api-docs/",
    walkthroughSteps: [
      {
        title: "Get your API Key",
        description:
          "In Apollo, go to Settings > Integrations > API Keys and create a new key.",
        url: "https://app.apollo.io/#/settings/integrations/api-keys",
        linkText: "Apollo API Keys",
      },
      {
        title: "Enter your API Key",
        description: "Paste the API key you just created.",
        inputKey: "APOLLO_API_KEY",
        inputLabel: "API Key",
        inputPlaceholder: "your-apollo-api-key",
        inputType: "password",
      },
    ],
  },

  // --- Engineering ---
  {
    id: "github",
    name: "GitHub",
    description: "Pull requests, issues, and code reviews",
    category: "engineering",
    icon: IconGitPullRequest,
    envKeys: ["GITHUB_TOKEN"],
    docsUrl: "https://docs.github.com/en/rest",
    walkthroughSteps: [
      {
        title: "Create a Personal Access Token",
        description:
          'Go to GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens. Create a token with "Contents" and "Pull requests" read access for your repos.',
        url: "https://github.com/settings/tokens?type=beta",
        linkText: "GitHub Tokens",
      },
      {
        title: "Enter your Token",
        description: "Paste the personal access token you just created.",
        inputKey: "GITHUB_TOKEN",
        inputLabel: "Personal Access Token",
        inputPlaceholder: "github_pat_...",
        inputType: "password",
      },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    description: "Tickets, sprints, and project tracking",
    category: "engineering",
    icon: IconTicket,
    envKeys: ["JIRA_EMAIL", "JIRA_TOKEN"],
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
    walkthroughSteps: [
      {
        title: "Create an API Token",
        description:
          "Go to Atlassian account settings and create an API token.",
        url: "https://id.atlassian.com/manage-profile/security/api-tokens",
        linkText: "Atlassian API Tokens",
      },
      {
        title: "Enter your Jira email",
        description:
          "The email address associated with your Atlassian account.",
        inputKey: "JIRA_EMAIL",
        inputLabel: "Email",
        inputPlaceholder: "you@company.com",
        inputType: "text",
      },
      {
        title: "Enter your API Token",
        description: "Paste the API token you just created.",
        inputKey: "JIRA_TOKEN",
        inputLabel: "API Token",
        inputPlaceholder: "your-jira-api-token",
        inputType: "password",
      },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Error tracking and performance monitoring",
    category: "engineering",
    icon: IconBug,
    envKeys: ["SENTRY_AUTH_TOKEN"],
    docsUrl: "https://docs.sentry.io/api/",
    walkthroughSteps: [
      {
        title: "Create an Auth Token",
        description:
          'Go to Sentry Settings > Auth Tokens. Create a token with "project:read", "org:read", and "event:read" scopes.',
        url: "https://sentry.io/settings/account/api/auth-tokens/",
        linkText: "Sentry Auth Tokens",
      },
      {
        title: "Enter your Auth Token",
        description: "Paste the auth token you just created.",
        inputKey: "SENTRY_AUTH_TOKEN",
        inputLabel: "Auth Token",
        inputPlaceholder: "sntrys_...",
        inputType: "password",
      },
    ],
  },
  {
    id: "grafana",
    name: "Grafana",
    description: "Prometheus metrics, dashboards, and alerts",
    category: "engineering",
    icon: IconActivity,
    envKeys: ["GRAFANA_URL", "GRAFANA_TOKEN"],
    docsUrl: "https://grafana.com/docs/grafana/latest/developers/http_api/",
    walkthroughSteps: [
      {
        title: "Get your Grafana URL",
        description:
          "The base URL of your Grafana instance (e.g., https://your-org.grafana.net).",
      },
      {
        title: "Create a Service Account Token",
        description:
          "In Grafana, go to Administration > Service accounts. Create an account with Viewer role and generate a token.",
        url: "https://grafana.com/docs/grafana/latest/administration/service-accounts/",
        linkText: "Service Accounts docs",
      },
      {
        title: "Enter your Grafana URL",
        description: "The base URL of your Grafana instance.",
        inputKey: "GRAFANA_URL",
        inputLabel: "Grafana URL",
        inputPlaceholder: "https://your-org.grafana.net",
        inputType: "text",
      },
      {
        title: "Enter your API Token",
        description: "Paste the service account token.",
        inputKey: "GRAFANA_TOKEN",
        inputLabel: "API Token",
        inputPlaceholder: "glsa_...",
        inputType: "password",
      },
    ],
  },
  {
    id: "gcloud",
    name: "Google IconCloud",
    description: "IconCloud Run, Functions, and infrastructure metrics",
    category: "engineering",
    icon: IconCloud,
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS_JSON"],
    docsUrl: "https://cloud.google.com/monitoring/api/v3",
    walkthroughSteps: [
      {
        title: "Create a service account",
        description:
          'Create a service account with "Monitoring Viewer" role and download the JSON key.',
        url: "https://console.cloud.google.com/iam-admin/serviceaccounts",
        linkText: "Service Accounts",
      },
      {
        title: "Enter your service account credentials",
        description:
          "Paste the contents of your service account JSON key file.",
        inputKey: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        inputLabel: "Service Account JSON",
        inputPlaceholder: '{"type": "service_account", ...}',
        inputType: "textarea",
      },
    ],
  },

  // --- Communication ---
  {
    id: "slack",
    name: "Slack",
    description: "Channel messages and workspace search",
    category: "communication",
    icon: IconMessage,
    envKeys: ["SLACK_TOKEN"],
    docsUrl: "https://api.slack.com/methods",
    walkthroughSteps: [
      {
        title: "Create a Slack App",
        description:
          "Go to api.slack.com/apps, create a new app, and add OAuth scopes: channels:read, channels:history, search:read.",
        url: "https://api.slack.com/apps",
        linkText: "Slack Apps",
      },
      {
        title: "Install the app to your workspace",
        description:
          'Under "OAuth & Permissions", install the app and copy the Bot User OAuth Token.',
      },
      {
        title: "Enter your Bot Token",
        description: 'Paste the Bot User OAuth Token (starts with "xoxb-").',
        inputKey: "SLACK_TOKEN",
        inputLabel: "Bot Token",
        inputPlaceholder: "xoxb-...",
        inputType: "password",
      },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Content calendar and editorial planning",
    category: "communication",
    icon: IconFileText,
    envKeys: ["NOTION_API_KEY"],
    docsUrl: "https://developers.notion.com/",
    walkthroughSteps: [
      {
        title: "Create a Notion Integration",
        description:
          "Go to notion.so/my-integrations, create a new integration, and select the workspace.",
        url: "https://www.notion.so/my-integrations",
        linkText: "Notion Integrations",
      },
      {
        title: "Share databases with the integration",
        description:
          'In Notion, open the databases you want to query and click "..." > "Connect to" > select your integration.',
      },
      {
        title: "Enter your API Key",
        description:
          'Copy the "Internal Integration Secret" from your integration settings.',
        inputKey: "NOTION_API_KEY",
        inputLabel: "Integration Secret",
        inputPlaceholder: "ntn_...",
        inputType: "password",
      },
    ],
  },
  {
    id: "twitter",
    name: "IconBrandX / X",
    description: "Tweet engagement and social metrics",
    category: "communication",
    icon: IconBrandX,
    envKeys: ["TWITTER_BEARER_TOKEN"],
    docsUrl: "https://developer.x.com/en/docs",
    walkthroughSteps: [
      {
        title: "Apply for a Developer Account",
        description:
          "Go to the X Developer Portal and apply for access (or sign in if you already have it).",
        url: "https://developer.x.com/en/portal/dashboard",
        linkText: "X Developer Portal",
      },
      {
        title: "Create a project and app",
        description:
          "Create a new project and app in the developer portal. Generate a Bearer Token under Keys and Tokens.",
      },
      {
        title: "Enter your Bearer Token",
        description: "Paste the Bearer Token from your app settings.",
        inputKey: "TWITTER_BEARER_TOKEN",
        inputLabel: "Bearer Token",
        inputPlaceholder: "AAAA...",
        inputType: "password",
      },
    ],
  },

  // --- Support ---
  {
    id: "pylon",
    name: "Pylon",
    description: "Support tickets and customer account lookup",
    category: "support",
    icon: IconHeadset,
    envKeys: ["PYLON_API_KEY"],
    docsUrl: "https://docs.usepylon.com/",
    walkthroughSteps: [
      {
        title: "Get your API Key",
        description: "In Pylon, go to Settings > API and generate an API key.",
      },
      {
        title: "Enter your API Key",
        description: "Paste the API key.",
        inputKey: "PYLON_API_KEY",
        inputLabel: "API Key",
        inputPlaceholder: "your-pylon-api-key",
        inputType: "password",
      },
    ],
  },
  {
    id: "commonroom",
    name: "Common Room",
    description: "Community member engagement and activity",
    category: "support",
    icon: IconUsers,
    envKeys: ["COMMONROOM_API_KEY"],
    docsUrl: "https://docs.commonroom.io/",
    walkthroughSteps: [
      {
        title: "Get your API Key",
        description:
          "In Common Room, go to Settings > API Keys and create a new key.",
      },
      {
        title: "Enter your API Key",
        description: "Paste the API key.",
        inputKey: "COMMONROOM_API_KEY",
        inputLabel: "API Key",
        inputPlaceholder: "your-commonroom-api-key",
        inputType: "password",
      },
    ],
  },

  // --- SEO ---
  {
    id: "dataforseo",
    name: "DataForSEO",
    description: "Keyword rankings, search volume, and SEO metrics",
    category: "seo",
    icon: IconSearch,
    envKeys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    docsUrl: "https://docs.dataforseo.com/",
    walkthroughSteps: [
      {
        title: "Create a DataForSEO account",
        description:
          "Sign up at DataForSEO and find your API credentials on the dashboard.",
        url: "https://app.dataforseo.com/api-dashboard",
        linkText: "DataForSEO Dashboard",
      },
      {
        title: "Enter your Login",
        description: "Your DataForSEO login email.",
        inputKey: "DATAFORSEO_LOGIN",
        inputLabel: "Login",
        inputPlaceholder: "you@company.com",
        inputType: "text",
      },
      {
        title: "Enter your Password",
        description: "Your DataForSEO API password.",
        inputKey: "DATAFORSEO_PASSWORD",
        inputLabel: "Password",
        inputPlaceholder: "your-dataforseo-password",
        inputType: "password",
      },
    ],
  },
];

export function getDataSourceById(id: string): DataSource | undefined {
  return dataSources.find((ds) => ds.id === id);
}

export function getDataSourcesByCategory(
  category: DataSourceCategory,
): DataSource[] {
  return dataSources.filter((ds) => ds.category === category);
}
