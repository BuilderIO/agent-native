import { describe, it, expect, vi, beforeEach } from "vitest";

describe("OpenRouter builtin engine", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("registers ai-sdk:openrouter with expected metadata", async () => {
    const { registerBuiltinEngines } = await import("./builtin.js");
    const { getAgentEngineEntry } = await import("./registry.js");

    registerBuiltinEngines();

    const entry = getAgentEngineEntry("ai-sdk:openrouter");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("OpenRouter");
    expect(entry?.requiredEnvVars).toEqual(["OPENROUTER_API_KEY"]);
    expect(entry?.defaultModel).toMatch(/\//); // vendor/model form
    expect(entry?.supportedModels).toEqual(
      expect.arrayContaining(["anthropic/claude-sonnet-4.6"]),
    );
    expect(entry?.installPackage).toContain("@openrouter/ai-sdk-provider");
  });

  it("stream wires apiKey + appName + appUrl into createOpenRouter and resolves the model via provider(model)", async () => {
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
      modelId: "anthropic/claude-sonnet-4.5",
    };
    // `@openrouter/ai-sdk-provider`'s returned provider is callable AND has .chat().
    const providerCallable = vi.fn().mockReturnValue(chatModel);
    const openrouter: any = Object.assign(providerCallable, {
      chat: vi.fn().mockReturnValue(chatModel),
    });
    const createOpenRouter = vi.fn().mockReturnValue(openrouter);
    vi.doMock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openrouter", {
      apiKey: "or-test-key",
      appName: "My App",
      appUrl: "https://myapp.example",
    });

    const events: any[] = [];
    for await (const e of engine.stream({
      model: "anthropic/claude-sonnet-4.5",
      systemPrompt: "",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    } as any)) {
      events.push(e);
    }

    expect(createOpenRouter).toHaveBeenCalledWith({
      apiKey: "or-test-key",
      appName: "My App",
      appUrl: "https://myapp.example",
    });
    expect(providerCallable).toHaveBeenCalledWith(
      "anthropic/claude-sonnet-4.5",
    );
    expect(streamText).toHaveBeenCalled();

    const stop = events.find((e) => e.type === "stop");
    expect(stop).toBeDefined();
    expect(stop.reason).not.toBe("error");
  });

  it("falls back to OPENROUTER_API_KEY env var when apiKey not in config", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "env-or-key");

    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { type: "finish", finishReason: "stop", usage: {} };
      })(),
    });
    vi.doMock("ai", () => ({ streamText, jsonSchema: (s: unknown) => s }));

    const chat = vi.fn().mockReturnValue({});
    const openrouter: any = Object.assign(vi.fn().mockReturnValue({}), {
      chat,
    });
    const createOpenRouter = vi.fn().mockReturnValue(openrouter);
    vi.doMock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter }));

    const { createAISDKEngine } = await import("./ai-sdk-engine.js");
    const engine = createAISDKEngine("openrouter", {});

    for await (const _ of engine.stream({
      model: "anthropic/claude-sonnet-4.5",
      systemPrompt: "",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    } as any)) {
      void _;
    }

    expect(createOpenRouter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "env-or-key" }),
    );
  });
});
