import { defineEventHandler, readBody } from "h3";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { source } = body as { source?: string };

  if (!source) {
    return { ok: false, error: "Missing 'source' parameter" };
  }

  try {
    switch (source) {
      case "bigquery": {
        const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        const project = process.env.BIGQUERY_PROJECT_ID;
        if (!creds || !project)
          return { ok: false, error: "Missing credentials" };
        const { runQuery } = await import("../../lib/bigquery");
        await runQuery("SELECT 1 AS test");
        return { ok: true };
      }

      case "google-analytics": {
        const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        const propertyId = process.env.GA4_PROPERTY_ID;
        if (!creds || !propertyId)
          return { ok: false, error: "Missing credentials" };
        const { testConnection } = await import("../../lib/google-analytics");
        return await testConnection();
      }

      case "amplitude": {
        const apiKey = process.env.AMPLITUDE_API_KEY;
        const secretKey = process.env.AMPLITUDE_SECRET_KEY;
        if (!apiKey || !secretKey)
          return { ok: false, error: "Missing credentials" };
        const { testConnection } = await import("../../lib/amplitude");
        return await testConnection();
      }

      case "mixpanel": {
        const projectId = process.env.MIXPANEL_PROJECT_ID;
        const sa = process.env.MIXPANEL_SERVICE_ACCOUNT;
        if (!projectId || !sa)
          return { ok: false, error: "Missing credentials" };
        const { testConnection } = await import("../../lib/mixpanel");
        return await testConnection();
      }

      case "posthog": {
        const apiKey = process.env.POSTHOG_API_KEY;
        const projectId = process.env.POSTHOG_PROJECT_ID;
        if (!apiKey || !projectId)
          return { ok: false, error: "Missing credentials" };
        const { testConnection } = await import("../../lib/posthog");
        return await testConnection();
      }

      case "postgresql": {
        const url = process.env.POSTGRES_URL;
        if (!url) return { ok: false, error: "Missing connection URL" };
        const { testConnection } = await import("../../lib/postgres");
        return await testConnection();
      }

      case "stripe": {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return { ok: false, error: "Missing secret key" };
        const res = await fetch("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) return { ok: false, error: "Invalid API key" };
        return { ok: true };
      }

      case "hubspot": {
        const token = process.env.HUBSPOT_ACCESS_TOKEN;
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
        const token = process.env.GITHUB_TOKEN;
        if (!token) return { ok: false, error: "Missing token" };
        const res = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { ok: false, error: "Invalid token" };
        return { ok: true };
      }

      case "jira": {
        const email = process.env.JIRA_EMAIL;
        const token = process.env.JIRA_TOKEN;
        if (!email || !token)
          return { ok: false, error: "Missing credentials" };
        return { ok: true };
      }

      case "sentry": {
        const token = process.env.SENTRY_AUTH_TOKEN;
        if (!token) return { ok: false, error: "Missing auth token" };
        const res = await fetch("https://sentry.io/api/0/organizations/", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { ok: false, error: "Invalid auth token" };
        return { ok: true };
      }

      case "grafana": {
        const url = process.env.GRAFANA_URL;
        const token = process.env.GRAFANA_TOKEN;
        if (!url || !token) return { ok: false, error: "Missing credentials" };
        const res = await fetch(`${url}/api/org`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { ok: false, error: "Connection failed" };
        return { ok: true };
      }

      case "gcloud": {
        const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        if (!creds) return { ok: false, error: "Missing credentials" };
        return { ok: true };
      }

      case "slack": {
        const token = process.env.SLACK_TOKEN;
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
        const key = process.env.NOTION_API_KEY;
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
        const token = process.env.TWITTER_BEARER_TOKEN;
        if (!token) return { ok: false, error: "Missing bearer token" };
        return { ok: true };
      }

      case "pylon": {
        const key = process.env.PYLON_API_KEY;
        if (!key) return { ok: false, error: "Missing API key" };
        return { ok: true };
      }

      case "commonroom": {
        const key = process.env.COMMONROOM_API_KEY;
        if (!key) return { ok: false, error: "Missing API key" };
        return { ok: true };
      }

      case "dataforseo": {
        const login = process.env.DATAFORSEO_LOGIN;
        const password = process.env.DATAFORSEO_PASSWORD;
        if (!login || !password)
          return { ok: false, error: "Missing credentials" };
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown source: ${source}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || "Connection test failed" };
  }
});
