import { describe, expect, it } from "vitest";

import {
  AGENT_PROVIDER_CATALOG,
  type AgentProviderId,
} from "./agent-provider-catalog.js";

describe("agent provider catalog", () => {
  it.each<AgentProviderId>([
    "anthropic",
    "openai",
    "openrouter",
    "google",
    "groq",
    "mistral",
    "cohere",
    "ollama",
  ])("allows custom model IDs for %s", (provider) => {
    expect(
      AGENT_PROVIDER_CATALOG.find((option) => option.id === provider)
        ?.supportsCustomModel,
    ).toBe(true);
  });
});
