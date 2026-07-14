import { createHash } from "node:crypto";

import { describe, it, expect, beforeEach, vi } from "vitest";

function providerFailureFingerprint(key: string, value: string): string {
  return createHash("sha256")
    .update(key.trim().toUpperCase())
    .update("\0")
    .update(value.trim())
    .digest("hex")
    .slice(0, 24);
}

function readAppSecretsFromSingles(
  readAppSecret: (input: any) => Promise<any>,
) {
  return async ({ keys, scope, scopeId }: any) => {
    const entries = await Promise.all(
      keys.map(async (key: string) => {
        const secret = await readAppSecret({ key, scope, scopeId });
        return secret ? ([key, secret] as const) : null;
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  };
}

// Registry uses a module-level Map — reset between tests by re-importing
// with a fresh module via vi.resetModules().
describe("AgentEngine registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../../settings/store.js");
    vi.doUnmock("../../server/credential-provider.js");
    vi.doUnmock("../../server/request-context.js");
    vi.doUnmock("../../secrets/storage.js");
    vi.doUnmock("../../db/client.js");
    vi.unstubAllEnvs();
    // Clear env vars that influence resolveEngine
    delete process.env.AGENT_ENGINE;
    delete process.env.AGENT_ENGINE_PREFER_BYO_KEY;
    delete process.env.ANTHROPIC_API_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
    delete process.env.OPENAI_API_KEY; // guard:allow-env-credential — test setup clears env to assert credential precedence
    delete process.env.OPENAI_BASE_URL; // guard:allow-env-credential — test setup clears env to assert endpoint precedence
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

  it("resolveEngine rejects explicit string engines whose optional runtime packages are missing", async () => {
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");
    const create = vi.fn();

    registerAgentEngine({
      name: "ai-sdk:openai",
      label: "OpenAI",
      description: "",
      installPackage: "@agent-native/definitely-missing-ai-provider",
      capabilities: {} as any,
      defaultModel: "gpt-5.4",
      supportedModels: [],
      requiredEnvVars: [],
      create,
    });

    await expect(
      resolveEngine({ engineOption: "ai-sdk:openai" }),
    ).rejects.toThrow(/requires optional packages/);
    expect(create).not.toHaveBeenCalled();
  });

  it("resolveEngine rejects explicit object engines whose optional runtime packages are missing", async () => {
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");
    const create = vi.fn();

    registerAgentEngine({
      name: "ai-sdk:openai",
      label: "OpenAI",
      description: "",
      installPackage: "@agent-native/definitely-missing-ai-provider",
      capabilities: {} as any,
      defaultModel: "gpt-5.4",
      supportedModels: [],
      requiredEnvVars: [],
      create,
    });

    await expect(
      resolveEngine({ engineOption: { name: "ai-sdk:openai", config: {} } }),
    ).rejects.toThrow(/requires optional packages/);
    expect(create).not.toHaveBeenCalled();
  });

  it("resolveEngine rejects AGENT_ENGINE when optional runtime packages are missing", async () => {
    process.env.AGENT_ENGINE = "ai-sdk:openai";
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");
    const create = vi.fn();

    registerAgentEngine({
      name: "ai-sdk:openai",
      label: "OpenAI",
      description: "",
      installPackage: "@agent-native/definitely-missing-ai-provider",
      capabilities: {} as any,
      defaultModel: "gpt-5.4",
      supportedModels: [],
      requiredEnvVars: [],
      create,
    });

    await expect(resolveEngine({})).rejects.toThrow(
      /requires optional packages/,
    );
    expect(create).not.toHaveBeenCalled();
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
      defaultModel: "claude-sonnet-5",
      supportedModels: ["claude-sonnet-5"],
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: createFn,
    });

    const resolved = await resolveEngine({});
    expect(createFn).toHaveBeenCalled();
    expect(resolved).toBe(fakeAnthropicEngine);
  });

  it("checks a resolved provider engine against request credentials before a run", async () => {
    vi.doMock("../../server/credential-provider.js", () => ({
      canUseDeployCredentialFallbackForRequest: () => false,
      readDeployCredentialEnv: () => undefined,
      resolveBuilderCredentials: vi.fn(async () => ({
        privateKey: null,
        publicKey: null,
      })),
      resolveSecret: vi.fn(async () => null),
      getProviderCredentialAuthFailure: vi.fn(async () => null),
    }));

    const { registerAgentEngine, isResolvedEngineUsableForRequest } =
      await import("./registry.js");

    const engine = {
      name: "ai-sdk:openai",
      label: "OpenAI",
      defaultModel: "gpt-5.5",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };

    registerAgentEngine({
      name: "ai-sdk:openai",
      label: "OpenAI",
      description: "",
      capabilities: {} as any,
      defaultModel: "gpt-5.5",
      supportedModels: ["gpt-5.5"],
      requiredEnvVars: ["OPENAI_API_KEY"],
      create: vi.fn() as any,
    });

    await expect(isResolvedEngineUsableForRequest(engine)).resolves.toBe(false);
    await expect(
      isResolvedEngineUsableForRequest(engine, { apiKey: "sk-request" }),
    ).resolves.toBe(true);
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
          model: "claude-sonnet-5",
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

    it("prefers a current app default model over the global model", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "owner@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn(async (key: string) => {
          if (key === "u:owner@example.com:agent-app-model-default:analytics") {
            return { engine: "builder", model: "gemini-3-1-pro" };
          }
          return { engine: "builder", model: "claude-sonnet-5" };
        }),
      }));
      const { getStoredModelForEngine } = await import("./registry.js");

      expect(
        await getStoredModelForEngine("builder", { appId: "analytics" }),
      ).toBe("gemini-3-1-pro");
    });
  });

  describe("normalizeModelForEngine", () => {
    it("upgrades unsupported Builder models to the latest supported version match", async () => {
      const { normalizeModelForEngine } = await import("./registry.js");
      const engine = {
        name: "builder",
        defaultModel: "claude-sonnet-5",
        supportedModels: [
          "auto",
          "claude-opus-4-8",
          "claude-sonnet-5",
          "gpt-5-5",
        ],
      } as any;

      expect(normalizeModelForEngine(engine, "claude-opus-4-7")).toBe(
        "claude-opus-4-8",
      );
      expect(normalizeModelForEngine(engine, "gpt-5-4")).toBe("gpt-5-5");
    });

    it("falls back unsupported models to the engine default when no version match exists", async () => {
      const { normalizeModelForEngine } = await import("./registry.js");
      const engine = {
        name: "builder",
        defaultModel: "claude-sonnet-5",
        supportedModels: ["auto", "claude-opus-4-8", "claude-sonnet-5"],
      } as any;

      expect(normalizeModelForEngine(engine, "totally-removed-model")).toBe(
        "claude-sonnet-5",
      );
      expect(normalizeModelForEngine(engine, "gemini-3-1-flash-lite")).toBe(
        "claude-sonnet-5",
      );
    });

    it("keeps supported Builder models and missing values deterministic", async () => {
      const { normalizeModelForEngine } = await import("./registry.js");
      const engine = {
        name: "builder",
        defaultModel: "claude-sonnet-5",
        supportedModels: ["auto", "claude-sonnet-5"],
      } as any;

      expect(normalizeModelForEngine(engine, "claude-sonnet-5")).toBe(
        "claude-sonnet-5",
      );
      expect(normalizeModelForEngine(engine, "auto")).toBe("auto");
      expect(normalizeModelForEngine(engine, " ")).toBe("claude-sonnet-5");
    });

    it("normalizes removed non-Builder models when the engine declares supported models", async () => {
      const { normalizeModelForEngine } = await import("./registry.js");
      const engine = {
        name: "ai-sdk:openrouter",
        defaultModel: "openai/gpt-5.5",
        supportedModels: [
          "anthropic/claude-opus-4.8",
          "openai/gpt-5.5",
          "z-ai/glm-5.2",
        ],
      } as any;

      expect(normalizeModelForEngine(engine, "anthropic/claude-opus-4.7")).toBe(
        "anthropic/claude-opus-4.8",
      );
      expect(normalizeModelForEngine(engine, "custom/provider-model")).toBe(
        "openai/gpt-5.5",
      );
    });

    it("keeps custom model strings for engines without a supported model list", async () => {
      const { normalizeModelForEngine } = await import("./registry.js");
      const engine = {
        name: "custom",
        defaultModel: "default-model",
        supportedModels: [],
      } as any;

      expect(normalizeModelForEngine(engine, "custom/provider-model")).toBe(
        "custom/provider-model",
      );
    });

    it("keeps provider model ids for endpoint-backed OpenAI engines", async () => {
      const { normalizeModelForEngine } = await import("./registry.js");
      const engine = {
        name: "ai-sdk:openai",
        defaultModel: "gpt-5.5",
        supportedModels: ["gpt-5.5"],
        preserveCustomModels: true,
      } as any;

      expect(normalizeModelForEngine(engine, "deepseek-chat")).toBe(
        "deepseek-chat",
      );
      expect(normalizeModelForEngine(engine, "moonshot-v1-8k")).toBe(
        "moonshot-v1-8k",
      );
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
      defaultModel: "claude-sonnet-5",
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

  it("resolveEngine honors a usable app default before the global setting", async () => {
    vi.doMock("../../server/request-context.js", () => ({
      getRequestUserEmail: () => "owner@example.com",
      getRequestOrgId: () => undefined,
    }));
    vi.doMock("../../settings/store.js", () => ({
      getSetting: vi.fn(async (key: string) => {
        if (key === "u:owner@example.com:agent-app-model-default:analytics") {
          return { engine: "app-engine", model: "app-model" };
        }
        if (key === "agent-engine") {
          return { engine: "global-engine", model: "global-model" };
        }
        return null;
      }),
    }));

    const {
      getConfiguredEngineNameForRequest,
      registerAgentEngine,
      resolveEngine,
    } = await import("./registry.js");

    const appEngine = { name: "app-engine", stream: vi.fn() } as any;
    const globalEngine = { name: "global-engine", stream: vi.fn() } as any;
    const appCreate = vi.fn().mockReturnValue(appEngine);
    const globalCreate = vi.fn().mockReturnValue(globalEngine);

    registerAgentEngine({
      name: "app-engine",
      label: "App Engine",
      description: "",
      capabilities: {} as any,
      defaultModel: "app-model",
      supportedModels: [],
      requiredEnvVars: [],
      create: appCreate,
    });
    registerAgentEngine({
      name: "global-engine",
      label: "Global Engine",
      description: "",
      capabilities: {} as any,
      defaultModel: "global-model",
      supportedModels: [],
      requiredEnvVars: [],
      create: globalCreate,
    });
    registerAgentEngine({
      name: "anthropic",
      label: "Anthropic",
      description: "",
      capabilities: {} as any,
      defaultModel: "m",
      supportedModels: [],
      requiredEnvVars: [],
      create: vi.fn() as any,
    });

    const resolved = await resolveEngine({ appId: "analytics" });

    await expect(
      getConfiguredEngineNameForRequest({ appId: "analytics" }),
    ).resolves.toBe("app-engine");
    expect(appCreate).toHaveBeenCalled();
    expect(globalCreate).not.toHaveBeenCalled();
    expect(resolved).toBe(appEngine);
  });

  it("resolveEngine ignores stored engines whose optional runtime packages are missing", async () => {
    vi.doMock("../../settings/store.js", () => ({
      getSetting: vi.fn().mockResolvedValue({
        engine: "ai-sdk:openai",
        model: "gpt-5.4",
      }),
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
      installPackage: "@agent-native/definitely-missing-ai-provider",
      capabilities: {} as any,
      defaultModel: "gpt-5.4",
      supportedModels: [],
      requiredEnvVars: [],
      create: openAiCreate,
    });
    registerAgentEngine({
      name: "anthropic",
      label: "Anthropic",
      description: "",
      capabilities: {} as any,
      defaultModel: "m",
      supportedModels: [],
      requiredEnvVars: [],
      create: anthropicCreate,
    });

    const resolved = await resolveEngine({});

    expect(openAiCreate).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalled();
    expect(resolved).toBe(anthropicEngine);
  });

  it("detectEngineFromEnv skips engines whose optional runtime packages are missing", async () => {
    process.env.OPENAI_API_KEY = "sk-env"; // guard:allow-env-credential — fixture: package check should still prevent selection
    const { detectEngineFromEnv, registerAgentEngine } =
      await import("./registry.js");

    registerAgentEngine({
      name: "ai-sdk:openai",
      label: "OpenAI",
      description: "",
      installPackage: "@agent-native/definitely-missing-ai-provider",
      capabilities: {} as any,
      defaultModel: "gpt-5.4",
      supportedModels: [],
      requiredEnvVars: ["OPENAI_API_KEY"],
      create: vi.fn() as any,
    });

    expect(detectEngineFromEnv()).toBeNull();
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

    it("does not trace engine detection by default", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        vi.doMock("../../server/request-context.js", () => ({
          getRequestUserEmail: () => undefined,
          getRequestOrgId: () => undefined,
        }));

        const { detectEngineFromUserSecrets } = await import("./registry.js");
        expect(await detectEngineFromUserSecrets()).toBeNull();
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
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
      const readAppSecret = vi.fn(async ({ key }: { key: string }) => {
        if (key === "BUILDER_PRIVATE_KEY") {
          return { key, value: "p-key-from-app-secrets" };
        }
        if (key === "BUILDER_PUBLIC_KEY") {
          return { key, value: "space-from-app-secrets" };
        }
        return null;
      });
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
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
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
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

    it("picks the Builder engine from org credentials when the user has only a partial stale Builder row", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "member@example.com",
        getRequestOrgId: () => "builder_org",
      }));
      const readAppSecret = vi.fn(
        async ({
          key,
          scope,
        }: {
          key: string;
          scope: "user" | "org" | "workspace";
        }) => {
          if (scope === "user" && key === "BUILDER_PRIVATE_KEY") {
            return { key, value: "stale-user-private" };
          }
          if (scope === "org" && key === "BUILDER_PRIVATE_KEY") {
            return { key, value: "org-private" };
          }
          if (scope === "org" && key === "BUILDER_PUBLIC_KEY") {
            return { key, value: "org-public" };
          }
          return null;
        },
      );
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
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

    it("resolveEngine routes to Builder when the user has Builder creds in app_secrets and no env-level keys", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "brent@example.com",
        getRequestOrgId: () => undefined,
      }));
      const readAppSecret = vi.fn(async ({ key }: { key: string }) => {
        if (key === "BUILDER_PRIVATE_KEY") {
          return { key, value: "p-key-from-app-secrets" };
        }
        if (key === "BUILDER_PUBLIC_KEY") {
          return { key, value: "space-from-app-secrets" };
        }
        return null;
      });
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
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

    it("does not treat Builder as usable from a stored engine when required keys only exist across mixed scopes", async () => {
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn().mockResolvedValue({
          engine: "builder",
          model: "m",
        }),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "member@example.com",
        getRequestOrgId: () => "builder_org",
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(
          async ({
            key,
            scope,
          }: {
            key: string;
            scope: "user" | "org" | "workspace";
          }) => {
            if (scope === "user" && key === "BUILDER_PRIVATE_KEY") {
              return { key, value: "stale-user-private" };
            }
            if (scope === "org" && key === "BUILDER_PUBLIC_KEY") {
              return { key, value: "org-public" };
            }
            return null;
          },
        ),
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const builderCreate = vi.fn().mockReturnValue({
        name: "builder",
        stream: vi.fn(),
      } as any);
      const anthropicEngine = { name: "anthropic", stream: vi.fn() } as any;
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
      expect(builderCreate).not.toHaveBeenCalled();
      expect(anthropicCreate).toHaveBeenCalled();
      expect(resolved).toBe(anthropicEngine);
    });

    it("resolveEngine prefers a usable stored provider over connected Builder", async () => {
      process.env.OPENAI_API_KEY = "sk-openai-provider"; // guard:allow-env-credential — fixture: stored BYOK provider should beat automatic Builder
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

      const resolved = await resolveEngine({ apiKey: "sk-openai-provider" });
      expect(openAiCreate).toHaveBeenCalledWith({
        apiKey: "sk-openai-provider",
        allowEnvFallback: true,
      });
      expect(builderCreate).not.toHaveBeenCalled();
      expect(resolved).toBe(openAiEngine);
    });

    it("resolveEngine skips a stored provider whose saved key has an auth-failure marker", async () => {
      const badOpenAiKey = "sk-example-invalid";
      const fingerprint = providerFailureFingerprint(
        "OPENAI_API_KEY",
        badOpenAiKey,
      );
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn(async (key: string) => {
          if (key === "agent-engine") {
            return { engine: "ai-sdk:openai", model: "gpt-5.4" };
          }
          if (key === `provider-auth-failure:${fingerprint}`) {
            return {
              fingerprint,
              key: "OPENAI_API_KEY",
              message: "401 status code (no body)",
              status: 401,
              at: Date.now(),
            };
          }
          return null;
        }),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "steve@example.com",
        getRequestOrgId: () => undefined,
      }));
      const readAppSecret = vi.fn(async ({ key }: { key: string }) => {
        if (key === "OPENAI_API_KEY") {
          return { key, value: badOpenAiKey };
        }
        if (key === "BUILDER_PRIVATE_KEY") {
          return { key, value: "p-key-from-app-secrets" };
        }
        if (key === "BUILDER_PUBLIC_KEY") {
          return { key, value: "space-from-app-secrets" };
        }
        return null;
      });
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
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

      const resolved = await resolveEngine({});
      expect(openAiCreate).not.toHaveBeenCalled();
      expect(builderCreate).toHaveBeenCalled();
      expect(resolved).toBe(builderEngine);
    });

    it("detectEngineFromUserSecrets skips auth-failed BYO keys before falling back to Builder", async () => {
      process.env.AGENT_ENGINE_PREFER_BYO_KEY = "true";
      const badOpenAiKey = "sk-example-invalid";
      const fingerprint = providerFailureFingerprint(
        "OPENAI_API_KEY",
        badOpenAiKey,
      );
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn(async (key: string) =>
          key === `provider-auth-failure:${fingerprint}`
            ? {
                fingerprint,
                key: "OPENAI_API_KEY",
                message: "401 status code (no body)",
                status: 401,
                at: Date.now(),
              }
            : null,
        ),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "steve@example.com",
        getRequestOrgId: () => undefined,
      }));
      const readAppSecret = vi.fn(async ({ key }: { key: string }) => {
        if (key === "OPENAI_API_KEY") {
          return { key, value: badOpenAiKey };
        }
        if (key === "BUILDER_PRIVATE_KEY") {
          return { key, value: "p-key-from-app-secrets" };
        }
        if (key === "BUILDER_PUBLIC_KEY") {
          return { key, value: "space-from-app-secrets" };
        }
        return null;
      });
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
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
        name: "ai-sdk:openai",
        label: "OpenAI",
        description: "",
        capabilities: {} as any,
        defaultModel: "gpt-5.4",
        supportedModels: [],
        requiredEnvVars: ["OPENAI_API_KEY"],
        create: vi.fn() as any,
      });

      const detected = await detectEngineFromUserSecrets();
      expect(detected?.name).toBe("builder");
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

    it("passes a scoped OpenAI-compatible endpoint into the OpenAI engine", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "steve@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) => {
          if (key === "OPENAI_BASE_URL") {
            return { key, value: "https://gateway.example/v1///" };
          }
          return null;
        }),
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
        allowEnvFallback: true,
        baseUrl: "https://gateway.example/v1",
      });
      expect(resolved).toBe(openAiEngine);
    });

    it("does not pass the scoped OpenAI endpoint into non-OpenAI engines", async () => {
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "steve@example.com",
        getRequestOrgId: () => undefined,
      }));
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret: vi.fn(async ({ key }: { key: string }) => {
          if (key === "OPENAI_BASE_URL") {
            return { key, value: "https://gateway.example/v1" };
          }
          return null;
        }),
      }));

      const { registerAgentEngine, resolveEngine } =
        await import("./registry.js");

      const googleEngine = { name: "ai-sdk:google", stream: vi.fn() } as any;
      const googleCreate = vi.fn().mockReturnValue(googleEngine);

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

      const resolved = await resolveEngine({ engineOption: "ai-sdk:google" });

      expect(googleCreate).toHaveBeenCalledWith({
        apiKey: undefined,
        allowEnvFallback: true,
      });
      expect(resolved).toBe(googleEngine);
    });

    it("auto-detects app-provided deploy-level provider env keys for signed-in production shared-database users", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.OPENAI_API_KEY = "sk-deploy"; // guard:allow-env-credential — fixture: app-provided LLM key should power this hosted app
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

      const openAiEngine = {
        name: "ai-sdk:openai",
        stream: vi.fn(),
      } as any;
      const openAiCreate = vi.fn().mockReturnValue(openAiEngine);
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

      expect(openAiCreate).toHaveBeenCalledWith({
        apiKey: undefined,
        allowEnvFallback: true,
      });
      expect(anthropicCreate).not.toHaveBeenCalled();
      expect(resolved).toBe(openAiEngine);
    });

    it("allows deploy env fallback for explicitly selected app-level LLM engines in signed-in production shared-database requests", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.OPENAI_API_KEY = "sk-deploy"; // guard:allow-env-credential — fixture: explicit app-level LLM engine selection can inherit hosted env
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
        allowEnvFallback: true,
      });
      expect(resolved).toBe(openAiEngine);
    });

    it("skips auth-failed deploy env keys during env auto-detect and falls back to Builder", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const badDeployKey = "sk-deploy-rejected";
      process.env.OPENAI_API_KEY = badDeployKey; // guard:allow-env-credential — fixture: rejected deploy key must not stick permanently
      const fingerprint = providerFailureFingerprint(
        "OPENAI_API_KEY",
        badDeployKey,
      );
      vi.doMock("../../settings/store.js", () => ({
        getSetting: vi.fn(async (key: string) =>
          key === `provider-auth-failure:${fingerprint}`
            ? {
                fingerprint,
                key: "OPENAI_API_KEY",
                message: "401 status code (no body)",
                status: 401,
                at: Date.now(),
              }
            : null,
        ),
        deleteSetting: vi.fn(),
      }));
      vi.doMock("../../server/request-context.js", () => ({
        getRequestUserEmail: () => "new@example.com",
        getRequestOrgId: () => "org-1",
      }));
      const readAppSecret = vi.fn(async ({ key }: { key: string }) => {
        if (key === "BUILDER_PRIVATE_KEY") {
          return { key, value: "p-key-from-app-secrets" };
        }
        if (key === "BUILDER_PUBLIC_KEY") {
          return { key, value: "space-from-app-secrets" };
        }
        return null;
      });
      vi.doMock("../../secrets/storage.js", () => ({
        readAppSecret,
        readAppSecrets: readAppSecretsFromSingles(readAppSecret),
      }));
      vi.doMock("../../db/client.js", () => ({
        isLocalDatabase: () => false,
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

      const resolved = await resolveEngine({});
      expect(openAiCreate).not.toHaveBeenCalled();
      expect(builderCreate).toHaveBeenCalled();
      expect(resolved).toBe(builderEngine);
    });
  });
});
