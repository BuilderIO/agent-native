import { describe, expect, it } from "vitest";

import { resolveAgentProviderLogo } from "./agent-provider-logo.js";

describe("resolveAgentProviderLogo", () => {
  it("returns distinct catalog identities for configured cloud providers", () => {
    const builder = resolveAgentProviderLogo("builder", "Builder");
    const anthropic = resolveAgentProviderLogo("anthropic", "Anthropic");
    const openai = resolveAgentProviderLogo("ai-sdk:openai", "OpenAI");
    const openrouter = resolveAgentProviderLogo(
      "ai-sdk:openrouter",
      "OpenRouter",
    );
    const google = resolveAgentProviderLogo("ai-sdk:google", "Google Gemini");

    expect([
      builder.integrationId,
      anthropic.integrationId,
      openai.integrationId,
      openrouter.integrationId,
      google.integrationId,
    ]).toEqual([
      "builder-cms",
      "anthropic",
      "openai",
      "openrouter",
      "google-gemini",
    ]);
    expect(
      new Set([
        builder.logoUrl,
        anthropic.logoUrl,
        openai.logoUrl,
        openrouter.logoUrl,
        google.logoUrl,
      ]).size,
    ).toBe(5);
    expect(openai.logoUrl).toMatch(/^data:image\/png;base64,/);
    expect(openrouter.logoUrl).toMatch(/^data:image\/x-icon;base64,/);
  });

  it("uses honest fallbacks for local and unknown engines", () => {
    expect(resolveAgentProviderLogo("ai-sdk:ollama", "Ollama")).toEqual({
      integrationId: null,
      label: "Ollama",
      logoUrl: "",
      fallback: "local",
    });
    expect(
      resolveAgentProviderLogo("custom-runtime", "Private runtime"),
    ).toEqual({
      integrationId: null,
      label: "Private runtime",
      logoUrl: "",
      fallback: "unknown",
    });
  });
});
