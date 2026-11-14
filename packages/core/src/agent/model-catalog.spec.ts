import { describe, expect, it } from "vitest";

import {
  canonicalModelId,
  describeModelForEngine,
  findModelCatalogEntry,
  getEngineBilling,
  MODEL_CATALOG,
  PICKER_ROOT_MODEL_IDS,
} from "./model-catalog.js";
import { AGENT_MODEL_CONFIG, BUILDER_MODEL_CONFIG } from "./model-config.js";

describe("model catalog", () => {
  it("resolves every engine's spelling of a model to one entry", () => {
    const opus = findModelCatalogEntry("claude-opus-5-5");
    expect(opus?.name).toBe("Claude Opus 5.5");
    expect(findModelCatalogEntry("anthropic/claude-opus-5.5")).toBe(opus);
    expect(findModelCatalogEntry("claude-haiku-4-5-20251001")?.id).toBe(
      "claude-haiku-4-5",
    );
    expect(findModelCatalogEntry("google/gemini-3.1-pro-preview")?.id).toBe(
      "gemini-3-1-pro",
    );
    expect(findModelCatalogEntry("gpt-6.1-sol")).toBe(
      findModelCatalogEntry("gpt-6-1-sol"),
    );
    expect(findModelCatalogEntry("z-ai-glm-5-1")).toBe(
      findModelCatalogEntry("z-ai/glm-5.1"),
    );
    expect(canonicalModelId("openai/gpt-5.4-mini")).toBe("gpt-5-4-mini");
  });

  it("keeps one entry per model", () => {
    const keys = MODEL_CATALOG.flatMap((entry) => [
      entry.id,
      ...(entry.aliases ?? []),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of MODEL_CATALOG) {
      expect(canonicalModelId(entry.id)).toBe(entry.id);
    }
  });

  it("covers every built-in engine's current Claude, GPT, and Gemini ids", () => {
    const engineIds = [
      ...BUILDER_MODEL_CONFIG.supportedModels,
      ...AGENT_MODEL_CONFIG.anthropic.supportedModels,
      ...AGENT_MODEL_CONFIG.aiSdk.openai.supportedModels,
      ...AGENT_MODEL_CONFIG.aiSdk.openrouter.supportedModels,
      ...AGENT_MODEL_CONFIG.aiSdk.google.supportedModels,
    ].filter((id) => /claude-|gpt-|gemini-/.test(id));
    expect(engineIds.filter((id) => !findModelCatalogEntry(id))).toEqual([]);
  });

  it("keeps ratings on the 1-5 scale and ranks recommended models", () => {
    for (const entry of MODEL_CATALOG) {
      for (const value of Object.values(entry.ratings ?? {})) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
    const opus = describeModelForEngine("claude-opus-5-5", "builder");
    expect(opus).toMatchObject({
      shortName: "Opus 5.5",
      descriptor: "Flagship capability",
      provider: "anthropic",
      recommended: true,
    });
    expect(describeModelForEngine("auto").recommendedRank).toBe(0);
    expect(
      describeModelForEngine("claude-sonnet-5-5").recommendedRank,
    ).toBeGreaterThan(opus.recommendedRank!);
    expect(describeModelForEngine("claude-opus-4-8").recommended).toBe(false);
  });

  it("ranks the picker's root list: Opus 5.5, Sonnet 5.5, GPT-6.1 Sol, GPT-6 Luna", () => {
    expect(
      PICKER_ROOT_MODEL_IDS.map(
        (id) => describeModelForEngine(id, "builder").shortName,
      ),
    ).toEqual(["Opus 5.5", "Sonnet 5.5", "GPT-6.1 Sol", "GPT-6 Luna"]);
    expect(
      PICKER_ROOT_MODEL_IDS.map(
        (id) => describeModelForEngine(id, "builder").rootRank,
      ),
    ).toEqual([0, 1, 2, 3]);
    for (const id of PICKER_ROOT_MODEL_IDS) {
      expect(findModelCatalogEntry(id)?.id).toBe(id);
    }
    expect(describeModelForEngine("gemini-3-1-pro").rootRank).toBeUndefined();
    expect(describeModelForEngine("auto").rootRank).toBeUndefined();
  });

  it("describes an unknown model by engine facts only", () => {
    const custom = describeModelForEngine("my-fine-tune-v2", "ai-sdk:openai");
    expect(custom).toEqual({
      modelId: "my-fine-tune-v2",
      engine: "ai-sdk:openai",
      known: false,
      recommended: false,
      efforts: [],
      billing: { kind: "provider-key", provider: "OpenAI" },
      source: "catalog",
    });

    const datedClaude = describeModelForEngine(
      "claude-sonnet-9-1-20270101",
      "anthropic",
    );
    expect(datedClaude.known).toBe(false);
    expect(datedClaude.name).toBeUndefined();
    expect(datedClaude.ratings).toBeUndefined();
    expect(datedClaude.contextWindow).toBe(200_000);
  });

  it("intersects the model's effort levels with the engine's", () => {
    expect(
      describeModelForEngine("claude-opus-5-5", "builder").efforts,
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(
      describeModelForEngine("gpt-6-luna", "ai-sdk:openai").efforts,
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(describeModelForEngine("gpt-6-luna", "ai-sdk:groq").efforts).toEqual(
      [],
    );
    expect(describeModelForEngine("llama3.1", "ai-sdk:ollama").efforts).toEqual(
      [],
    );
  });

  it("resolves Builder's auto to the gateway default model", () => {
    const auto = describeModelForEngine("auto", "builder");
    expect(auto.recommended).toBe(true);
    expect(auto.efforts).toEqual(
      describeModelForEngine(BUILDER_MODEL_CONFIG.defaultModel, "builder")
        .efforts,
    );
    expect(auto.contextWindow).toBe(
      describeModelForEngine(BUILDER_MODEL_CONFIG.defaultModel).contextWindow,
    );
  });

  it("states billing from the engine, not the model", () => {
    expect(getEngineBilling("builder")).toEqual({ kind: "builder-credits" });
    expect(getEngineBilling("anthropic")).toEqual({
      kind: "provider-key",
      provider: "Anthropic",
    });
    expect(getEngineBilling("ai-sdk:openrouter")).toEqual({
      kind: "provider-key",
      provider: "OpenRouter",
    });
    expect(getEngineBilling("chatgpt-subscription")).toEqual({
      kind: "subscription",
      plan: "ChatGPT",
    });
    expect(getEngineBilling("ai-sdk:ollama")).toBeUndefined();
    expect(getEngineBilling("codex-cli")).toBeUndefined();
    expect(
      describeModelForEngine("claude-opus-5-5", "builder").ratings,
    ).toEqual(describeModelForEngine("claude-opus-5-5", "anthropic").ratings);
  });

  it("names the provider's documented default effort where one exists", () => {
    expect(
      describeModelForEngine("claude-opus-5-5", "anthropic")
        .providerDefaultEffort,
    ).toBe("medium");
    expect(
      describeModelForEngine("claude-haiku-5-5", "builder")
        .providerDefaultEffort,
    ).toBe("medium");
    expect(
      describeModelForEngine("anthropic/claude-sonnet-5.5", "ai-sdk:openrouter")
        .providerDefaultEffort,
    ).toBe("high");
    expect(
      describeModelForEngine("gemini-3-1-pro", "builder").providerDefaultEffort,
    ).toBeUndefined();
    expect(
      describeModelForEngine("gpt-6-luna", "builder").providerDefaultEffort,
    ).toBeUndefined();
  });
});
