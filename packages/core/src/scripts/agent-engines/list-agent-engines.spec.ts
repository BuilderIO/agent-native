import { describe, expect, it, beforeEach, vi } from "vitest";

describe("list-agent-engines", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.AGENT_ENGINE;
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
});
