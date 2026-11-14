import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderModelMetadataResult } from "../provider-model-metadata.js";

const mocks = vi.hoisted(() => ({
  readAnthropicModelMetadata:
    vi.fn<() => Promise<ProviderModelMetadataResult>>(),
}));

vi.mock("../provider-model-metadata.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider-model-metadata.js")>()),
  readAnthropicModelMetadata: mocks.readAnthropicModelMetadata,
}));

import { registerBuiltinEngines } from "../engine/builtin.js";
import { getAgentEngineEntry } from "../engine/registry.js";
import { describeModelForEngine, MODEL_CATALOG } from "../model-catalog.js";
import action from "./describe-models.js";

const CATALOG_ID = "claude-opus-5-5";
const UNKNOWN_ID = "acme-unlisted-model";

function anthropicSupportedModels(): string[] {
  registerBuiltinEngines();
  const entry = getAgentEngineEntry("anthropic");
  if (!entry) throw new Error("anthropic engine is not registered");
  return [...entry.supportedModels];
}

describe("describe-models", () => {
  beforeEach(() => {
    mocks.readAnthropicModelMetadata.mockReset();
  });

  it("is a read-only GET action", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.tool.description).toContain("billing.kind");
    expect(action.tool.description).toContain('metadata.state "unavailable"');
  });

  it("describes the whole catalog without engine facts when called with no arguments", async () => {
    const result = await action.run({});

    expect(Object.keys(result)).not.toContain("engine");
    expect(result.metadata).toEqual({ state: "not-applicable" });
    expect(result.models.map((model) => model.modelId)).toEqual(
      MODEL_CATALOG.map((entry) => entry.id),
    );
    expect(result.models[0]).toEqual(
      describeModelForEngine(MODEL_CATALOG[0].id),
    );
    expect(mocks.readAnthropicModelMetadata).not.toHaveBeenCalled();
  });

  it("describes the named models as the engine offers them", async () => {
    const result = await action.run({
      models: [CATALOG_ID, UNKNOWN_ID],
      engine: "builder",
    });

    expect(result.engine).toBe("builder");
    expect(result.metadata).toEqual({ state: "not-applicable" });
    expect(result.models).toEqual([
      describeModelForEngine(CATALOG_ID, "builder"),
      describeModelForEngine(UNKNOWN_ID, "builder"),
    ]);
    expect(result.models[0]).toMatchObject({
      known: true,
      billing: { kind: "builder-credits" },
      source: "catalog",
    });
    expect(result.models[1]).toMatchObject({
      modelId: UNKNOWN_ID,
      known: false,
    });
    expect(result.models[1]).not.toHaveProperty("ratings");
    expect(mocks.readAnthropicModelMetadata).not.toHaveBeenCalled();
  });

  it("reports subscription and provider-key billing per engine", async () => {
    const subscription = await action.run({
      models: [CATALOG_ID],
      engine: "chatgpt-subscription",
    });
    expect(subscription.models[0]?.billing).toEqual({
      kind: "subscription",
      plan: "ChatGPT",
    });

    const openai = await action.run({
      models: ["gpt-5-5"],
      engine: "ai-sdk:openai",
    });
    expect(openai.metadata).toEqual({ state: "not-applicable" });
    expect(openai.models[0]?.billing).toEqual({
      kind: "provider-key",
      provider: "OpenAI",
    });
  });

  it("describes the engine's own models, plus the extra ones the provider's live list names", async () => {
    mocks.readAnthropicModelMetadata.mockResolvedValue({
      state: "available",
      fetchedAt: 1_700_000_000_000,
      models: {
        [CATALOG_ID]: {
          id: CATALOG_ID,
          contextWindow: 123_456,
          efforts: ["low", "high"],
        },
        [UNKNOWN_ID]: { id: UNKNOWN_ID, contextWindow: 64_000 },
      },
    });
    const supported = anthropicSupportedModels();

    const result = await action.run({ engine: "anthropic" });

    expect(mocks.readAnthropicModelMetadata).toHaveBeenCalledTimes(1);
    expect(result.engine).toBe("anthropic");
    expect(result.metadata).toEqual({
      state: "available",
      fetchedAt: 1_700_000_000_000,
    });
    const ids = result.models.map((model) => model.modelId);
    expect(ids).toEqual([...new Set([...supported, CATALOG_ID, UNKNOWN_ID])]);
    const live = result.models.find((model) => model.modelId === CATALOG_ID);
    expect(live).toMatchObject({
      contextWindow: 123_456,
      efforts: ["low", "high"],
      source: "provider",
      billing: { kind: "provider-key", provider: "Anthropic" },
    });
    const extra = result.models.find((model) => model.modelId === UNKNOWN_ID);
    expect(extra).toMatchObject({
      known: false,
      contextWindow: 64_000,
      source: "provider",
    });
    const unlisted = result.models.find(
      (model) => model.modelId !== CATALOG_ID && model.modelId !== UNKNOWN_ID,
    );
    expect(unlisted?.source).toBe("catalog");
  });

  it("does not add live-only models when the caller named the models", async () => {
    mocks.readAnthropicModelMetadata.mockResolvedValue({
      state: "available",
      fetchedAt: 1,
      models: {
        [UNKNOWN_ID]: { id: UNKNOWN_ID, contextWindow: 64_000 },
      },
    });

    const result = await action.run({
      models: [CATALOG_ID],
      engine: "ai-sdk:anthropic",
    });

    expect(mocks.readAnthropicModelMetadata).toHaveBeenCalledTimes(1);
    expect(result.models.map((model) => model.modelId)).toEqual([CATALOG_ID]);
    expect(result.models[0]?.source).toBe("catalog");
  });

  it("falls back to the catalog and reports why when the live list is unavailable", async () => {
    mocks.readAnthropicModelMetadata.mockResolvedValue({
      state: "unavailable",
      reason: "rejected",
      status: 401,
    });

    const rejected = await action.run({
      models: [CATALOG_ID],
      engine: "anthropic",
    });

    expect(rejected.metadata).toEqual({
      state: "unavailable",
      reason: "rejected",
      status: 401,
    });
    expect(rejected.models).toEqual([
      describeModelForEngine(CATALOG_ID, "anthropic"),
    ]);
    expect(rejected.models[0]?.source).toBe("catalog");

    for (const reason of [
      "missing-key",
      "credential-unreadable",
      "unreachable",
      "provider-error",
    ] as const) {
      mocks.readAnthropicModelMetadata.mockResolvedValue({
        state: "unavailable",
        reason,
      });
      const result = await action.run({
        models: [CATALOG_ID],
        engine: "anthropic",
      });
      expect(result.metadata, reason).toEqual({ state: "unavailable", reason });
      expect(Object.keys(result.metadata), reason).not.toContain("status");
    }
  });

  it("registers the built-in engines itself before listing an engine's models", async () => {
    vi.resetModules();
    const { default: fresh } = await import("./describe-models.js");

    const result = await fresh.run({ engine: "builder" });

    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models[0]?.billing).toEqual({ kind: "builder-credits" });
  });

  it("fails with unknown_engine for an engine that is not registered", async () => {
    await expect(action.run({ engine: "acme-engine" })).rejects.toMatchObject({
      errorCode: "unknown_engine",
      statusCode: 404,
      message: 'Unknown engine "acme-engine".',
    });
    expect(mocks.readAnthropicModelMetadata).not.toHaveBeenCalled();
  });

  it("rejects empty model ids, more than 50 models, and an empty engine", async () => {
    await expect(action.run({ models: [""] })).rejects.toThrow();
    await expect(
      action.run({
        models: Array.from({ length: 51 }, (_, index) => `model-${index}`),
      }),
    ).rejects.toThrow();
    await expect(action.run({ engine: "" })).rejects.toThrow();
    await expect(
      action.run({
        models: Array.from({ length: 50 }, (_, index) => `model-${index}`),
      }),
    ).resolves.toMatchObject({ metadata: { state: "not-applicable" } });
  });
});
