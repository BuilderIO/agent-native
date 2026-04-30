import { describe, it, expect, beforeEach, vi } from "vitest";

// Registry uses a module-level Map — reset between tests by re-importing
// with a fresh module via vi.resetModules().
describe("AgentEngine registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../../settings/store.js");
    vi.doUnmock("../../server/request-context.js");
    vi.doUnmock("../../secrets/storage.js");
    // Clear env vars that influence resolveEngine
    delete process.env.AGENT_ENGINE;
  });

  it("registers and retrieves an engine", async () => {
    const { registerAgentEngine, getAgentEngineEntry } =
      await import("./registry.js");

    const fakeEngine = { name: "test", stream: vi.fn() } as any;
    registerAgentEngine({
      name: "test-engine",
      label: "Test",
      description: "A test engine",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      requiredEnvVars: [],
      create: () => fakeEngine,
    });

    const entry = getAgentEngineEntry("test-engine");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Test");
  });

  it("listAgentEngines returns all registered entries", async () => {
    const { registerAgentEngine, listAgentEngines } =
      await import("./registry.js");

    registerAgentEngine({
      name: "engine-a",
      label: "A",
      description: "",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "a",
      supportedModels: ["a"],
      requiredEnvVars: [],
      create: () => ({
        name: "engine-a",
        label: "A",
        defaultModel: "a",
        supportedModels: [],
        capabilities: {} as any,
        stream: vi.fn(),
      }),
    });

    const list = listAgentEngines();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.find((e) => e.name === "engine-a")).toBeDefined();
  });

  it("resolveEngine uses explicit AgentEngine instance directly", async () => {
    const { resolveEngine } = await import("./registry.js");

    const fakeEngine = {
      name: "direct",
      label: "Direct",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const resolved = await resolveEngine({ engineOption: fakeEngine });
    expect(resolved).toBe(fakeEngine);
  });

  it("resolveEngine falls back to default anthropic when nothing configured", async () => {
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");

    const fakeAnthropicEngine = {
      name: "anthropic",
      label: "Anthropic",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const createFn = vi.fn().mockReturnValue(fakeAnthropicEngine);

    registerAgentEngine({
      name: "anthropic",
      label: "Claude",
      description: "",
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: true,
        parallelToolCalls: true,
      },
      defaultModel: "claude-sonnet-4-6",
      supportedModels: ["claude-sonnet-4-6"],
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: createFn,
    });

    const resolved = await resolveEngine({});
    expect(createFn).toHaveBeenCalled();
    expect(resolved).toBe(fakeAnthropicEngine);
  });

  describe("getStoredModelForEngine", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("returns the stored model when the stored engine name matches", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue({
          engine: "ai-sdk:openrouter",
          model: "google/gemini-2.5-flash",
        }),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      const result = await getStoredModelForEngine("ai-sdk:openrouter");
      expect(result).toBe("google/gemini-2.5-flash");
    });

    it("returns undefined when the stored engine doesn't match", async () => {
      // Don't apply a Claude model string to an OpenRouter engine.
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue({
          engine: "anthropic",
          model: "claude-sonnet-4-6",
        }),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      expect(
        await getStoredModelForEngine("ai-sdk:openrouter"),
      ).toBeUndefined();
    });

    it("returns undefined when no model is stored", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue({ engine: "ai-sdk:openrouter" }),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      expect(
        await getStoredModelForEngine("ai-sdk:openrouter"),
      ).toBeUndefined();
    });

    it("returns undefined for an empty-string model", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi
          .fn()
          .mockResolvedValue({ engine: "ai-sdk:openrouter", model: "" }),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      expect(
        await getStoredModelForEngine("ai-sdk:openrouter"),
      ).toBeUndefined();
    });

    it("swallows settings-store errors", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi
          .fn()
          .mockRejectedValue(new Error("settings table not ready")),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      expect(
        await getStoredModelForEngine("ai-sdk:openrouter"),
      ).toBeUndefined();
    });

    it("accepts an engine instance and uses its .name", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi
          .fn()
          .mockResolvedValue({ engine: "ai-sdk:openai", model: "gpt-4o" }),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      const fakeEngine = { name: "ai-sdk:openai" } as any;
      expect(await getStoredModelForEngine(fakeEngine)).toBe("gpt-4o");
    });
  });

  it("resolveEngine uses env AGENT_ENGINE when set", async () => {
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");

    const fakeEngine = {
      name: "env-engine",
      label: "Env",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const createFn = vi.fn().mockReturnValue(fakeEngine);

    registerAgentEngine({
      name: "env-engine",
      label: "Env",
      description: "",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "m",
      supportedModels: [],
      requiredEnvVars: [],
      create: createFn,
    });

    // Also register anthropic so the fallback doesn't throw
    registerAgentEngine({
      name: "anthropic",
      label: "Claude",
      description: "",
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: true,
        parallelToolCalls: true,
      },
      defaultModel: "claude-sonnet-4-6",
      supportedModels: [],
      requiredEnvVars: [],
      create: vi.fn().mockReturnValue(fakeEngine),
    });

    process.env.AGENT_ENGINE = "env-engine";
    const resolved = await resolveEngine({});
    expect(createFn).toHaveBeenCalled();
    expect(resolved).toBe(fakeEngine);
  });

  it("does not treat legacy inline agent-engine api keys as configured", async () => {
    const { isAgentEngineSettingConfigured } = await import("./registry.js");

    expect(
      isAgentEngineSettingConfigured({
        engine: "anthropic",
        apiKey: "sk-leaked-global",
      }),
    ).toBe(false);
    expect(
      isAgentEngineSettingConfigured({
        engine: "anthropic",
        config: { apiKey: "sk-leaked-global" },
      }),
    ).toBe(false);
  });

  it("strips legacy inline api keys from the global agent-engine setting before creating the engine", async () => {
    vi.doMock("../../settings/store.js", () => ({
      getSetting: vi.fn().mockResolvedValue({
        engine: "stored-engine",
        apiKey: "sk-global-top-level",
        config: {
          apiKey: "sk-global-config",
          baseURL: "https://llm.example.test",
        },
      }),
    }));

    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");

    const fakeEngine = {
      name: "stored-engine",
      label: "Stored",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const createFn = vi.fn().mockReturnValue(fakeEngine);

    registerAgentEngine({
      name: "stored-engine",
      label: "Stored",
      description: "",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "m",
      supportedModels: [],
      requiredEnvVars: [],
      create: createFn,
    });

    const resolved = await resolveEngine({ apiKey: "sk-request-scoped" });

    expect(createFn).toHaveBeenCalledWith({
      apiKey: "sk-request-scoped",
      baseURL: "https://llm.example.test",
    });
    expect(JSON.stringify(createFn.mock.calls)).not.toContain(
      "sk-global-top-level",
    );
    expect(JSON.stringify(createFn.mock.calls)).not.toContain(
      "sk-global-config",
    );
    expect(resolved).toBe(fakeEngine);
  });

  describe("detectEngineFromUserSecrets", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.doUnmock("../../settings/store.js");
      vi.doUnmock("../../server/request-context.js");
      vi.doUnmock("../../secrets/storage.js");
      delete process.env.AGENT_ENGINE;
      delete process.env.AGENT_ENGINE_PREFER_BYO_KEY;
    });

    it("returns null when no request user is set", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => undefined,
      }));
      const { detectEngineFromUserSecrets } = await import("./registry.js");
      expect(await detectEngineFromUserSecrets()).toBeNull();
    });

    it("returns null for the local-dev session", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "local@localhost",
      }));
      const { detectEngineFromUserSecrets } = await import("./registry.js");
      expect(await detectEngineFromUserSecrets()).toBeNull();
    });

    it("picks the Builder engine when the user has BUILDER_PRIVATE_KEY in app_secrets", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "brent@example.com",
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) =>
          key === "BUILDER_PRIVATE_KEY"
            ? { key, value: "p-key-from-app-secrets" }
            : null,
        ),
      }));

      const { registerAgentEngine, detectEngineFromUserSecrets } =
        await import("./registry.js");

      registerAgentEngine({
        name: "builder",
        label: "Builder",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY"],
        create: vi.fn() as any,
      });
      registerAgentEngine({
        name: "anthropic",
        label: "Anthropic",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
        create: vi.fn() as any,
      });

      const detected = await detectEngineFromUserSecrets();
      expect(detected?.name).toBe("builder");
    });

    it("resolveEngine routes to Builder when the user has Builder creds in app_secrets and no env-level keys", async () => {
      delete process.env.BUILDER_PRIVATE_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "brent@example.com",
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) =>
          key === "BUILDER_PRIVATE_KEY"
            ? { key, value: "p-key-from-app-secrets" }
            : null,
        ),
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const builderEngine = { name: "builder", stream: vi.fn() } as any;
      const anthropicEngine = { name: "anthropic", stream: vi.fn() } as any;
      const builderCreate = vi.fn().mockReturnValue(builderEngine);
      const anthropicCreate = vi.fn().mockReturnValue(anthropicEngine);

      registerAgentEngine({
        name: "builder",
        label: "Builder",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY"],
        create: builderCreate,
      });
      registerAgentEngine({
        name: "anthropic",
        label: "Anthropic",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
        create: anthropicCreate,
      });

      const resolved = await resolveEngine({});
      expect(builderCreate).toHaveBeenCalled();
      expect(anthropicCreate).not.toHaveBeenCalled();
      expect(resolved).toBe(builderEngine);
    });
  });
});
