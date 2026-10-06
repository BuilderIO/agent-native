import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function makeTool(name: string) {
  return {
    name,
    description: name,
    inputSchema: { type: "object" as const, properties: {} },
  };
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

  it("defaults to adaptive thinking at high effort for an effort-capable Claude model", async () => {
    const { streamText } = mockAiSdk();
    mockAnthropicProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("anthropic", { apiKey: "key" });

    await drain(
      engine.stream({ ...BASE_STREAM_OPTIONS, model: "claude-sonnet-5" }),
    );

    const call = streamText.mock.calls[0][0];
    expect(call.providerOptions.anthropic.thinking).toEqual({
      type: "adaptive",
    });
    expect(call.providerOptions.anthropic.outputConfig).toEqual({
      effort: "high",
    });
  });

  it("uses manual thinking for Claude Haiku 4.5 instead of adaptive thinking", async () => {
    const { streamText } = mockAiSdk();
    mockAnthropicProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("anthropic", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "claude-haiku-4-5-20251001",
        maxOutputTokens: 32_000,
      }),
    );

    const call = streamText.mock.calls[0][0];
    expect(call.providerOptions.anthropic.thinking).toEqual({
      type: "enabled",
      budgetTokens: 8_000,
    });
    expect(call.providerOptions.anthropic.outputConfig).toBeUndefined();
  });

  it("does not add an implicit effort beside explicit Anthropic thinking", async () => {
    const { streamText } = mockAiSdk();
    mockAnthropicProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("anthropic", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "claude-sonnet-5",
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budgetTokens: 4_000 },
          },
        },
      }),
    );

    const call = streamText.mock.calls[0][0];
    expect(call.providerOptions.anthropic.thinking).toMatchObject({
      type: "enabled",
    });
    expect(call.providerOptions.anthropic.outputConfig).toBeUndefined();
  });

  it("does not default thinking for a non-reasoning-capable Claude model", async () => {
    const { streamText } = mockAiSdk();
    mockAnthropicProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("anthropic", { apiKey: "key" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        model: "claude-3-5-haiku-20241022",
      }),
    );

    const call = streamText.mock.calls[0][0];
    expect(call.providerOptions?.anthropic).toBeUndefined();
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

  it("uses thinkingLevel 'medium' for Gemini 3.x medium effort", async () => {
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
            thinkingConfig: { thinkingLevel: "medium" },
          }),
        }),
      }),
    );
  });

  it("defaults to high effort when no reasoningEffort is set for Google", async () => {
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

    const call = streamText.mock.calls[0][0];
    expect(call.providerOptions?.google?.thinkingConfig).toEqual({
      thinkingLevel: "high",
    });
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

  it("records streamed 401s before the success cleanup can clear them", async () => {
    const recordProviderCredentialAuthFailure = vi.fn(async () => {});
    const clearProviderCredentialAuthFailure = vi.fn(async () => {});
    vi.doMock("../../server/credential-provider.js", () => ({
      clearProviderCredentialAuthFailure,
      readDeployCredentialEnv: vi.fn(),
      recordProviderCredentialAuthFailure,
    }));
    class MockApiCallError extends Error {
      statusCode = 401;
      isRetryable = false;
      constructor() {
        super("Unauthorized");
      }
    }
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { type: "error", error: new MockApiCallError() };
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });
    await drain(engine.stream(BASE_STREAM_OPTIONS));

    expect(recordProviderCredentialAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "OPENAI_API_KEY",
        status: 401,
        code: "http_401",
      }),
    );
    expect(clearProviderCredentialAuthFailure).not.toHaveBeenCalled();
  });

  it("keeps the auth-failure marker when the turn ends in an unrelated error", async () => {
    const clearProviderCredentialAuthFailure = vi.fn(async () => {});
    vi.doMock("../../server/credential-provider.js", () => ({
      clearProviderCredentialAuthFailure,
      readDeployCredentialEnv: vi.fn(),
      recordProviderCredentialAuthFailure: vi.fn(async () => {}),
    }));
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: "error",
          error: Object.assign(new Error("Internal server error"), {
            statusCode: 500,
            isRetryable: true,
          }),
        };
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });
    const events: any[] = [];
    for await (const e of engine.stream(BASE_STREAM_OPTIONS)) events.push(e);

    expect(events.find((e) => e.type === "stop")?.reason).toBe("error");
    expect(clearProviderCredentialAuthFailure).not.toHaveBeenCalled();
  });

  it("still clears the marker when the turn completes normally", async () => {
    const clearProviderCredentialAuthFailure = vi.fn(async () => {});
    vi.doMock("../../server/credential-provider.js", () => ({
      clearProviderCredentialAuthFailure,
      readDeployCredentialEnv: vi.fn(),
      recordProviderCredentialAuthFailure: vi.fn(async () => {}),
    }));
    mockAiSdk();
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });
    await drain(engine.stream(BASE_STREAM_OPTIONS));

    expect(clearProviderCredentialAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ key: "OPENAI_API_KEY" }),
    );
  });

  it("tags a retry-wrapped Cannot connect to API failure as a provider network error", async () => {
    const lastError = Object.assign(
      new Error(
        "Cannot connect to API: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR tlsv1 alert internal error",
      ),
      { isRetryable: true },
    );
    const retryError = Object.assign(
      new Error(`Failed after 2 attempts. Last error: ${lastError.message}`),
      { lastError },
    );
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        throw retryError;
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    const events: any[] = [];
    await expect(async () => {
      for await (const event of engine.stream(BASE_STREAM_OPTIONS)) {
        events.push(event);
      }
    }).rejects.toThrow(retryError.message);

    const stopEvent = events.find((event) => event.type === "stop");
    expect(stopEvent?.error).toBe(retryError.message);
    expect(stopEvent?.errorCode).toBe("provider_network_error");
    expect(stopEvent?.providerRetryable).toBe(true);
  });

  it("preserves status fields from a retry wrapper's last provider error", async () => {
    const lastError = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      isRetryable: true,
    });
    const retryError = Object.assign(
      new Error("Failed after 2 attempts. Last error: Too Many Requests"),
      { lastError },
    );
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        throw retryError;
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    const events: any[] = [];
    await expect(async () => {
      for await (const event of engine.stream(BASE_STREAM_OPTIONS)) {
        events.push(event);
      }
    }).rejects.toThrow(retryError.message);

    const stopEvent = events.find((event) => event.type === "stop");
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

  it("keeps an explicit first-party endpoint on the Responses API path", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://deploy-gateway.example/v1");
    const { streamText } = mockAiSdk();
    const { createOpenAI, provider, responsesModel } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });

    await drain(engine.stream(BASE_STREAM_OPTIONS));

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      fetch: expect.any(Function),
    });
    expect(provider).toHaveBeenCalledWith("gpt-5.5");
    expect(provider.chat).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: responsesModel }),
    );
  });

  it("never reaches the deploy key when env fallback is disabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-deploy");
    const { streamText } = mockAiSdk();
    const { createOpenAI } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { allowEnvFallback: false });

    const events: any[] = [];
    for await (const e of engine.stream(BASE_STREAM_OPTIONS)) events.push(e);

    expect(createOpenAI).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "stop")?.errorCode).toBe(
      "missing_credentials",
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
      fetch: expect.any(Function),
    });
    expect(provider).not.toHaveBeenCalled();
    expect(provider.chat).toHaveBeenCalledWith("gpt-5.5");
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: chatModel }),
    );
    expect(engine.preserveCustomModels).toBe(true);
  });

  it("guards custom endpoint requests without losing Request fields", async () => {
    const ssrfSafeFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.doMock("../../extensions/url-safety.js", () => ({ ssrfSafeFetch }));
    try {
      mockAiSdk();
      const { createOpenAI } = mockOpenAIProvider();
      const { createAISDKEngine } = await import("./ai-sdk-engine.js");
      await drain(
        createAISDKEngine("openai", {
          apiKey: "sk-test",
          baseUrl: "https://gateway.example/v1",
        }).stream(BASE_STREAM_OPTIONS),
      );

      const providerConfig = createOpenAI.mock.calls[0][0];
      const requestFetch = providerConfig.fetch as typeof fetch;
      const controller = new AbortController();
      const request = new Request(
        "https://gateway.example/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"model":"gpt-test"}',
          signal: controller.signal,
        },
      );
      await requestFetch(request, { headers: { "x-provider-test": "kept" } });

      expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);
      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        "https://gateway.example/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          signal: expect.any(AbortSignal),
          duplex: "half",
        }),
        expect.objectContaining({
          followRedirects: false,
          requireDispatcher: true,
        }),
      );
      const requestInit = ssrfSafeFetch.mock.calls[0][1] as RequestInit;
      const requestSignal = requestInit.signal as AbortSignal;
      expect(new Headers(requestInit.headers).get("x-provider-test")).toBe(
        "kept",
      );
      expect(requestInit.body).toBeInstanceOf(ReadableStream);
      controller.abort();
      expect(requestSignal.aborted).toBe(true);
      await expect(
        requestFetch("https://other.example/v1/chat/completions"),
      ).rejects.toThrow(/provider request escaped its configured origin/);
      expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);

      ssrfSafeFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/" },
        }),
      );
      await expect(
        requestFetch("https://gateway.example/v1/chat/completions"),
      ).rejects.toThrow(/provider endpoint redirects are disabled/);
      expect(ssrfSafeFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock("../../extensions/url-safety.js");
      vi.resetModules();
    }
  });

  it("keeps configured provider requests available in edge runtimes", async () => {
    const ssrfSafeFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.doMock("../../extensions/url-safety.js", () => ({ ssrfSafeFetch }));
    vi.doMock("../../shared/runtime.js", () => ({
      isNodeRuntime: () => false,
    }));
    try {
      mockAiSdk();
      const { createOpenAI } = mockOpenAIProvider();
      const { createAISDKEngine } = await import("./ai-sdk-engine.js");
      await drain(
        createAISDKEngine("openai", {
          apiKey: "sk-test",
          baseUrl: "https://gateway.example/v1",
        }).stream(BASE_STREAM_OPTIONS),
      );

      const requestFetch = createOpenAI.mock.calls[0][0].fetch as typeof fetch;
      await requestFetch("https://gateway.example/v1/chat/completions", {
        method: "POST",
      });

      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        "https://gateway.example/v1/chat/completions",
        { method: "POST" },
        expect.objectContaining({
          followRedirects: false,
          requireDispatcher: false,
        }),
      );
    } finally {
      vi.doUnmock("../../extensions/url-safety.js");
      vi.doUnmock("../../shared/runtime.js");
      vi.resetModules();
    }
  });

  it("keeps arbitrary local Ollama model ids", async () => {
    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("ollama", {
      allowEnvFallback: false,
    });

    expect(engine.preserveCustomModels).toBe(true);
  });

  it("passes arbitrary OpenRouter model ids through runtime execution", async () => {
    const { streamText } = mockAiSdk();
    const provider = vi.fn().mockReturnValue({ id: "openrouter-model" });
    const createOpenRouter = vi.fn().mockReturnValue(provider);
    vi.doMock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const { normalizeModelForEngine } = await import("./registry.js");
    const engine = createAISDKEngine("openrouter", { apiKey: "sk-or-test" });
    const model = normalizeModelForEngine(engine, "z-ai/glm-5.3-flash");

    await drain(engine.stream({ ...BASE_STREAM_OPTIONS, model }));

    expect(engine.preserveCustomModels).toBe(true);
    expect(provider).toHaveBeenCalledWith("z-ai/glm-5.3-flash");
    expect(streamText).toHaveBeenCalled();
  });

  it("caps AI SDK provider tools at 128 and keeps tool-search", async () => {
    const { streamText } = mockAiSdk();
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });
    const tools = Array.from({ length: 129 }, (_, index) =>
      makeTool(index === 128 ? "tool-search" : `tool-${index}`),
    );

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        tools,
      }),
    );

    const call = streamText.mock.calls[0][0];
    const toolNames = Object.keys(call.tools);
    expect(toolNames).toHaveLength(128);
    expect(toolNames).toContain("tool-search");
    expect(toolNames).not.toContain("tool-127");
  });

  const TEST_TOOL = {
    name: "test-tool",
    description: "A test tool",
    inputSchema: { type: "object" as const, properties: {} },
  };

  it("sends reasoning effort 'none' when tools are present on a forced Chat Completions base URL", async () => {
    const { streamText } = mockAiSdk();
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: "https://gateway.example/v1",
    });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        tools: [TEST_TOOL],
        reasoningEffort: "medium",
      }),
    );

    const call = streamText.mock.calls[0]?.[0];
    expect(call.providerOptions?.openai?.reasoningEffort).toBe("none");
  });

  it("still applies reasoning effort on a forced Chat Completions base URL when there are no tools", async () => {
    const { streamText } = mockAiSdk();
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: "https://gateway.example/v1",
    });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        tools: [],
        reasoningEffort: "medium",
      }),
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          openai: expect.objectContaining({ reasoningEffort: "medium" }),
        }),
      }),
    );
  });

  it("applies reasoning effort with tools present on the default Responses API path (no baseUrl)", async () => {
    const { streamText } = mockAiSdk();
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        tools: [TEST_TOOL],
        reasoningEffort: "medium",
      }),
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          openai: expect.objectContaining({ reasoningEffort: "medium" }),
        }),
      }),
    );
  });

  it("applies reasoning effort with tools on an explicit first-party endpoint", async () => {
    const { streamText } = mockAiSdk();
    const { provider, responsesModel } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });

    await drain(
      engine.stream({
        ...BASE_STREAM_OPTIONS,
        tools: [TEST_TOOL],
        reasoningEffort: "medium",
      }),
    );

    expect(engine.preserveCustomModels).toBe(false);
    expect(provider).toHaveBeenCalledWith("gpt-5.5");
    expect(provider.chat).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: responsesModel,
        providerOptions: expect.objectContaining({
          openai: expect.objectContaining({ reasoningEffort: "medium" }),
        }),
      }),
    );
  });
});

describe("AISDKEngine first-event deadline", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts with a retryable network error when the stream produces no parts within 120s", async () => {
    const streamText = vi.fn((params: any) => ({
      fullStream: (async function* () {
        await new Promise((_resolve, reject) => {
          const signal: AbortSignal | undefined = params.abortSignal;
          if (signal?.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason ?? new Error("aborted")),
            { once: true },
          );
        });
      })(),
    }));
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });
    vi.useFakeTimers();

    const events: any[] = [];
    let settledEarly = false;
    const runPromise = (async () => {
      for await (const e of engine.stream(BASE_STREAM_OPTIONS)) events.push(e);
    })();
    void runPromise
      .catch(() => {})
      .then(() => {
        settledEarly = true;
      });

    await vi.advanceTimersByTimeAsync(119_000);
    expect(settledEarly).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(runPromise).rejects.toThrow();

    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("error");
    expect(stopEvent?.errorCode).toBe("provider_network_error");
    expect(stopEvent?.providerRetryable).toBe(true);
    expect(stopEvent?.error).toContain("120s");
  });

  it("does not abort once the stream has produced a real part (a synthetic 'start' part alone does not count)", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { type: "start" };
        yield { type: "text-delta", text: "hi" };
        yield { type: "finish", finishReason: "stop", usage: {} };
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { apiKey: "sk-test" });

    const events: any[] = [];
    for await (const e of engine.stream(BASE_STREAM_OPTIONS)) events.push(e);

    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("end_turn");
    expect(stopEvent?.errorCode).toBeUndefined();
  });
});

describe("AISDKEngine streamed tool-input reconciliation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function runToolInputStream(parts: unknown[], stepContent?: unknown[]) {
    const streamText = vi
      .fn()
      .mockImplementation(
        (options: { onStepFinish?: (step: unknown) => void }) => {
          if (stepContent) options.onStepFinish?.({ content: stepContent });
          return {
            fullStream: (async function* () {
              for (const part of parts) yield part;
              yield { type: "finish", finishReason: "tool-calls", usage: {} };
            })(),
          };
        },
      );
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));
    mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const events: any[] = [];
    for await (const event of createAISDKEngine("openai", {
      apiKey: "key",
    }).stream(BASE_STREAM_OPTIONS)) {
      events.push(event);
    }
    return events;
  }

  it("assembles a tool call whose arguments arrive across multiple deltas but never lands a tool-call part", async () => {
    const events = await runToolInputStream([
      {
        type: "tool-input-start",
        id: "call_1",
        toolName: "create_document",
      },
      { type: "tool-input-delta", id: "call_1", delta: '{"title":"Q' },
      { type: "tool-input-delta", id: "call_1", delta: '3 plan"' },
      { type: "tool-input-delta", id: "call_1", delta: "}" },
    ]);

    expect(events.find((e) => e.type === "tool-call")).toEqual({
      type: "tool-call",
      id: "call_1",
      name: "create_document",
      input: { title: "Q3 plan" },
    });
    expect(
      events.find((e) => e.type === "assistant-content")?.parts,
    ).toContainEqual({
      type: "tool-call",
      id: "call_1",
      name: "create_document",
      input: { title: "Q3 plan" },
    });
  });

  it("reports a tool call truncated mid-arguments as an in-band tool-call error", async () => {
    const events = await runToolInputStream([
      {
        type: "tool-input-start",
        id: "call_1",
        toolName: "create_document",
      },
      { type: "tool-input-delta", id: "call_1", delta: '{"title":"Q' },
    ]);

    expect(events.find((e) => e.type === "tool-call-error")).toMatchObject({
      id: "call_1",
      name: "create_document",
      input: '{"title":"Q',
    });
    expect(events.some((e) => e.type === "tool-call")).toBe(false);
  });

  it("does not re-emit a tool call the SDK already delivered", async () => {
    const events = await runToolInputStream([
      {
        type: "tool-input-start",
        id: "call_1",
        toolName: "create_document",
      },
      { type: "tool-input-delta", id: "call_1", delta: '{"title":"Q3 plan"}' },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "create_document",
        input: { title: "Q3 plan" },
      },
    ]);

    expect(events.filter((e) => e.type === "tool-call")).toHaveLength(1);
    expect(events.some((e) => e.type === "tool-call-error")).toBe(false);
  });

  it("recovers complete streamed arguments when the SDK terminal input is empty", async () => {
    const input = {
      id: "ext-1",
      operation: "edit",
      payloadJson: "{}",
    };
    const events = await runToolInputStream(
      [
        {
          type: "tool-input-start",
          id: "call_1",
          toolName: "update-extension",
        },
        {
          type: "tool-input-delta",
          id: "call_1",
          delta: JSON.stringify(input),
        },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "update-extension",
          input: {},
        },
      ],
      [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "update-extension",
          input: {},
        },
      ],
    );

    expect(events.find((e) => e.type === "tool-call")).toEqual({
      type: "tool-call",
      id: "call_1",
      name: "update-extension",
      input,
    });
    expect(events.find((e) => e.type === "assistant-content")?.parts).toEqual([
      {
        type: "tool-call",
        id: "call_1",
        name: "update-extension",
        input,
      },
    ]);
  });
});

describe("AISDKEngine missing-credential fail-closed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed with missing_credentials instead of sending an unauthenticated request", async () => {
    const { streamText } = mockAiSdk();
    const createOpenRouter = vi.fn();
    vi.doMock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openrouter", { allowEnvFallback: false });

    const events: any[] = [];
    for await (const e of engine.stream(BASE_STREAM_OPTIONS as any)) {
      events.push(e);
    }

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(stop?.error).toContain("OPENROUTER_API_KEY");
    expect(createOpenRouter).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("still runs when a key is present", async () => {
    const { streamText } = mockAiSdk();
    const provider = vi.fn().mockReturnValue({ id: "m" });
    vi.doMock("@openrouter/ai-sdk-provider", () => ({
      createOpenRouter: vi.fn().mockReturnValue(provider),
    }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openrouter", { apiKey: "sk-or-test" });
    await drain(engine.stream(BASE_STREAM_OPTIONS as any));

    expect(streamText).toHaveBeenCalled();
  });

  it("allows a keyless provider when a baseUrl is configured", async () => {
    const { streamText } = mockAiSdk();
    const provider = vi.fn().mockReturnValue({ id: "m" });
    vi.doMock("@openrouter/ai-sdk-provider", () => ({
      createOpenRouter: vi.fn().mockReturnValue(provider),
    }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openrouter", {
      allowEnvFallback: false,
      baseUrl: "http://localhost:4000/v1",
    });
    await drain(engine.stream(BASE_STREAM_OPTIONS as any));

    expect(streamText).toHaveBeenCalled();
  });

  it.each([
    ["https://openrouter.ai/api/v1"],
    ["https://api.example.com/v1"],
    ["not-a-url"],
  ])(
    "fails closed for a keyless provider on a public baseUrl (%s)",
    async (baseUrl) => {
      const { streamText } = mockAiSdk();
      const createOpenRouter = vi.fn();
      vi.doMock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter }));

      const { createAISDKEngine } = await import("./ai-sdk-engine.js");
      const engine = createAISDKEngine("openrouter", {
        allowEnvFallback: false,
        baseUrl,
      });

      const events: any[] = [];
      for await (const e of engine.stream(BASE_STREAM_OPTIONS as any)) {
        events.push(e);
      }

      const stop = events.find((e) => e.type === "stop");
      expect(stop?.reason).toBe("error");
      expect(stop?.errorCode).toBe("missing_credentials");
      expect(stop?.error).toContain("OPENROUTER_API_KEY");
      expect(createOpenRouter).not.toHaveBeenCalled();
      expect(streamText).not.toHaveBeenCalled();
    },
  );
});
