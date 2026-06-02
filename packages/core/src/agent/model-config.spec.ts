import { describe, expect, it } from "vitest";
import {
  AGENT_MODEL_CONFIG,
  AI_SDK_MODEL_CONFIG,
  ANTHROPIC_MODEL_CONFIG,
  BUILDER_MODEL_CONFIG,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MODEL,
  DEFAULT_OPENAI_MODEL,
} from "./model-config.js";

describe("agent model config catalog", () => {
  it("derives the builder gateway OpenAI id by dot->dash from the OpenAI default", () => {
    // The framework default bump lives in one place (the OpenAI id); the
    // builder gateway id is mechanically derived by replacing dots with dashes.
    const dashed = DEFAULT_OPENAI_MODEL.replace(/\./g, "-");
    expect(BUILDER_MODEL_CONFIG.supportedModels).toContain(dashed);
    // Sanity: the derivation actually changes a dotted id.
    expect(dashed).not.toContain(".");
    if (DEFAULT_OPENAI_MODEL.includes(".")) {
      expect(dashed).not.toBe(DEFAULT_OPENAI_MODEL);
    }
  });

  it("derives the OpenRouter default as openai/<openai-default>", () => {
    expect(AI_SDK_MODEL_CONFIG.openrouter.defaultModel).toBe(
      `openai/${DEFAULT_OPENAI_MODEL}`,
    );
    expect(AI_SDK_MODEL_CONFIG.openrouter.supportedModels).toContain(
      `openai/${DEFAULT_OPENAI_MODEL}`,
    );
  });

  it("keeps the builder default in sync with the anthropic default", () => {
    expect(DEFAULT_MODEL).toBe(BUILDER_MODEL_CONFIG.defaultModel);
    expect(DEFAULT_MODEL).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(ANTHROPIC_MODEL_CONFIG.defaultModel).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it("re-exported constants point at the same catalog objects", () => {
    expect(BUILDER_MODEL_CONFIG).toBe(AGENT_MODEL_CONFIG.builder);
    expect(ANTHROPIC_MODEL_CONFIG).toBe(AGENT_MODEL_CONFIG.anthropic);
    expect(AI_SDK_MODEL_CONFIG).toBe(AGENT_MODEL_CONFIG.aiSdk);
  });

  it("includes every default model in its own supported list", () => {
    // Top-level engines.
    expect(BUILDER_MODEL_CONFIG.supportedModels).toContain(
      BUILDER_MODEL_CONFIG.defaultModel,
    );
    expect(ANTHROPIC_MODEL_CONFIG.supportedModels).toContain(
      ANTHROPIC_MODEL_CONFIG.defaultModel,
    );

    // Every ai-sdk provider's default must be selectable.
    for (const [provider, cfg] of Object.entries(AI_SDK_MODEL_CONFIG)) {
      expect(
        cfg.supportedModels,
        `${provider} default not in supportedModels`,
      ).toContain(cfg.defaultModel);
    }
  });

  it("exposes the expected ai-sdk providers each with a non-empty model list", () => {
    expect(Object.keys(AI_SDK_MODEL_CONFIG).sort()).toEqual(
      [
        "anthropic",
        "cohere",
        "google",
        "groq",
        "mistral",
        "ollama",
        "openai",
        "openrouter",
      ].sort(),
    );
    for (const cfg of Object.values(AI_SDK_MODEL_CONFIG)) {
      expect(cfg.supportedModels.length).toBeGreaterThan(0);
      expect(typeof cfg.defaultModel).toBe("string");
      expect(cfg.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
