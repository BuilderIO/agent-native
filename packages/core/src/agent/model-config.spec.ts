import { describe, expect, it } from "vitest";

import {
  AGENT_MODEL_CONFIG,
  AI_SDK_MODEL_CONFIG,
  ANTHROPIC_MODEL_CONFIG,
  BUILDER_MODEL_CONFIG,
  CLAUDE_SONNET_MODEL_ID,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MODEL,
  DEFAULT_OPENAI_MODEL,
  getContextWindowForModel,
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

  it("includes claude-fable-5 in direct Anthropic catalogs", () => {
    expect(ANTHROPIC_MODEL_CONFIG.supportedModels).toContain("claude-fable-5");
    expect(AI_SDK_MODEL_CONFIG.anthropic.supportedModels).toContain(
      "claude-fable-5",
    );
    expect(BUILDER_MODEL_CONFIG.supportedModels).not.toContain(
      "claude-fable-5",
    );
  });

  it("includes claude-opus-4-8 in current Anthropic catalogs", () => {
    expect(ANTHROPIC_MODEL_CONFIG.supportedModels).toContain("claude-opus-4-8");
    expect(AI_SDK_MODEL_CONFIG.anthropic.supportedModels).toContain(
      "claude-opus-4-8",
    );
    expect(BUILDER_MODEL_CONFIG.supportedModels).toContain("claude-opus-4-8");
  });

  it("keeps the Builder catalog aligned to the gateway allow-list", () => {
    const hiddenSonnetModel =
      CLAUDE_SONNET_MODEL_ID === "claude-sonnet-5"
        ? "claude-sonnet-4-6"
        : "claude-sonnet-5";

    expect(BUILDER_MODEL_CONFIG.supportedModels).toContain("auto");
    expect(BUILDER_MODEL_CONFIG.supportedModels).toContain(
      CLAUDE_SONNET_MODEL_ID,
    );
    expect(BUILDER_MODEL_CONFIG.supportedModels).not.toContain(
      hiddenSonnetModel,
    );
    expect(BUILDER_MODEL_CONFIG.supportedModels).toContain("claude-opus-4-8");
    expect(BUILDER_MODEL_CONFIG.supportedModels).not.toContain(
      "claude-opus-4-7",
    );
    expect(BUILDER_MODEL_CONFIG.supportedModels).not.toContain("z-ai-glm-4-5");
    expect(ANTHROPIC_MODEL_CONFIG.supportedModels).not.toContain(
      "claude-opus-4-7",
    );
    expect(AI_SDK_MODEL_CONFIG.anthropic.supportedModels).not.toContain(
      "claude-opus-4-7",
    );
  });

  it("does not contain decommissioned Groq models", () => {
    const groqModels = AI_SDK_MODEL_CONFIG.groq
      .supportedModels as readonly string[];
    // Both were decommissioned (errors since Jan/Mar 2025)
    expect(groqModels).not.toContain("llama-3.1-70b-versatile");
    expect(groqModels).not.toContain("mixtral-8x7b-32768");
    // Current production model must be present
    expect(groqModels).toContain("llama-3.3-70b-versatile");
  });

  it("uses the current cohere model ID as default", () => {
    expect(AI_SDK_MODEL_CONFIG.cohere.defaultModel).toBe(
      "command-r-plus-08-2024",
    );
    expect(AI_SDK_MODEL_CONFIG.cohere.supportedModels).toContain(
      "command-r-plus-08-2024",
    );
  });

  it("includes current OpenRouter curated entries", () => {
    const openrouterModels = AI_SDK_MODEL_CONFIG.openrouter
      .supportedModels as readonly string[];
    expect(openrouterModels).toContain(
      CLAUDE_SONNET_MODEL_ID === "claude-sonnet-5"
        ? "anthropic/claude-sonnet-5"
        : "anthropic/claude-sonnet-4.6",
    );
    expect(openrouterModels).toContain("google/gemini-2.5-flash");
    expect(openrouterModels).toContain("z-ai/glm-5.2");
  });
});

// ─── getContextWindowForModel ─────────────────────────────────────────────────

describe("getContextWindowForModel", () => {
  it("returns 200K for standard Claude Haiku models", () => {
    expect(getContextWindowForModel("claude-haiku-4-5")).toBe(200_000);
    expect(getContextWindowForModel("claude-haiku-4-5-20251001")).toBe(200_000);
  });

  it("returns 1M for Claude Fable 5, Sonnet 5/4.6, and Opus 4.x", () => {
    expect(getContextWindowForModel("claude-fable-5")).toBe(1_000_000);
    expect(getContextWindowForModel("claude-sonnet-5")).toBe(1_000_000);
    expect(getContextWindowForModel("anthropic/claude-sonnet-5")).toBe(
      1_000_000,
    );
    expect(getContextWindowForModel("claude-sonnet-4-6")).toBe(1_000_000);
    expect(getContextWindowForModel("claude-opus-4-7")).toBe(1_000_000);
    expect(getContextWindowForModel("claude-opus-4-8")).toBe(1_000_000);
  });

  it("returns 1.05M for GPT-5.x models", () => {
    expect(getContextWindowForModel("gpt-5.5")).toBe(1_050_000);
    expect(getContextWindowForModel("gpt-5.4")).toBe(1_050_000);
    expect(getContextWindowForModel("gpt-5.4-mini")).toBe(400_000);
    // Builder gateway dashed form
    expect(getContextWindowForModel("gpt-5-5")).toBe(1_050_000);
    expect(getContextWindowForModel("gpt-5-4")).toBe(1_050_000);
    expect(getContextWindowForModel("gpt-5-4-mini")).toBe(400_000);
  });

  it("returns 1M for Gemini 2.x / 3.x models", () => {
    expect(getContextWindowForModel("gemini-3.5-flash")).toBe(1_048_576);
    expect(getContextWindowForModel("gemini-3.1-pro-preview")).toBe(1_048_576);
    expect(getContextWindowForModel("gemini-3-5-flash")).toBe(1_048_576);
    expect(getContextWindowForModel("google/gemini-2.5-flash")).toBe(1_048_576);
  });

  it("returns 1M for GLM 5.x models", () => {
    expect(getContextWindowForModel("z-ai/glm-5.2")).toBe(1_048_576);
    expect(getContextWindowForModel("glm-5.3")).toBe(1_048_576);
  });

  it("returns 128K safe default for unknown models", () => {
    expect(getContextWindowForModel("unknown-model-xyz")).toBe(128_000);
    expect(getContextWindowForModel("")).toBe(128_000);
  });

  it("uses heuristic fallback for unlisted claude-opus-4 variants", () => {
    // Future models not yet in the explicit table
    expect(getContextWindowForModel("claude-opus-4-9")).toBe(1_000_000);
  });

  it("uses heuristic fallback for unlisted gpt-5 variants", () => {
    expect(getContextWindowForModel("gpt-5.6")).toBe(1_050_000);
    expect(getContextWindowForModel("openai/gpt-5.6")).toBe(1_050_000);
  });
});
