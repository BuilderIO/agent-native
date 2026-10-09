import { describe, expect, it } from "vitest";

import {
  isCodeAgentModelConfigured,
  requiresConfiguredCodeAgentProvider,
} from "./code-agent-readiness.js";

describe("code agent provider admission", () => {
  it("matches readiness to the selected Desktop model", () => {
    const models = [
      { engine: "openai", model: "gpt-5", configured: true },
      { engine: "anthropic", model: "claude-sonnet", configured: false },
    ];

    expect(
      isCodeAgentModelConfigured(models, {
        engine: "openai",
        model: "gpt-5",
      }),
    ).toBe(true);
    expect(
      isCodeAgentModelConfigured(models, {
        engine: "anthropic",
        model: "claude-sonnet",
      }),
    ).toBe(false);
    expect(
      isCodeAgentModelConfigured(models, {
        engine: "openai",
        model: "gpt-5-mini",
      }),
    ).toBe(false);
  });

  it("requires a configured provider before starting desktop app creation", () => {
    expect(
      requiresConfiguredCodeAgentProvider({
        providerConfigured: false,
        localCodeChange: false,
        executionTarget: "local",
      }),
    ).toBe(true);
  });

  it("keeps the explicit local-code and portal execution lanes", () => {
    expect(
      requiresConfiguredCodeAgentProvider({
        providerConfigured: false,
        localCodeChange: true,
        executionTarget: "local",
      }),
    ).toBe(false);
    expect(
      requiresConfiguredCodeAgentProvider({
        providerConfigured: false,
        localCodeChange: false,
        executionTarget: "portal",
      }),
    ).toBe(false);
  });

  it("admits configured providers on every execution target", () => {
    expect(
      requiresConfiguredCodeAgentProvider({
        providerConfigured: true,
        localCodeChange: false,
        executionTarget: "local",
      }),
    ).toBe(false);
  });
});
