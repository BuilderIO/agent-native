import { beforeEach, describe, expect, it, vi } from "vitest";

const putSetting = vi.hoisted(() => vi.fn());
const isStoredEngineUsableForRequest = vi.hoisted(() => vi.fn());

vi.mock("../../settings/index.js", () => ({
  putSetting: (...args: unknown[]) => putSetting(...args),
}));

vi.mock("../../agent/engine/index.js", () => {
  const entry = {
    name: "ai-sdk:openai",
    label: "OpenAI",
    description: "",
    capabilities: {},
    defaultModel: "gpt-5.5",
    supportedModels: ["gpt-5.5"],
    requiredEnvVars: ["OPENAI_API_KEY"],
    create: vi.fn(),
  };
  return {
    listAgentEngines: () => [entry],
    getAgentEngineEntry: (name: string) =>
      name === "ai-sdk:openai" ? entry : undefined,
    isAgentEnginePackageInstalled: () => true,
    isStoredEngineUsableForRequest: (...args: unknown[]) =>
      isStoredEngineUsableForRequest(...args),
    normalizeModelForEngine: (_entry: unknown, model: string) => model,
    registerBuiltinEngines: vi.fn(),
  };
});

describe("set-agent-engine", () => {
  beforeEach(() => {
    putSetting.mockReset();
    isStoredEngineUsableForRequest.mockReset();
  });

  it("accepts request-scoped credentials instead of requiring process env", async () => {
    isStoredEngineUsableForRequest.mockResolvedValue(true);

    const { run } = await import("./set-agent-engine.js");
    const result = JSON.parse(
      await run({ engine: "ai-sdk:openai", model: "gpt-5.5" }),
    );

    expect(isStoredEngineUsableForRequest).toHaveBeenCalledWith(
      { engine: "ai-sdk:openai" },
      expect.objectContaining({ requiredEnvVars: ["OPENAI_API_KEY"] }),
    );
    expect(putSetting).toHaveBeenCalledWith("agent-engine", {
      engine: "ai-sdk:openai",
      model: "gpt-5.5",
    });
    expect(result.ok).toBe(true);
  });

  it("warns when required credentials are unreachable for the request", async () => {
    isStoredEngineUsableForRequest.mockResolvedValue(false);

    const { run } = await import("./set-agent-engine.js");
    const result = await run({ engine: "ai-sdk:openai", model: "gpt-5.5" });

    expect(putSetting).not.toHaveBeenCalled();
    expect(result).toContain("OPENAI_API_KEY");
  });
});
