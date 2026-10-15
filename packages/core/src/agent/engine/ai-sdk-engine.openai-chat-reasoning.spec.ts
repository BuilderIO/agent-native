import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function drain(iterable: AsyncIterable<unknown>) {
  for await (const _ of iterable) {
    // consume stream
  }
}

const CUSTOM_BASE_URL = "https://gateway.example.test/v1";

const BASE_STREAM_OPTIONS = {
  systemPrompt: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
} as const;

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
  return { provider, responsesModel, chatModel };
}

describe("AISDKEngine OpenAI reasoning options on Chat Completions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it.each([
    { model: "gpt-6-luna", forceReasoning: true },
    { model: "gpt-5-chat-latest", forceReasoning: undefined },
    { model: "openai/gpt-5-chat-latest", forceReasoning: undefined },
    { model: "gpt-4.1", forceReasoning: undefined },
  ])(
    "on a custom base URL, forceReasoning is $forceReasoning for $model",
    async ({ model, forceReasoning }) => {
      const { streamText } = mockAiSdk();
      const { provider, chatModel } = mockOpenAIProvider();

      const { createAISDKEngine } = await import("./ai-sdk-engine.js");
      const engine = createAISDKEngine("openai", {
        apiKey: "sk-test",
        baseUrl: CUSTOM_BASE_URL,
      });

      await drain(engine.stream({ ...BASE_STREAM_OPTIONS, model }));

      expect(provider.chat).toHaveBeenCalledWith(model);
      expect(provider).not.toHaveBeenCalled();
      const call = streamText.mock.calls[0][0];
      expect(call.model).toBe(chatModel);
      expect(call.providerOptions?.openai?.forceReasoning).toBe(forceReasoning);
    },
  );

  it("keeps the default OpenAI base URL on Responses without forceReasoning", async () => {
    const { streamText } = mockAiSdk();
    const { provider, responsesModel } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    await drain(engine.stream({ ...BASE_STREAM_OPTIONS, model: "gpt-6-luna" }));

    expect(provider).toHaveBeenCalledWith("gpt-6-luna");
    expect(provider.chat).not.toHaveBeenCalled();
    const call = streamText.mock.calls[0][0];
    expect(call.model).toBe(responsesModel);
    expect(call.providerOptions?.openai?.forceReasoning).toBeUndefined();
  });

  it("keeps forceResponses on a custom base URL on Responses without forceReasoning", async () => {
    const { streamText } = mockAiSdk();
    const { provider, responsesModel } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: CUSTOM_BASE_URL,
      forceResponses: true,
    });

    await drain(engine.stream({ ...BASE_STREAM_OPTIONS, model: "gpt-6-luna" }));

    expect(provider).toHaveBeenCalledWith("gpt-6-luna");
    expect(provider.chat).not.toHaveBeenCalled();
    const call = streamText.mock.calls[0][0];
    expect(call.model).toBe(responsesModel);
    expect(call.providerOptions?.openai?.forceReasoning).toBeUndefined();
  });
});

describe("AISDKEngine OpenAI Chat Completions wire body", () => {
  beforeEach(() => {
    vi.doUnmock("ai");
    vi.doUnmock("@ai-sdk/openai");
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.doUnmock("ai");
    vi.doUnmock("@ai-sdk/openai");
  });

  async function captureChatCompletionsBody(model: string) {
    const bodies: Record<string, any>[] = [];
    const requestFetch: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          error: { message: "stop", type: "invalid_request" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    };

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: CUSTOM_BASE_URL,
      requestFetch,
    });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model,
        maxOutputTokens: 512,
      }),
    );

    expect(bodies).toHaveLength(1);
    return bodies[0];
  }

  it("sends max_completion_tokens and no max_tokens for gpt-6 on Chat Completions", async () => {
    const body = await captureChatCompletionsBody("gpt-6-luna");

    expect(body.max_completion_tokens).toBe(512);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("keeps max_tokens for gpt-4.1 on Chat Completions", async () => {
    const body = await captureChatCompletionsBody("gpt-4.1");

    expect(body.max_tokens).toBe(512);
    expect(body).not.toHaveProperty("max_completion_tokens");
  });
});
