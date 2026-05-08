import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { hasCredential } from "../server/lib/credentials";
import { resolveCredentialConfigs } from "../server/lib/credential-keys";
import { tryRequestCredentialContext } from "../server/lib/credentials-context";

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
