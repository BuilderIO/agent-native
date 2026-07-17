/**
 * Framework-level secret registrations.
 *
 * Side-effect module — imported by the core-routes plugin at boot so the
 * sidebar settings UI and the `/_agent-native/secrets` list route surface the
 * relevant keys in every template.
 *
 * Each call uses a `getRequiredSecret` guard so a template that has already
 * registered the same key (often with stricter settings like `required: true`)
 * wins — the framework registration is a fallback, not an override.
 *
 * OPENAI_API_KEY is optional framework-wide because it enables the shared
 * realtime speech-to-speech agent mode. Templates can pre-register the same
 * key with stricter requirements; the guard below preserves their definition.
 */

import { getRequiredSecret, registerRequiredSecret } from "./register.js";

export function registerFrameworkSecrets(): void {
  const workspaceOAuthProviders = [
    {
      id: "figma",
      credentialPrefix: "FIGMA",
      oauthProvider: "figma",
      label: "Figma",
      docsUrl: "https://developers.figma.com/docs/rest-api/oauth-apps/",
    },
    {
      id: "google_drive",
      credentialPrefix: "GOOGLE",
      oauthProvider: "google",
      label: "Google Drive",
      docsUrl:
        "https://developers.google.com/identity/protocols/oauth2/web-server",
    },
    {
      id: "github",
      credentialPrefix: "GITHUB",
      oauthProvider: "github",
      label: "GitHub",
      docsUrl: "https://docs.github.com/apps/oauth-apps/building-oauth-apps",
    },
    {
      id: "hubspot",
      credentialPrefix: "HUBSPOT",
      oauthProvider: "hubspot",
      label: "HubSpot",
      docsUrl:
        "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide",
    },
    {
      id: "jira",
      credentialPrefix: "JIRA",
      oauthProvider: "jira",
      label: "Jira Cloud",
      docsUrl:
        "https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/",
    },
    {
      id: "sentry",
      credentialPrefix: "SENTRY",
      oauthProvider: "sentry",
      label: "Sentry",
      docsUrl: "https://docs.sentry.io/api/auth/",
    },
    {
      id: "notion",
      credentialPrefix: "NOTION",
      oauthProvider: "notion",
      label: "Notion",
      docsUrl: "https://developers.notion.com/docs/authorization",
    },
  ] as const;

  for (const provider of workspaceOAuthProviders) {
    const prefix = provider.credentialPrefix;
    for (const credential of [
      { suffix: "CLIENT_ID", label: "OAuth client ID" },
      { suffix: "CLIENT_SECRET", label: "OAuth client secret" },
    ] as const) {
      const key = `${prefix}_${credential.suffix}`;
      if (!getRequiredSecret(key)) {
        registerRequiredSecret({
          key,
          label: `${provider.label} ${credential.label}`,
          description: `Workspace-owned ${provider.label} OAuth application credential. Tokens granted by users are stored separately and encrypted.`,
          docsUrl: provider.docsUrl,
          scope: "workspace",
          kind: "api-key",
          required: false,
        });
      }
    }

    const connectionKey = `${prefix}_CONNECTED`;
    if (!getRequiredSecret(connectionKey)) {
      registerRequiredSecret({
        key: connectionKey,
        label: `${provider.label} account`,
        description: `Connect a ${provider.label} account for scoped workspace imports.`,
        docsUrl: provider.docsUrl,
        scope: "user",
        kind: "oauth",
        required: false,
        oauthProvider: provider.oauthProvider,
        oauthConnectUrl: `/_agent-native/connections/oauth/${provider.id}/start`,
      });
    }
  }

  if (!getRequiredSecret("OPENAI_API_KEY")) {
    registerRequiredSecret({
      key: "OPENAI_API_KEY",
      label: "OpenAI API key",
      description:
        "Optional fallback for realtime voice when Builder is not connected, and for OpenAI transcription.",
      docsUrl: "https://platform.openai.com/api-keys",
      scope: "user",
      kind: "api-key",
      required: false,
      validator: async (value) => {
        const response = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${value}` },
        });
        return response.ok
          ? { ok: true }
          : {
              ok: false,
              error: `OpenAI rejected the key (HTTP ${response.status}).`,
            };
      },
    });
  }

  // Web-search tool backends — optional; the tool selects the first
  // configured manual key at call time, then falls back to Builder Connect.
  const webSearchKeys: Array<{
    key: string;
    label: string;
    description: string;
    docsUrl: string;
  }> = [
    {
      key: "BRAVE_SEARCH_API_KEY",
      label: "Brave Search API Key",
      description:
        "Enables the web-search agent tool via Brave Search. Optional when Builder.io is connected for managed web search.",
      docsUrl: "https://brave.com/search/api/",
    },
    {
      key: "TAVILY_API_KEY",
      label: "Tavily API Key",
      description:
        "Enables the web-search agent tool via Tavily. Used as fallback when BRAVE_SEARCH_API_KEY is not set and before Builder-managed search.",
      docsUrl: "https://tavily.com/",
    },
    {
      key: "EXA_API_KEY",
      label: "Exa API Key",
      description:
        "Enables the web-search agent tool via Exa. Used as fallback when Brave and Tavily are not set and before Builder-managed search.",
      docsUrl: "https://exa.ai/",
    },
    {
      key: "FIRECRAWL_API_KEY",
      label: "Firecrawl API Key",
      description:
        "Enables the web-search agent tool via Firecrawl. Used as fallback when Brave, Tavily, and Exa are not set and before Builder-managed search.",
      docsUrl: "https://firecrawl.dev/",
    },
  ];

  for (const entry of webSearchKeys) {
    if (!getRequiredSecret(entry.key)) {
      registerRequiredSecret({
        key: entry.key,
        label: entry.label,
        description: entry.description,
        docsUrl: entry.docsUrl,
        scope: "workspace",
        kind: "api-key",
        required: false,
      });
    }
  }

  if (!getRequiredSecret("GITHUB_TOKEN")) {
    registerRequiredSecret({
      key: "GITHUB_TOKEN",
      label: "GitHub token",
      description:
        "Enables connector-scoped repository file reads and writes for headless/cloud agent runs.",
      docsUrl:
        "https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
      scope: "workspace",
      kind: "api-key",
      required: false,
    });
  }
}
