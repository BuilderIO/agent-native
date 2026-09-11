import { beforeEach, describe, expect, it, vi } from "vitest";

const createEngine = vi.hoisted(() => vi.fn());
const resolveSecret = vi.hoisted(() => vi.fn());
const readDeployCredentialEnv = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequest = vi.hoisted(() => vi.fn());

vi.mock("../../agent/engine/index.js", () => ({
  getAgentEngineEntry: (name: string) =>
    name === "ai-sdk:openai"
      ? {
          name: "ai-sdk:openai",
          label: "OpenAI",
          description: "",
          capabilities: {},
          defaultModel: "gpt-5.5",
          supportedModels: ["gpt-5.5"],
          requiredEnvVars: ["OPENAI_API_KEY"],
          create: createEngine,
        }
      : undefined,
  registerBuiltinEngines: vi.fn(),
}));

vi.mock("../../server/credential-provider.js", () => ({
  canUseDeployCredentialFallbackForRequest: () =>
    canUseDeployCredentialFallbackForRequest(),
  readDeployCredentialEnv: (...args: unknown[]) =>
    readDeployCredentialEnv(...args),
  resolveSecret: (...args: unknown[]) => resolveSecret(...args),
}));

describe("test-agent-engine", () => {
  beforeEach(() => {
    createEngine.mockReset();
    resolveSecret.mockReset();
    readDeployCredentialEnv.mockReset();
    canUseDeployCredentialFallbackForRequest.mockReset();
    canUseDeployCredentialFallbackForRequest.mockReturnValue(true);
    resolveSecret.mockImplementation(async (key: string) => {
      if (key === "OPENAI_API_KEY") return "sk-request";
      if (key === "OPENAI_BASE_URL") return "https://gateway.example/v1///";
      return null;
    });
    createEngine.mockReturnValue({
      stream: async function* () {
        yield { type: "text-delta", text: "OK" };
        yield { type: "stop", reason: "stop" };
      },
    });
  });

  it("tests OpenAI with request-scoped key and endpoint settings", async () => {
    const { run } = await import("./test-agent-engine.js");

    const result = JSON.parse(
      await run({ engine: "ai-sdk:openai", model: "gpt-5.5" }),
    );

    expect(createEngine).toHaveBeenCalledWith({
      apiKey: "sk-request",
      allowEnvFallback: true,
      baseUrl: "https://gateway.example/v1",
    });
    expect(result.ok).toBe(true);
  });
});
