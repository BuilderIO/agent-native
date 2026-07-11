import { describe, expect, it, beforeEach, vi } from "vitest";

describe("list-agent-engines", () => {
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
    vi.doMock("../../settings/index.js", () => ({
      getSetting: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("../../agent/app-model-defaults.js", () => ({
      getAgentAppModelDefaultForCurrentRequest: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("../../secrets/storage.js", () => ({
      readAppSecret: vi.fn().mockResolvedValue(null),
    }));
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

  it("auto-detects hosted app-provided provider env as the current engine", async () => {
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

    expect(result.current?.engine).toBe("test:openai");
    expect(result.current?.model).toBe("gpt-test");
  });

  it("reports the sticky hosted experiment model as the visible default", async () => {
    vi.stubEnv("BUILDER_PRIVATE_KEY", "builder-private-example");
    vi.stubEnv("BUILDER_PUBLIC_KEY", "builder-public-example");
    vi.stubEnv("URL", "https://chat.agent-native.com");

    const { hostedDefaultModelExperimentBucket } =
      await import("../../observability/hosted-model-experiment.js");
    const { runWithRequestContext } =
      await import("../../server/request-context.js");
    const { run } = await import("./list-agent-engines.js");
    let treatmentUser = "";
    for (let index = 0; index < 100; index++) {
      const user = `hosted-${index}@example.test`;
      if (hostedDefaultModelExperimentBucket(user) < 20) {
        treatmentUser = user;
        break;
      }
    }

    const result = JSON.parse(
      await runWithRequestContext({ userEmail: treatmentUser }, () => run()),
    );

    expect(result.current).toMatchObject({
      engine: "builder",
      model: "gpt-5-6-luna",
      modelSelectionSource: "experiment",
      experimentAssignment: {
        variantId: "gpt-5-6-luna",
      },
    });
  });
});
