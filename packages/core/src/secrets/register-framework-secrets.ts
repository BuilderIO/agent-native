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
 * NOTE: The framework previously registered OPENAI_API_KEY here for Whisper
 * voice transcription. Voice transcription now routes through the Builder.io
 * gateway (or Groq as a BYOK fallback), so the framework no longer registers
 * the OpenAI key. Templates that need it (e.g. Clips) register it themselves.
 */

import { getRequiredSecret, registerRequiredSecret } from "./register.js";

export function registerFrameworkSecrets(): void {
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
