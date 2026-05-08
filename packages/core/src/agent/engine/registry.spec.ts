import { describe, it, expect, beforeEach, vi } from "vitest";

// Registry uses a module-level Map — reset between tests by re-importing
// with a fresh module via vi.resetModules().
describe("AgentEngine registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../../settings/store.js");
    vi.doUnmock("../../server/request-context.js");
    vi.doUnmock("../../secrets/storage.js");
    vi.doUnmock("../../db/client.js");
    vi.unstubAllEnvs();
    // Clear env vars that influence resolveEngine
    delete process.env.AGENT_ENGINE;
    delete process.env.AGENT_ENGINE_PREFER_BYO_KEY;
    delete process.env.ANTHROPIC_API_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
    delete process.env.OPENAI_API_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
    delete process.env.BUILDER_PRIVATE_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
    delete process.env.BUILDER_PUBLIC_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
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
      allowEnvFallback: true,
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
        getRequestOrgId: () => undefined,
      }));
      const { detectEngineFromUserSecrets } = await import("./registry.js");
      expect(await detectEngineFromUserSecrets()).toBeNull();
    });

    it("returns null for the local-dev session", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "local@localhost",
        getRequestOrgId: () => undefined,
      }));
      const { detectEngineFromUserSecrets } = await import("./registry.js");
      expect(await detectEngineFromUserSecrets()).toBeNull();
    });

    it("picks the Builder engine when the user has Builder keys in app_secrets", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "brent@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) => {
          if (key === "BUILDER_PRIVATE_KEY") {
            return { key, value: "p-key-from-app-secrets" };
          }
          if (key === "BUILDER_PUBLIC_KEY") {
            return { key, value: "space-from-app-secrets" };
          }
          return null;
        }),
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
        requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
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

    it("picks the Builder engine when the active org has shared Builder credentials", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "member@example.com",
        getRequestOrgId: () => "builder_org",
      }));
      const readAppSecret = vi.fn(
        async ({ key, scope }: { key: string; scope: "user" | "org" }) =>
          key.startsWith("BUILDER_") && scope === "org"
            ? {
                key,
                value:
                  key === "BUILDER_PRIVATE_KEY"
                    ? "p-key-from-org-secrets"
                    : "space-from-org-secrets",
              }
            : null,
      );
      vi.doMock("../../secrets/storage.js", () => ({ readAppSecret }));

      const { registerAgentEngine, detectEngineFromUserSecrets } =
        await import("./registry.js");

      registerAgentEngine({
        name: "builder",
        label: "Builder",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
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
      expect(readAppSecret).toHaveBeenCalledWith({
        key: "BUILDER_PRIVATE_KEY",
        scope: "user",
        scopeId: "member@example.com",
      });
      expect(readAppSecret).toHaveBeenCalledWith({
        key: "BUILDER_PRIVATE_KEY",
        scope: "org",
        scopeId: "builder_org",
      });
      expect(readAppSecret).toHaveBeenCalledWith({
        key: "BUILDER_PUBLIC_KEY",
        scope: "user",
        scopeId: "member@example.com",
      });
      expect(readAppSecret).toHaveBeenCalledWith({
        key: "BUILDER_PUBLIC_KEY",
        scope: "org",
        scopeId: "builder_org",
      });
    });

    it("resolveEngine routes to Builder when the user has Builder creds in app_secrets and no env-level keys", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "brent@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) => {
          if (key === "BUILDER_PRIVATE_KEY") {
            return { key, value: "p-key-from-app-secrets" };
          }
          if (key === "BUILDER_PUBLIC_KEY") {
            return { key, value: "space-from-app-secrets" };
          }
          return null;
        }),
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
        requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
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

    it("resolveEngine prefers connected Builder over a stale stored provider env key", async () => {
      process.env.OPENAI_API_KEY = "sk-ant-wrong-provider"; // guard:allow-env-credential — fixture: simulate a stale deploy env key
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue({
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        }),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "steve@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) => {
          if (key === "BUILDER_PRIVATE_KEY") {
            return { key, value: "p-key-from-app-secrets" };
          }
          if (key === "BUILDER_PUBLIC_KEY") {
            return { key, value: "space-from-app-secrets" };
          }
          return null;
        }),
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const builderEngine = { name: "builder", stream: vi.fn() } as any;
      const openAiEngine = { name: "ai-sdk:openai", stream: vi.fn() } as any;
      const builderCreate = vi.fn().mockReturnValue(builderEngine);
      const openAiCreate = vi.fn().mockReturnValue(openAiEngine);

      registerAgentEngine({
        name: "builder",
        label: "Builder",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        create: builderCreate,
      });
      registerAgentEngine({
        name: "ai-sdk:openai",
        label: "OpenAI",
        description: "",
        capabilities: {} as any,
        defaultModel: "gpt-5.4",
        supportedModels: [],
        requiredEnvVars: ["OPENAI_API_KEY"],
        create: openAiCreate,
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

      const resolved = await resolveEngine({ apiKey: "sk-ant-wrong-provider" });
      expect(builderCreate).toHaveBeenCalled();
      expect(openAiCreate).not.toHaveBeenCalled();
      expect(resolved).toBe(builderEngine);
    });

    it("resolveEngine still honors a stored BYOK provider when Builder is not connected", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue({
          engine: "ai-sdk:google",
          model: "gemini-3.1-pro-preview",
        }),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "steve@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) =>
          key === "GOOGLE_GENERATIVE_AI_API_KEY"
            ? { key, value: "google-user-key" }
            : null,
        ),
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const googleEngine = { name: "ai-sdk:google", stream: vi.fn() } as any;
      const googleCreate = vi.fn().mockReturnValue(googleEngine);
      const openAiCreate = vi.fn().mockReturnValue({
        name: "ai-sdk:openai",
        stream: vi.fn(),
      } as any);

      registerAgentEngine({
        name: "builder",
        label: "Builder",
        description: "",
        capabilities: {} as any,
        defaultModel: "m",
        supportedModels: [],
        requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        create: vi.fn() as any,
      });
      registerAgentEngine({
        name: "ai-sdk:openai",
        label: "OpenAI",
        description: "",
        capabilities: {} as any,
        defaultModel: "gpt-5.4",
        supportedModels: [],
        requiredEnvVars: ["OPENAI_API_KEY"],
        create: openAiCreate,
      });
      registerAgentEngine({
        name: "ai-sdk:google",
        label: "Gemini",
        description: "",
        capabilities: {} as any,
        defaultModel: "gemini-3.1-pro-preview",
        supportedModels: [],
        requiredEnvVars: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        create: googleCreate,
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

      const resolved = await resolveEngine({ apiKey: "google-user-key" });
      expect(googleCreate).toHaveBeenCalledWith({
        apiKey: "google-user-key",
        allowEnvFallback: true,
      });
      expect(openAiCreate).not.toHaveBeenCalled();
      expect(resolved).toBe(googleEngine);
    });

    it("does not auto-detect deploy-level provider env keys for signed-in production shared-database users", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.OPENAI_API_KEY = "sk-deploy"; // guard:allow-env-credential — fixture: prove signed-in users do NOT pick up deploy env
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "new@example.com",
        getRequestOrgId: () => "org-1",
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock("../../db/client.js", () => ({
        isLocalDatabase: () => false,
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const openAiCreate = vi.fn().mockReturnValue({
        name: "ai-sdk:openai",
        stream: vi.fn(),
      } as any);
      const anthropicEngine = { name: "anthropic", stream: vi.fn() } as any;
      const anthropicCreate = vi.fn().mockReturnValue(anthropicEngine);

      registerAgentEngine({
        name: "ai-sdk:openai",
        label: "OpenAI",
        description: "",
        capabilities: {} as any,
        defaultModel: "gpt-5.4",
        supportedModels: [],
        requiredEnvVars: ["OPENAI_API_KEY"],
        create: openAiCreate,
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

      expect(openAiCreate).not.toHaveBeenCalled();
      expect(anthropicCreate).toHaveBeenCalledWith({
        apiKey: undefined,
        allowEnvFallback: false,
      });
      expect(resolved).toBe(anthropicEngine);
    });

    it("disables deploy env fallback for explicitly selected engines in signed-in production shared-database requests", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.OPENAI_API_KEY = "sk-deploy"; // guard:allow-env-credential — fixture: prove explicit engine selection does NOT fall back to deploy env
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "new@example.com",
        getRequestOrgId: () => "org-1",
      }));
      vi.doMock("../../db/client.js", () => ({
        isLocalDatabase: () => false,
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const openAiEngine = { name: "ai-sdk:openai", stream: vi.fn() } as any;
      const openAiCreate = vi.fn().mockReturnValue(openAiEngine);
      registerAgentEngine({
        name: "ai-sdk:openai",
        label: "OpenAI",
        description: "",
        capabilities: {} as any,
        defaultModel: "gpt-5.4",
        supportedModels: [],
        requiredEnvVars: ["OPENAI_API_KEY"],
        create: openAiCreate,
      });

      const resolved = await resolveEngine({ engineOption: "ai-sdk:openai" });

      expect(openAiCreate).toHaveBeenCalledWith({
        apiKey: undefined,
        allowEnvFallback: false,
      });
      expect(resolved).toBe(openAiEngine);
    });
  });
});
