import { describe, expect, it } from "vitest";

import { providerLogoForKey, shortProviderName } from "./KeyProviderTile.js";

describe("providerLogoForKey", () => {
  it.each([
    ["OPENAI_API_KEY", "openai"],
    ["ANTHROPIC_API_KEY", "anthropic"],
    ["OPENROUTER_API_KEY", "openrouter"],
    ["GOOGLE_GENERATIVE_AI_API_KEY", "google-gemini"],
    ["GOOGLE_CLOUD_API_KEY", "google-workspace"],
    ["GROQ_API_KEY", "groq"],
    ["MISTRAL_API_KEY", "mistral"],
    ["COHERE_API_KEY", "cohere"],
    ["GITHUB_TOKEN", "github"],
    ["FIGMA_ACCESS_TOKEN", "figma"],
    ["NOTION_API_KEY", "notion"],
    ["SLACK_BOT_TOKEN", "slack"],
    ["SENTRY_AUTH_TOKEN", "sentry"],
    ["STRIPE_SECRET_KEY", "stripe"],
    ["HUBSPOT_API_KEY", "hubspot"],
    ["SALESFORCE_TOKEN", "salesforce"],
    ["JIRA_API_TOKEN", "jira"],
    ["POSTHOG_API_KEY", "posthog"],
    ["BRAVE_SEARCH_API_KEY", "brave"],
    ["TAVILY_API_KEY", "tavily"],
    ["EXA_API_KEY", "exa"],
    ["FIRECRAWL_API_KEY", "firecrawl"],
  ])("maps %s to the %s logo", (key, id) => {
    expect(providerLogoForKey(key)?.id).toBe(id);
  });

  it("returns null for an unmapped prefix", () => {
    expect(providerLogoForKey("SOME_RANDOM_KEY")).toBeNull();
  });
});

describe("shortProviderName", () => {
  it("strips the common key-name suffixes", () => {
    expect(shortProviderName("OpenAI API key")).toBe("OpenAI");
    expect(shortProviderName("GitHub access token")).toBe("GitHub");
  });
});
