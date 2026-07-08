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

function mockAnthropicProvider() {
  const anthropicModel = { id: "anthropic-model" };
  const provider = vi.fn().mockReturnValue(anthropicModel);
  const createAnthropic = vi.fn().mockReturnValue(provider);
  vi.doMock("@ai-sdk/anthropic", () => ({ createAnthropic }));
  return { createAnthropic, provider, anthropicModel };
}

describe("AISDKEngine Anthropic thinking-budget headroom", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("clamps an explicit large thinking budget so it leaves headroom under maxOutputTokens", async () => {
    const { streamText } = mockAiSdk();
    mockAnthropicProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("anthropic", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "claude-opus-4-8",
        maxOutputTokens: 32_000,
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budgetTokens: 100_000 },
          },
        },
      }),
    );

    const call = streamText.mock.calls[0][0];
    const budgetTokens = call.providerOptions.anthropic.thinking
      .budgetTokens as number;
    expect(budgetTokens).toBeLessThan(32_000);
    expect(32_000 - budgetTokens).toBeGreaterThanOrEqual(8000);
  });
});

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
        // Generous maxOutputTokens (matches the interactive chat floor) so
        // the headroom clamp below is a no-op and the raw effort->budget
        // mapping is what's under test here.
        maxOutputTokens: 32_000,
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

  it("clamps Gemini thinkingBudget so it can't consume a small maxOutputTokens entirely", async () => {
    const { streamText } = mockAiSdk();
    mockGoogleProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("google", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "gemini-2.5-flash",
        reasoningEffort: "medium",
        // Unclamped, "medium" effort maps to a 4096-token thinkingBudget —
        // identical to this maxOutputTokens, which would leave zero tokens
        // for the actual response (the empty-response bug this fixes).
        maxOutputTokens: 4_096,
      }),
    );

    const call = streamText.mock.calls[0][0];
    const thinkingBudget = call.providerOptions.google.thinkingConfig
      .thinkingBudget as number;
    expect(thinkingBudget).toBeLessThan(4_096);
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

describe("AISDKEngine error tagging", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("tags a 429 APICallError with http_429 + statusCode + providerRetryable", async () => {
    class MockApiCallError extends Error {
      statusCode = 429;
      isRetryable = true;
      constructor() {
        super("Too Many Requests");
      }
    }
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        throw new MockApiCallError();
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    const events: any[] = [];
    await expect(async () => {
      for await (const e of engine.stream(BASE_STREAM_OPTIONS)) events.push(e);
    }).rejects.toThrow();

    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("error");
    expect(stopEvent?.errorCode).toBe("http_429");
    expect(stopEvent?.statusCode).toBe(429);
    expect(stopEvent?.providerRetryable).toBe(true);
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
