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

  it("defaults to adaptive thinking at medium effort for a reasoning-capable Claude model", async () => {
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
      effort: "medium",
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
      budgetTokens: 4_096,
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

  it("defaults to medium reasoning when no reasoningEffort is set for Google", async () => {
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
      thinkingLevel: "medium",
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

  it("never reaches the deploy key when env fallback is disabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-deploy");
    const { streamText } = mockAiSdk();
    const { createOpenAI } = mockOpenAIProvider();

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openai", { allowEnvFallback: false });

    const events: any[] = [];
    for await (const e of engine.stream(BASE_STREAM_OPTIONS)) events.push(e);

    // Previously this constructed the provider with `apiKey: ""` so the AI SDK
    // could not read the ambient deploy key itself. That kept the deploy key
    // out, but shipped a guaranteed-401 unauthenticated request. Failing closed
    // keeps the deploy key out just as firmly and reports the real cause.
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
    });
    expect(provider).not.toHaveBeenCalled();
    expect(provider.chat).toHaveBeenCalledWith("gpt-5.5");
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: chatModel }),
    );
    expect(engine.preserveCustomModels).toBe(true);
  });

  // Real prod incident (Sentry AGENT-NATIVE-BROWSER-94, gpt-5.6-terra): OpenAI
  // rejects `reasoning_effort` together with function tools on the legacy
  // Chat Completions surface — "Function tools with reasoning_effort are not
  // supported for <model> in /v1/chat/completions." `createProviderModel`
  // forces Chat Completions whenever a custom baseUrl is configured (the test
  // above), so that combination is reachable in prod whenever the app also
  // has tools available, not just for one specific model name.
  const TEST_TOOL = {
    name: "test-tool",
    description: "A test tool",
    inputSchema: { type: "object" as const, properties: {} },
  };

  // Omitting the field is NOT enough: OpenAI applies the model's own default
  // effort when `reasoning_effort` is absent and rejects the call identically.
  // Only the explicit "none" clears it.
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

  async function runToolInputStream(parts: unknown[]) {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        for (const part of parts) yield part;
        yield { type: "finish", finishReason: "tool-calls", usage: {} };
      })(),
    });
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
});

describe("AISDKEngine missing-credential fail-closed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Production: the clips app ran `ai-sdk:openrouter` with no OPENROUTER_API_KEY.
  // The provider factory was built with no apiKey, the SDK sent no Authorization
  // header, and the gateway's 401 "Missing Authentication header" was classified
  // `http_401` — a transport error naming the wrong cause, retried every 30
  // minutes forever. 18/18 scheduled runs failed this way.
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
    // The whole point: no request was ever built or sent.
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

  // A self-hosted or local gateway may legitimately accept no credential.
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
});
