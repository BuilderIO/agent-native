import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS,
  DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
  DEFAULT_BUILDER_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS,
  defaultMaxOutputTokensForEngine,
  normalizeMaxOutputTokens,
  resolveMaxOutputTokensForEngine,
} from "./output-tokens.js";

describe("agent output-token policy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses provider-specific defaults", () => {
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

  it("OpenRouter default is 8192 (not truncation-prone 1024)", () => {
    expect(DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS).toBe(8192);
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

  it("clamp allows values up to 64000", () => {
    // The global clamp was raised from 32768 to 64000 to support Sonnet 4.6
    // and GPT-5.x which support 64K+ output tokens.
    expect(normalizeMaxOutputTokens(64_000)).toBe(64_000);
    // Stays clamped at 64000 for values above it.
    expect(normalizeMaxOutputTokens(100_000)).toBe(64_000);
    // Still rejects values below minimum.
    expect(normalizeMaxOutputTokens(100)).toBe(256);
  });
});
