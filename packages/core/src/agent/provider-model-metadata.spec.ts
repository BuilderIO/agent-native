import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSecretDetailedMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: (...args: unknown[]) =>
    resolveSecretDetailedMock(...args),
}));

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

const metadata = await import("./provider-model-metadata.js");
const { describeModelForEngine } = await import("./model-catalog.js");

const opusEntry = {
  id: "claude-opus-5-5",
  max_input_tokens: 1_000_000,
  max_tokens: 128_000,
  capabilities: {
    effort: {
      low: { supported: true },
      medium: { supported: true },
      high: { supported: true },
      xhigh: { supported: false },
      max: { supported: true },
    },
    thinking: {
      types: { adaptive: { supported: true }, enabled: { supported: false } },
    },
  },
};

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  metadata.__resetProviderModelMetadataCache();
  fetchSpy.mockReset();
  resolveSecretDetailedMock.mockReset();
  resolveSecretDetailedMock.mockResolvedValue({
    value: "sk-ant-test",
    lookupFailed: false,
    source: "user",
    scopeId: "owner@example.com",
  });
});

describe("provider model metadata", () => {
  it("fetches nothing at module load", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolveSecretDetailedMock).not.toHaveBeenCalled();
  });

  it("parses Anthropic capabilities with bracket access", () => {
    expect(metadata.parseAnthropicModelEntry(opusEntry)).toEqual({
      id: "claude-opus-5-5",
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      efforts: ["low", "medium", "high", "max"],
      thinkingTypes: ["adaptive"],
    });
    expect(
      metadata.parseAnthropicModelEntry({ id: "claude-x" })?.efforts,
    ).toBeUndefined();
  });

  it("caches the list per credential for an hour", async () => {
    fetchSpy.mockImplementation(async () =>
      okResponse({ data: [opusEntry], has_more: false }),
    );
    let now = 1_000;
    const first = await metadata.readAnthropicModelMetadata({
      now: () => now,
    });
    expect(first.state).toBe("available");
    await metadata.readAnthropicModelMetadata({ now: () => now });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![1].headers["x-api-key"]).toBe("sk-ant-test");

    resolveSecretDetailedMock.mockResolvedValue({
      value: "sk-ant-other",
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    });
    await metadata.readAnthropicModelMetadata({ now: () => now });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    now += 60 * 60 * 1000 + 1;
    await metadata.readAnthropicModelMetadata({ now: () => now });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("reports a typed unavailable state instead of defaults", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(metadata.readAnthropicModelMetadata()).resolves.toEqual({
      state: "unavailable",
      reason: "rejected",
      status: 401,
    });

    metadata.__resetProviderModelMetadataCache();
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    await expect(metadata.readAnthropicModelMetadata()).resolves.toEqual({
      state: "unavailable",
      reason: "unreachable",
    });

    resolveSecretDetailedMock.mockResolvedValue({
      value: null,
      lookupFailed: true,
    });
    await expect(metadata.readAnthropicModelMetadata()).resolves.toEqual({
      state: "unavailable",
      reason: "credential-unreadable",
    });
  });

  it("lets live capabilities override the catalog", () => {
    const live = metadata.parseAnthropicModelEntry({
      ...opusEntry,
      max_input_tokens: 500_000,
    })!;
    const described = describeModelForEngine(
      "claude-opus-5-5",
      "anthropic",
      live,
    );
    expect(described).toMatchObject({
      source: "provider",
      contextWindow: 500_000,
      efforts: ["low", "medium", "high", "max"],
      providerDefaultEffort: "medium",
    });
    expect(
      describeModelForEngine("claude-opus-5-5", "anthropic"),
    ).toMatchObject({ source: "catalog", contextWindow: 1_000_000 });
  });

  it("falls back to the catalog through describe-models with the failure named", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 503 }));
    const { default: describeModels } =
      await import("./actions/describe-models.js");
    const result = await describeModels.run({
      engine: "anthropic",
      models: ["claude-opus-5-5"],
    });
    expect(result.metadata).toEqual({
      state: "unavailable",
      reason: "provider-error",
      status: 503,
    });
    expect(result.models[0]).toMatchObject({
      source: "catalog",
      providerDefaultEffort: "medium",
    });
  });

  it("uses the live list through describe-models when it is readable", async () => {
    fetchSpy.mockImplementation(async () =>
      okResponse({ data: [opusEntry], has_more: false }),
    );
    const { default: describeModels } =
      await import("./actions/describe-models.js");
    const result = await describeModels.run({
      engine: "anthropic",
      models: ["claude-opus-5-5"],
    });
    expect(result.metadata.state).toBe("available");
    expect(result.models[0]).toMatchObject({
      source: "provider",
      efforts: ["low", "medium", "high", "max"],
    });
  });

  it("reads no provider list for engines without one", async () => {
    const { default: describeModels } =
      await import("./actions/describe-models.js");
    const result = await describeModels.run({
      engine: "builder",
      models: ["claude-opus-5-5"],
    });
    expect(result.metadata).toEqual({ state: "not-applicable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
