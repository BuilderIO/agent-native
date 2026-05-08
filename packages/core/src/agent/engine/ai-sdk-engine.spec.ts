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
