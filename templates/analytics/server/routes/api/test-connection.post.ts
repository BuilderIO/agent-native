import { defineEventHandler } from "h3";
import { resolveCredential } from "../../lib/credentials";
import { withRequestContextFromEvent } from "../../lib/credentials";
import { readBody } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { source } = body as { source?: string };

  if (!source) {
    return { ok: false, error: "Missing 'source' parameter" };
  }

  const result = await withRequestContextFromEvent(event, async (ctx) => {
    try {
      switch (source) {
        case "bigquery": {
          const creds = await resolveCredential(
            "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            ctx,
          );
          const project = await resolveCredential("BIGQUERY_PROJECT_ID", ctx);
          if (!creds || !project)
            return { ok: false, error: "Missing credentials" };
          const { runQuery } = await import("../../lib/bigquery");
          await runQuery("SELECT 1 AS test");
          return { ok: true };
        }

        case "google-analytics": {
          const creds = await resolveCredential(
            "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            ctx,
          );
          const propertyId = await resolveCredential("GA4_PROPERTY_ID", ctx);
          if (!creds || !propertyId)
            return { ok: false, error: "Missing credentials" };
          const { testConnection } = await import("../../lib/google-analytics");
          return await testConnection();
        }

        case "amplitude": {
          const apiKey = await resolveCredential("AMPLITUDE_API_KEY", ctx);
          const secretKey = await resolveCredential(
            "AMPLITUDE_SECRET_KEY",
            ctx,
          );
          if (!apiKey || !secretKey)
            return { ok: false, error: "Missing credentials" };
          const { testConnection } = await import("../../lib/amplitude");
          return await testConnection();
        }

        case "mixpanel": {
          const projectId = await resolveCredential("MIXPANEL_PROJECT_ID", ctx);
          const sa = await resolveCredential("MIXPANEL_SERVICE_ACCOUNT", ctx);
          if (!projectId || !sa)
            return { ok: false, error: "Missing credentials" };
          const { testConnection } = await import("../../lib/mixpanel");
          return await testConnection();
        }

        case "posthog": {
          const apiKey = await resolveCredential("POSTHOG_API_KEY", ctx);
          const projectId = await resolveCredential("POSTHOG_PROJECT_ID", ctx);
          if (!apiKey || !projectId)
            return { ok: false, error: "Missing credentials" };
          const { testConnection } = await import("../../lib/posthog");
          return await testConnection();
        }

        case "postgresql": {
          const url = await resolveCredential("POSTGRES_URL", ctx);
          if (!url) return { ok: false, error: "Missing connection URL" };
          const { testConnection } = await import("../../lib/postgres");
          return await testConnection();
        }

        case "stripe": {
          const key = await resolveCredential("STRIPE_SECRET_KEY", ctx);
          if (!key) return { ok: false, error: "Missing secret key" };
          const res = await fetch("https://api.stripe.com/v1/balance", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!res.ok) return { ok: false, error: "Invalid API key" };
          return { ok: true };
        }

        case "hubspot": {
          const token = await resolveCredential("HUBSPOT_ACCESS_TOKEN", ctx);
          if (!token) return { ok: false, error: "Missing access token" };
          const res = await fetch(
            "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (!res.ok) return { ok: false, error: "Invalid access token" };
          return { ok: true };
        }

        case "github": {
          const token = await resolveCredential("GITHUB_TOKEN", ctx);
          if (!token) return { ok: false, error: "Missing token" };
          const res = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return { ok: false, error: "Invalid token" };
          return { ok: true };
        }

        case "jira": {
          const baseUrl = await resolveCredential("JIRA_BASE_URL", ctx);
          const email = await resolveCredential("JIRA_USER_EMAIL", ctx);
          const token = await resolveCredential("JIRA_API_TOKEN", ctx);
          if (!baseUrl || !email || !token)
            return { ok: false, error: "Missing credentials" };
          return { ok: true };
        }

        case "sentry": {
          const token = await resolveCredential("SENTRY_AUTH_TOKEN", ctx);
          if (!token) return { ok: false, error: "Missing auth token" };
          const res = await fetch("https://sentry.io/api/0/organizations/", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return { ok: false, error: "Invalid auth token" };
          return { ok: true };
        }

        case "grafana": {
          const url = await resolveCredential("GRAFANA_URL", ctx);
          const token = await resolveCredential("GRAFANA_API_TOKEN", ctx);
          if (!url || !token)
            return { ok: false, error: "Missing credentials" };
          const res = await fetch(`${url}/api/org`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return { ok: false, error: "Connection failed" };
          return { ok: true };
        }

        case "gcloud": {
          const creds = await resolveCredential(
            "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            ctx,
          );
          if (!creds) return { ok: false, error: "Missing credentials" };
          return { ok: true };
        }

        case "slack": {
          const token = await resolveCredential("SLACK_BOT_TOKEN", ctx);
          if (!token) return { ok: false, error: "Missing token" };
          const res = await fetch("https://slack.com/api/auth.test", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!data.ok)
            return { ok: false, error: data.error || "Invalid token" };
          return { ok: true };
        }

        case "notion": {
          const key = await resolveCredential("NOTION_API_KEY", ctx);
          if (!key) return { ok: false, error: "Missing API key" };
          const res = await fetch("https://api.notion.com/v1/users/me", {
            headers: {
              Authorization: `Bearer ${key}`,
              "Notion-Version": "2022-06-28",
            },
          });
          if (!res.ok) return { ok: false, error: "Invalid API key" };
          return { ok: true };
        }

        case "twitter": {
          const token = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
          if (!token) return { ok: false, error: "Missing bearer token" };
          return { ok: true };
        }

        case "pylon": {
          const key = await resolveCredential("PYLON_API_KEY", ctx);
          if (!key) return { ok: false, error: "Missing API key" };
          return { ok: true };
        }

        case "commonroom": {
          const key = await resolveCredential("COMMONROOM_API_TOKEN", ctx);
          if (!key) return { ok: false, error: "Missing API key" };
          return { ok: true };
        }

        case "dataforseo": {
          const login = await resolveCredential("DATAFORSEO_LOGIN", ctx);
          const password = await resolveCredential("DATAFORSEO_PASSWORD", ctx);
          if (!login || !password)
            return { ok: false, error: "Missing credentials" };
          return { ok: true };
        }

        case "gong": {
          const accessKey = await resolveCredential("GONG_ACCESS_KEY", ctx);
          const secret = await resolveCredential("GONG_ACCESS_SECRET", ctx);
          if (!accessKey || !secret)
            return { ok: false, error: "Missing credentials" };
          const auth = `Basic ${Buffer.from(`${accessKey}:${secret}`).toString("base64")}`;
          const res = await fetch(
            "https://us-65885.api.gong.io/v2/users?limit=1",
            { headers: { Authorization: auth } },
          );
          if (!res.ok) return { ok: false, error: "Invalid credentials" };
          return { ok: true };
        }

        default:
          return { ok: false, error: `Unknown source: ${source}` };
      }
    } catch (err: any) {
      return { ok: false, error: err.message || "Connection test failed" };
    }
  });

  if (result === null) {
    return { ok: false, error: "Sign in to test data sources." };
  }
  return result;
});
