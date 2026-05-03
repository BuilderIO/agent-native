import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { generateAgentCard } from "./agent-card.js";
import type { A2AConfig } from "./types.js";

describe("generateAgentCard", () => {
  beforeEach(() => {
    vi.stubEnv("A2A_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_LOCAL", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
    vi.stubEnv("CF_PAGES", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RENDER", "");
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("K_SERVICE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
    expect(card.url).toBe("https://example.com/_agent-native/a2a");
    expect(card.protocolVersion).toBe("0.3");
    expect(card.skills).toHaveLength(1);
  });

  it("includes APP_BASE_PATH in the advertised A2A endpoint URL", () => {
    vi.stubEnv("APP_BASE_PATH", "/starter");
    const card = generateAgentCard(baseConfig, "https://workspace.example.com");
    expect(card.url).toBe(
      "https://workspace.example.com/starter/_agent-native/a2a",
    );
  });

  it("does not duplicate APP_BASE_PATH when the base URL is already scoped", () => {
    vi.stubEnv("APP_BASE_PATH", "/starter");
    const card = generateAgentCard(
      baseConfig,
      "https://workspace.example.com/starter",
    );
    expect(card.url).toBe(
      "https://workspace.example.com/starter/_agent-native/a2a",
    );
  });

  it("does not duplicate the A2A endpoint path when already present", () => {
    vi.stubEnv("APP_BASE_PATH", "/dispatch");
    const card = generateAgentCard(
      baseConfig,
      "https://agent-workspace.builder.io/dispatch/_agent-native/a2a",
    );
    expect(card.url).toBe(
      "https://agent-workspace.builder.io/dispatch/_agent-native/a2a",
    );
  });

  it("supports custom mounted A2A route prefixes", () => {
    vi.stubEnv("APP_BASE_PATH", "/dispatch");
    const card = generateAgentCard(
      baseConfig,
      "https://agent-workspace.builder.io",
      "/rpc/a2a",
    );
    expect(card.url).toBe(
      "https://agent-workspace.builder.io/dispatch/rpc/a2a",
    );
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

  it("advertises JWT bearer auth when A2A_SECRET is configured", () => {
    vi.stubEnv("A2A_SECRET", "shared-secret");
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.securitySchemes).toEqual({
      jwtBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    });
    expect(card.security).toEqual([{ jwtBearer: [] }]);
  });

  it("advertises JWT bearer auth on hosted runtimes", () => {
    vi.stubEnv("NETLIFY", "true");
    const card = generateAgentCard(baseConfig, "https://example.com");
    expect(card.securitySchemes).toEqual({
      jwtBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    });
    expect(card.security).toEqual([{ jwtBearer: [] }]);
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

  it("advertises JWT and legacy API key auth as alternatives when both are configured", () => {
    vi.stubEnv("A2A_SECRET", "shared-secret");
    const card = generateAgentCard(
      { ...baseConfig, apiKeyEnv: "MY_API_KEY" },
      "https://example.com",
    );
    expect(card.securitySchemes).toEqual({
      jwtBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      apiKey: { type: "http", scheme: "bearer" },
    });
    expect(card.security).toEqual([{ jwtBearer: [] }, { apiKey: [] }]);
  });
});
