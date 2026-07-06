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

  it("clamps to the conservative 64000 ceiling when no model is given", () => {
    expect(normalizeMaxOutputTokens(64_000)).toBe(64_000);
    // Stays clamped at 64000 for values above it.
    expect(normalizeMaxOutputTokens(100_000)).toBe(64_000);
    // Still rejects values below minimum.
    expect(normalizeMaxOutputTokens(100)).toBe(256);
  });

  it("uses the model-aware ceiling for models documented above 64K", () => {
    // GPT-5.x documents 128K max output tokens.
    expect(normalizeMaxOutputTokens(128_000, "gpt-5.5")).toBe(128_000);
    expect(normalizeMaxOutputTokens(200_000, "gpt-5.4")).toBe(128_000);
    // Builder gateway dashed form.
    expect(normalizeMaxOutputTokens(128_000, "gpt-5-5")).toBe(128_000);
    // Claude flagship models document 128K max output tokens.
    expect(normalizeMaxOutputTokens(128_000, "claude-sonnet-5")).toBe(128_000);
    expect(normalizeMaxOutputTokens(128_000, "claude-opus-4-8")).toBe(128_000);
  });

  it("keeps the 64K ceiling for 64K-documented and unknown models", () => {
    // Claude Haiku 4.5 documents 64K max output tokens.
    expect(normalizeMaxOutputTokens(128_000, "claude-haiku-4-5")).toBe(64_000);
    // Unknown models keep the conservative ceiling.
    expect(normalizeMaxOutputTokens(128_000, "some-unknown-model")).toBe(
      64_000,
    );
  });

  it("threads the model through resolve for explicit values and env overrides", () => {
    expect(
      resolveMaxOutputTokensForEngine("ai-sdk:openai", 128_000, "gpt-5.5"),
    ).toBe(128_000);
    expect(
      resolveMaxOutputTokensForEngine("ai-sdk:openai", 128_000, "gpt-5.4-mini"),
    ).toBe(128_000);

    vi.stubEnv("AGENT_MAX_OUTPUT_TOKENS", "128000");
    expect(defaultMaxOutputTokensForEngine("ai-sdk:openai", "gpt-5.5")).toBe(
      128_000,
    );
    // Without a model the env override is still clamped to 64K.
    expect(defaultMaxOutputTokensForEngine("ai-sdk:openai")).toBe(64_000);
  });
});
