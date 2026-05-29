import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS,
  DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
  DEFAULT_BUILDER_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS,
  defaultMaxOutputTokensForEngine,
  resolveMaxOutputTokensForEngine,
} from "./output-tokens.js";

describe("agent output-token policy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses conservative provider-specific defaults", () => {
    expect(defaultMaxOutputTokensForEngine("ai-sdk:openrouter")).toBe(
      DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS,
    );
    expect(defaultMaxOutputTokensForEngine("ai-sdk:openai")).toBe(
      DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS,
    );
    expect(defaultMaxOutputTokensForEngine("anthropic")).toBe(
      DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
    );
    expect(defaultMaxOutputTokensForEngine("builder")).toBe(
      DEFAULT_BUILDER_MAX_OUTPUT_TOKENS,
    );
  });

  it("lets provider-specific env overrides beat the global override", () => {
    vi.stubEnv("AGENT_MAX_OUTPUT_TOKENS", "2048");
    vi.stubEnv("AGENT_OPENROUTER_MAX_OUTPUT_TOKENS", "768");

    expect(defaultMaxOutputTokensForEngine("ai-sdk:openai")).toBe(2048);
    expect(defaultMaxOutputTokensForEngine("ai-sdk:openrouter")).toBe(768);
  });

  it("keeps explicit per-call overrides highest priority", () => {
    vi.stubEnv("AGENT_MAX_OUTPUT_TOKENS", "2048");

    expect(resolveMaxOutputTokensForEngine("ai-sdk:openrouter", 512)).toBe(512);
  });
});
