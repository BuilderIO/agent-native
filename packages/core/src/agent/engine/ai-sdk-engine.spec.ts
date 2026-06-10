import { beforeEach, describe, expect, it, vi } from "vitest";

async function drain(iterable: AsyncIterable<unknown>) {
  for await (const _ of iterable) {
    // consume stream
  }
}

function mockAiSdk() {
  const streamText = vi.fn().mockReturnValue({
    fullStream: (async function* () {
      yield { type: "finish", finishReason: "stop", usage: {} };
    })(),
  });
  vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
  return { streamText };
}

function mockOpenAIProvider() {
  const responsesModel = { id: "responses-model" };
  const chatModel = { id: "chat-model" };
  const provider = Object.assign(vi.fn().mockReturnValue(responsesModel), {
    chat: vi.fn().mockReturnValue(chatModel),
  });
  const createOpenAI = vi.fn().mockReturnValue(provider);
  vi.doMock("@ai-sdk/openai", () => ({ createOpenAI }));
  return { createOpenAI, provider, responsesModel, chatModel };
}

const BASE_STREAM_OPTIONS = {
  model: "gpt-5.5",
  systemPrompt: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
} as const;

function mockGoogleProvider() {
  const googleModel = { id: "google-model" };
  const provider = vi.fn().mockReturnValue(googleModel);
  const createGoogleGenerativeAI = vi.fn().mockReturnValue(provider);
  vi.doMock("@ai-sdk/google", () => ({ createGoogleGenerativeAI }));
  return { createGoogleGenerativeAI, provider, googleModel };
}

describe("AISDKEngine Google Gemini thinking config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses thinkingBudget for Gemini 2.5 models", async () => {
    const { streamText } = mockAiSdk();
    mockGoogleProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("google", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "gemini-2.5-flash",
        reasoningEffort: "medium",
      }),
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          google: expect.objectContaining({
            thinkingConfig: { thinkingBudget: 4096 },
          }),
        }),
      }),
    );
  });

  it("uses thinkingLevel for Gemini 3.x models (low effort → 'low')", async () => {
    const { streamText } = mockAiSdk();
    mockGoogleProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("google", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "gemini-3.1-pro-preview",
        reasoningEffort: "low",
      }),
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          google: expect.objectContaining({
            thinkingConfig: { thinkingLevel: "low" },
          }),
        }),
      }),
    );
  });

  it("uses thinkingLevel 'high' for Gemini 3.x medium effort", async () => {
    const { streamText } = mockAiSdk();
    mockGoogleProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("google", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "gemini-3.5-flash",
        reasoningEffort: "medium",
      }),
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          google: expect.objectContaining({
            thinkingConfig: { thinkingLevel: "high" },
          }),
        }),
      }),
    );
  });

  it("does not emit thinkingConfig when no reasoningEffort is set for Google", async () => {
    const { streamText } = mockAiSdk();
    mockGoogleProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("google", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "gemini-3.5-flash",
      }),
    );

    // No providerOptions should be emitted when there's no reasoning effort
    const call = streamText.mock.calls[0][0];
    expect(call.providerOptions?.google?.thinkingConfig).toBeUndefined();
  });
});

describe("AISDKEngine OpenAI model selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses the default OpenAI provider path for first-party OpenAI models", async () => {
    const { streamText } = mockAiSdk();
    const { createOpenAI, provider, responsesModel } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    await drain(engine.stream(BASE_STREAM_OPTIONS));

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(provider).toHaveBeenCalledWith("gpt-5.5");
    expect(provider.chat).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: responsesModel }),
    );
  });

  it("passes an empty apiKey when env fallback is disabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-deploy");
    mockAiSdk();
    const { createOpenAI } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { allowEnvFallback: false });

    await drain(engine.stream(BASE_STREAM_OPTIONS));

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "" });
  });

  it("keeps Chat Completions for custom OpenAI-compatible base URLs", async () => {
    const { streamText } = mockAiSdk();
    const { createOpenAI, provider, chatModel } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: "https://gateway.example/v1",
    });

    await drain(engine.stream(BASE_STREAM_OPTIONS));

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://gateway.example/v1",
    });
    expect(provider).not.toHaveBeenCalled();
    expect(provider.chat).toHaveBeenCalledWith("gpt-5.5");
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: chatModel }),
    );
  });
});
