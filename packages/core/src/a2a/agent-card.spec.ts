import { describe, it, expect } from "vitest";
import { generateAgentCard } from "./agent-card.js";
import type { A2AConfig } from "./types.js";

describe("generateAgentCard", () => {
  const baseConfig: A2AConfig = {
    name: "Test Agent",
    description: "A test agent",
    skills: [
      {
        id: "test-skill",
        name: "Test",
        description: "Does testing",
      },
    ],
  };

  it("generates a card with required fields", () => {
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.name).toBe("Test Agent");
    expect(card.description).toBe("A test agent");
    expect(card.url).toBe("https://example.com");
    expect(card.protocolVersion).toBe("0.3");
    expect(card.skills).toHaveLength(1);
  });

  it("defaults version to 1.0.0", () => {
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.version).toBe("1.0.0");
  });

  it("uses custom version when provided", () => {
    const card = generateAgentCard(
      { ...baseConfig, version: "2.5.0" },
      "https://example.com",
    );
    expect(card.version).toBe("2.5.0");
  });

  it("defaults streaming to false", () => {
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.capabilities.streaming).toBe(false);
  });

  it("enables streaming when configured", () => {
    const card = generateAgentCard(
      { ...baseConfig, streaming: true },
      "https://example.com",
    );
    expect(card.capabilities.streaming).toBe(true);
  });

  it("always sets pushNotifications to false and stateTransitionHistory to true", () => {
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.capabilities.stateTransitionHistory).toBe(true);
  });

  it("does not include security when apiKeyEnv is not set", () => {
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.securitySchemes).toBeUndefined();
    expect(card.security).toBeUndefined();
  });

  it("includes security schemes when apiKeyEnv is set", () => {
    const card = generateAgentCard(
      { ...baseConfig, apiKeyEnv: "MY_API_KEY" },
      "https://example.com",
    );
    expect(card.securitySchemes).toEqual({
      apiKey: { type: "http", scheme: "bearer" },
    });
    expect(card.security).toEqual([{ apiKey: [] }]);
  });
});
