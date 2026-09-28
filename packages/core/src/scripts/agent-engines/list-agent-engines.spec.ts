import { describe, expect, it, beforeEach, vi } from "vitest";

describe("list-agent-engines", () => {
  let readAppSecrets: ReturnType<typeof vi.fn>;
  let readAppSecret: ReturnType<typeof vi.fn>;
  let userSettings: Map<string, Record<string, unknown>>;
  let orgSettings: Map<string, Record<string, unknown>>;
  let defaultSetting: {
    value: Record<string, unknown> | null;
    source: string;
  };
  let defaultAuthority: { allowed: boolean };

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.AGENT_ENGINE;
    delete process.env.AGENT_NATIVE_WORKSPACE;
    delete process.env.VITE_AGENT_NATIVE_WORKSPACE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.BUILDER_PRIVATE_KEY;
    delete process.env.BUILDER_PUBLIC_KEY;
    userSettings = new Map();
    orgSettings = new Map();
    vi.doMock("../../settings/index.js", () => ({
      getSetting: vi.fn().mockResolvedValue(null),
      getUserSetting: vi.fn(
        async (_email: string, key: string) => userSettings.get(key) ?? null,
      ),
      getOrgSetting: vi.fn(
        async (_orgId: string, key: string) => orgSettings.get(key) ?? null,
      ),
    }));
    vi.doMock("../../oauth-tokens/store.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../oauth-tokens/store.js")>()),
      getOAuthTokens: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("../../agent/app-model-defaults.js", () => ({
      getAgentAppModelDefaultForCurrentRequest: vi.fn().mockResolvedValue(null),
    }));
    defaultSetting = { value: null, source: "none" };
    defaultAuthority = { allowed: true };
    vi.doMock("../../agent/default-agent-engine.js", () => ({
      readDefaultAgentEngineSettingDetailed: vi.fn(async () => defaultSetting),
      resolveDefaultAgentEngineAuthority: vi.fn(async () => defaultAuthority),
    }));
    readAppSecrets = vi.fn().mockResolvedValue(new Map());
    readAppSecret = vi.fn().mockResolvedValue(null);
    vi.doMock("../../secrets/storage.js", () => ({
      readAppSecret: (...args: unknown[]) => readAppSecret(...args),
      readAppSecrets,
    }));
  });

  it("prefetches installed provider keys in one catalog batch", async () => {
    const { registerAgentEngine } = await import("../../agent/engine/index.js");
    const { runWithRequestContext } =
      await import("../../server/request-context.js");
    const { run } = await import("./list-agent-engines.js");

    registerAgentEngine({
      name: "test:openai",
      label: "OpenAI Test",
      description: "",
      capabilities: {} as any,
      defaultModel: "gpt-test",
      supportedModels: ["gpt-test"],
      requiredEnvVars: ["OPENAI_API_KEY"],
      create: vi.fn() as any,
    });
    registerAgentEngine({
      name: "test:anthropic",
      label: "Anthropic Test",
      description: "",
      capabilities: {} as any,
      defaultModel: "claude-test",
      supportedModels: ["claude-test"],
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: vi.fn() as any,
    });

    await runWithRequestContext(
      { userEmail: "catalog@example.com", orgId: "org-catalog" },
      () => run(),
    );

    expect(
      readAppSecrets.mock.calls.some(
        ([args]) =>
          args.keys.includes("OPENAI_API_KEY") &&
          args.keys.includes("ANTHROPIC_API_KEY"),
      ),
    ).toBe(true);
  });

  it("flags an engine whose saved key its provider rejected", async () => {
    const savedKey = "sk-ant-fake-placeholder";
    readAppSecret.mockImplementation(
      async (ref: { key: string; scope: string }) =>
        ref.key === "ANTHROPIC_API_KEY" && ref.scope === "user"
          ? { value: savedKey }
          : null,
    );
    const { providerCredentialFingerprint } =
      await import("../../server/credential-provider.js");
    const fingerprint = providerCredentialFingerprint(
      "ANTHROPIC_API_KEY",
      savedKey,
    );
    const marker = {
      fingerprint,
      key: "ANTHROPIC_API_KEY",
      status: 401,
      strikes: 1,
      // Past the retry window: the engine may retry, Settings still flags it.
      at: Date.now() - 60 * 60 * 1000,
    };
    vi.doMock("../../settings/store.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../settings/store.js")>()),
      getSetting: vi.fn(async (key: string) =>
        key === `provider-auth-failure:${fingerprint}` ? marker : null,
      ),
      getSettings: vi.fn(
        async (keys: string[]) =>
          new Map(
            keys.map((key) => [
              key,
              key === `provider-auth-failure:${fingerprint}` ? marker : null,
            ]),
          ),
      ),
    }));
    const { runWithRequestContext } =
      await import("../../server/request-context.js");
    const { run } = await import("./list-agent-engines.js");

    const result = JSON.parse(
      await runWithRequestContext(
        { userEmail: "rejected@example.com", orgId: "org-rejected" },
        () => run(),
      ),
    );
    const byName = (name: string) =>
      result.engines.find((engine: any) => engine.name === name);

    expect(byName("anthropic")).toMatchObject({
      credentialRejected: true,
      credentialRejectedAt: marker.at,
    });
    expect(byName("ai-sdk:openai")?.credentialRejected).toBe(false);
    expect(byName("builder")?.credentialRejected).toBe(false);
  });

  it("offers only the checked models, at the scope of the key in effect", async () => {
    readAppSecret.mockImplementation(
      async (ref: { key: string; scope: string }) =>
        ref.key === "ANTHROPIC_API_KEY" && ref.scope === "user"
          ? { value: "sk-ant-fake-placeholder" }
          : null,
    );
    userSettings.set("agent-provider-models:anthropic", {
      models: ["claude-opus-5-5"],
    });
    orgSettings.set("agent-provider-models:openai", { models: ["gpt-6-sol"] });
    const { getAgentEngineEntry } = await import("../../agent/engine/index.js");
    const { runWithRequestContext } =
      await import("../../server/request-context.js");
    const { run } = await import("./list-agent-engines.js");

    const result = JSON.parse(
      await runWithRequestContext(
        { userEmail: "member@example.com", orgId: "org-models" },
        () => run(),
      ),
    );
    const byName = (name: string) =>
      result.engines.find((engine: any) => engine.name === name);

    expect(byName("anthropic")).toMatchObject({
      supportedModels: ["claude-opus-5-5"],
      recommendedModels: getAgentEngineEntry("anthropic")?.supportedModels,
      modelSelection: { state: "selected", scope: "user" },
    });
    // No organization OpenAI key is saved, but its models still belong to the
    // organization, which is where an admin's key would go.
    expect(byName("ai-sdk:openai")).toMatchObject({
      supportedModels: ["gpt-6-sol"],
      modelSelection: { state: "selected", scope: "org" },
    });
    expect(byName("ai-sdk:google")?.modelSelection).toEqual({
      state: "default",
      scope: "org",
    });
    expect(result.current).toEqual({
      engine: "anthropic",
      model: "claude-opus-5-5",
    });
  });

  it("does not report AGENT_ENGINE as current when its optional package is missing", async () => {
    process.env.AGENT_ENGINE = "ai-sdk:missing-provider";
    const { registerAgentEngine } = await import("../../agent/engine/index.js");
    const { run } = await import("./list-agent-engines.js");

    registerAgentEngine({
      name: "ai-sdk:missing-provider",
      label: "Missing Provider",
      description: "",
      installPackage: "@agent-native/definitely-missing-ai-provider",
      capabilities: {} as any,
      defaultModel: "missing-model",
      supportedModels: ["missing-model"],
      requiredEnvVars: [],
      create: vi.fn() as any,
    });

    const result = JSON.parse(await run());

    expect(result.current).toBeNull();
    expect(
      result.engines.find(
        (engine: any) => engine.name === "ai-sdk:missing-provider",
      )?.packageInstalled,
    ).toBe(false);
  });

  it("pairs the fallback provider with its own default model", async () => {
    const { getAgentEngineEntry } = await import("../../agent/engine/index.js");
    const { run } = await import("./list-agent-engines.js");

    const result = JSON.parse(await run());

    expect(result.current).toEqual({
      engine: "anthropic",
      model: getAgentEngineEntry("anthropic")?.defaultModel,
    });
    expect(result.current.model).toMatch(/^claude-/);
  });

  it("reports the org default and whether the caller can change it", async () => {
    defaultSetting = {
      value: { engine: "ai-sdk:openrouter", model: "vendor/custom-model" },
      source: "org",
    };
    defaultAuthority = { allowed: false };
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-example");
    const { run } = await import("./list-agent-engines.js");

    const result = JSON.parse(await run());

    expect(result.current).toEqual({
      engine: "ai-sdk:openrouter",
      model: "vendor/custom-model",
    });
    expect(result.canUpdateDefault).toBe(false);
    expect(result.defaultSource).toBe("org");
  });

  it("reports that OpenRouter preserves custom model IDs", async () => {
    const { run } = await import("./list-agent-engines.js");

    const result = JSON.parse(await run());
    const openRouter = result.engines.find(
      (engine: any) => engine.name === "ai-sdk:openrouter",
    );

    expect(openRouter?.preserveCustomModels).toBe(true);
  });

  it("reports that provider selections accept custom model IDs", async () => {
    const { run } = await import("./list-agent-engines.js");

    const result = JSON.parse(await run());
    const anthropic = result.engines.find(
      (engine: any) => engine.name === "anthropic",
    );

    expect(anthropic?.acceptsCustomModels).toBe(true);
    expect(anthropic?.preserveCustomModels).toBe(false);
  });

  it("does not report AGENT_ENGINE as current when only blocked hosted deploy credentials exist", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("AGENT_ENGINE", "test:blocked-provider");
    vi.stubEnv("BLOCKED_PROVIDER_API_KEY", "blocked-provider-test-key");

    const { registerAgentEngine } = await import("../../agent/engine/index.js");
    const { runWithRequestContext } =
      await import("../../server/request-context.js");
    const { run } = await import("./list-agent-engines.js");

    registerAgentEngine({
      name: "test:blocked-provider",
      label: "Blocked Provider Test",
      description: "",
      capabilities: {} as any,
      defaultModel: "blocked-test-model",
      supportedModels: ["blocked-test-model"],
      requiredEnvVars: ["BLOCKED_PROVIDER_API_KEY"],
      create: vi.fn() as any,
    });

    const result = JSON.parse(
      await runWithRequestContext({ userEmail: "hosted@example.com" }, () =>
        run(),
      ),
    );

    expect(result.current).toBeNull();
  });

  it("does not auto-detect hosted deployment provider env as the current engine", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-example");

    const { registerAgentEngine } = await import("../../agent/engine/index.js");
    const { runWithRequestContext } =
      await import("../../server/request-context.js");
    const { run } = await import("./list-agent-engines.js");

    registerAgentEngine({
      name: "test:openai",
      label: "OpenAI Test",
      description: "",
      capabilities: {} as any,
      defaultModel: "gpt-test",
      supportedModels: ["gpt-test"],
      requiredEnvVars: ["OPENAI_API_KEY"],
      create: vi.fn() as any,
    });

    const result = JSON.parse(
      await runWithRequestContext({ userEmail: "hosted@example.com" }, () =>
        run(),
      ),
    );

    expect(result.current?.engine).toBe("anthropic");
  });
});
