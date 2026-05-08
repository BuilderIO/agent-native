import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { hasCredential } from "../server/lib/credentials";
import { credentialKeys } from "../server/lib/credential-keys";
import { tryRequestCredentialContext } from "../server/lib/credentials-context";

const credentialAliases: Record<string, string[]> = {
  amplitude: ["AMPLITUDE_API_KEY", "AMPLITUDE_SECRET_KEY"],
  apollo: ["APOLLO_API_KEY"],
  bigquery: [
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "BIGQUERY_PROJECT_ID",
    "ANALYTICS_BIGQUERY_EVENTS_TABLE",
  ],
  commonroom: ["COMMONROOM_API_TOKEN"],
  dataforseo: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
  ga4: ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GA4_PROPERTY_ID"],
  github: ["GITHUB_TOKEN"],
  gcloud: ["GOOGLE_APPLICATION_CREDENTIALS_JSON"],
  gong: ["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET", "GONG_API_BASE"],
  grafana: ["GRAFANA_URL", "GRAFANA_API_TOKEN"],
  hubspot: ["HUBSPOT_ACCESS_TOKEN"],
  jira: ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
  mixpanel: ["MIXPANEL_PROJECT_ID", "MIXPANEL_SERVICE_ACCOUNT"],
  notion: ["NOTION_API_KEY"],
  postgresql: ["POSTGRES_URL"],
  postgres: ["POSTGRES_URL"],
  posthog: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"],
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

export function resolveCredentialConfigs(key?: string) {
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

export default defineAction({
  description:
    "List which analytics data-source credentials are configured without revealing secret values. The `key` arg accepts exact credential names like JIRA_API_TOKEN and provider aliases like jira, pylon, bigquery, hubspot, gong, or slack.",
  schema: z.object({
    key: z
      .string()
      .optional()
      .describe(
        "Optional credential key or provider alias to check, e.g. jira, pylon, bigquery, or SENTRY_AUTH_TOKEN",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ctx = tryRequestCredentialContext();
    if (!ctx) {
      return {
        error: "missing_api_key",
        key: "AUTH",
        label: "Authentication",
        message: "Sign in to view credential status.",
        settingsPath: "/data-sources",
      };
    }

    const { configs, known } = resolveCredentialConfigs(args.key);
    if (args.key && !known) {
      return { error: `Unknown credential key: ${args.key}` };
    }

    const results = await Promise.all(
      configs.map(async (cfg) => ({
        key: cfg.key,
        label: cfg.label,
        required: cfg.required,
        configured: await hasCredential(cfg.key, ctx),
      })),
    );
    return { credentials: results, total: results.length };
  },
});
