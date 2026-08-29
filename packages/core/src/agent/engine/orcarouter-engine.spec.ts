import { describe, it, expect, vi, beforeEach } from "vitest";

describe("OrcaRouter builtin engine", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("registers ai-sdk:orcarouter with expected metadata", async () => {
    const { registerBuiltinEngines } = await import("./builtin.js");
    const { getAgentEngineEntry } = await import("./registry.js");

    registerBuiltinEngines();

    const entry = getAgentEngineEntry("ai-sdk:orcarouter");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("OrcaRouter");
    expect(entry?.requiredEnvVars).toEqual(["ORCAROUTER_API_KEY"]);
    expect(entry?.defaultModel).toBe("orcarouter/auto");
    expect(entry?.supportedModels).toEqual(
      expect.arrayContaining([
        "orcarouter/auto",
        "orcarouter/fusion",
        "openai/gpt-5.6-luna",
        "z-ai/glm-5.2",
      ]),
    );
    expect(entry?.installPackage).toContain("@ai-sdk/openai");
  });

  it("stream wires apiKey + baseURL into createOpenAI and resolves the model via provider.chat()", async () => {
    const streamText = vi.fn().mockImplementation(() => ({
      fullStream: (async function* () {
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      })(),
    }));
    const jsonSchema = vi.fn((s: unknown) => s);
    vi.doMock("ai", () => ({ streamText, jsonSchema }));

    const chatModel = {
      __isModel: true,
      modelId: "orcarouter/auto",
    };
    // `@ai-sdk/openai`'s returned provider is callable AND has .chat(); the
    // orcarouter engine must take the `.chat()` path like any OpenAI-compatible
    // gateway rather than the first-party Responses path.
    const providerCallable = vi.fn().mockReturnValue(chatModel);
    const openai: any = Object.assign(providerCallable, {
      chat: vi.fn().mockReturnValue(chatModel),
    });
    const createOpenAI = vi.fn().mockReturnValue(openai);
    vi.doMock("@ai-sdk/openai", () => ({ createOpenAI }));

    const [{ createAISDKEngine }, { DEFAULT_ORCAROUTER_MAX_OUTPUT_TOKENS }] =
      await Promise.all([
        import("./ai-sdk-engine.js"),
        import("./output-tokens.js"),
      ]);
    const engine = createAISDKEngine("orcarouter", {
      apiKey: "sk-orca-test",
    });

    const events: any[] = [];
    for await (const e of engine.stream({
      model: "orcarouter/auto",
      systemPrompt: "",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    } as any)) {
      events.push(e);
    }

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-orca-test",
      baseURL: "https://api.orcarouter.ai/v1",
    });
    // Gateway path: `.chat()` is used, not the callable directly.
    expect(providerCallable).not.toHaveBeenCalled();
    expect(openai.chat).toHaveBeenCalledWith("orcarouter/auto");
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: chatModel,
        maxOutputTokens: DEFAULT_ORCAROUTER_MAX_OUTPUT_TOKENS,
      }),
    );

    const stop = events.find((e) => e.type === "stop");
    expect(stop).toBeDefined();
    expect(stop.reason).not.toBe("error");
  });

  it("falls back to ORCAROUTER_API_KEY env var when apiKey not in config", async () => {
    vi.stubEnv("ORCAROUTER_API_KEY", "env-orca-key");

    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { type: "finish", finishReason: "stop", usage: {} };
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));

    const chat = vi.fn().mockReturnValue({});
    const openai: any = Object.assign(vi.fn().mockReturnValue({}), { chat });
    const createOpenAI = vi.fn().mockReturnValue(openai);
    vi.doMock("@ai-sdk/openai", () => ({ createOpenAI }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("orcarouter", {});

    for await (const _ of engine.stream({
      model: "orcarouter/auto",
      systemPrompt: "",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    } as any)) {
      void _;
    }

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "env-orca-key",
        baseURL: "https://api.orcarouter.ai/v1",
      }),
    );
  });

  it("fails closed with missing_credentials when no key is present", async () => {
    const { streamText } = mockAiSdk();
    const createOpenAI = vi.fn();
    vi.doMock("@ai-sdk/openai", () => ({ createOpenAI }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("orcarouter", {
      allowEnvFallback: false,
    });

    const events: any[] = [];
    for await (const e of engine.stream(BASE_STREAM_OPTIONS as any)) {
      events.push(e);
    }

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(stop?.error).toContain("ORCAROUTER_API_KEY");
    // The whole point: no request was ever built or sent.
    expect(createOpenAI).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });
});

function mockAiSdk() {
  const streamText = vi.fn().mockReturnValue({
    fullStream: (async function* () {
      yield { type: "finish", finishReason: "stop", usage: {} };
    })(),
  });
  const jsonSchema = vi.fn((s: unknown) => s);
  vi.doMock("ai", () => ({ streamText, jsonSchema }));
  return { streamText };
}

const BASE_STREAM_OPTIONS = {
  model: "orcarouter/auto",
  systemPrompt: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
};
