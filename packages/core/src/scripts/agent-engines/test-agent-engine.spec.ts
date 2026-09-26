import { beforeEach, describe, expect, it, vi } from "vitest";

const createEngine = vi.hoisted(() => vi.fn());
const createProviderEndpointFetch = vi.hoisted(() => vi.fn(() => vi.fn()));
const resolveSecretDetailed = vi.hoisted(() => vi.fn());
const readDeployCredentialEnv = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequest = vi.hoisted(() => vi.fn());
const isTrustedSelfHostedRuntime = vi.hoisted(() => vi.fn(() => false));
const isLocalNetworkOllamaEndpoint = vi.hoisted(() => vi.fn(() => true));

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
      : name === "ai-sdk:ollama"
        ? {
            name: "ai-sdk:ollama",
            label: "Ollama",
            description: "",
            capabilities: {},
            defaultModel: "llama3",
            supportedModels: ["llama3"],
            requiredEnvVars: [],
            create: createEngine,
          }
        : undefined,
  registerBuiltinEngines: vi.fn(),
}));

vi.mock("../../agent/engine/ai-sdk-engine.js", () => ({
  createProviderEndpointFetch: (...args: unknown[]) =>
    createProviderEndpointFetch(...args),
}));

vi.mock("../../server/credential-provider.js", () => ({
  assertCredentialStoreReadable: vi.fn(),
  canUseDeployCredentialFallbackForRequest: () =>
    canUseDeployCredentialFallbackForRequest(),
  readDeployCredentialEnv: (...args: unknown[]) =>
    readDeployCredentialEnv(...args),
  resolveSecretDetailed: (...args: unknown[]) => resolveSecretDetailed(...args),
  isTrustedSelfHostedRuntime: () => isTrustedSelfHostedRuntime(),
}));

vi.mock("../../server/request-context.js", () => ({
  getRequestUserEmail: () => "member@example.test",
}));

vi.mock("../../agent/engine/provider-endpoint-validation.js", () => ({
  isLocalNetworkOllamaEndpoint: () => isLocalNetworkOllamaEndpoint(),
  validateProviderBaseUrl: async (value: string) => value.replace(/\/+$/, ""),
}));

vi.mock("../../extensions/url-safety.js", () => ({
  isBlockedExtensionUrlWithDns: async () => false,
}));

describe("test-agent-engine", () => {
  beforeEach(() => {
    createEngine.mockReset();
    createProviderEndpointFetch.mockClear();
    resolveSecretDetailed.mockReset();
    readDeployCredentialEnv.mockReset();
    canUseDeployCredentialFallbackForRequest.mockReset();
    canUseDeployCredentialFallbackForRequest.mockReturnValue(true);
    isTrustedSelfHostedRuntime.mockReturnValue(false);
    isLocalNetworkOllamaEndpoint.mockReturnValue(true);
    resolveSecretDetailed.mockImplementation(async (key: string) => {
      if (key === "OPENAI_API_KEY") {
        return {
          value: "sk-request",
          lookupFailed: false,
          source: "user",
          scopeId: "member@example.test",
        };
      }
      if (key === "OPENAI_BASE_URL") {
        return {
          value: "https://gateway.example/v1///",
          lookupFailed: false,
          source: "user",
          scopeId: "member@example.test",
        };
      }
      return { value: null, lookupFailed: false };
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
      allowEnvFallback: false,
      baseUrl: "https://gateway.example/v1",
      requestFetch: expect.any(Function),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a shared key for a member-supplied endpoint before engine creation", async () => {
    resolveSecretDetailed.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? {
            value: "org-key",
            lookupFailed: false,
            source: "org",
            scopeId: "org-1",
          }
        : { value: null, lookupFailed: false },
    );

    const { run } = await import("./test-agent-engine.js");
    const result = JSON.parse(
      await run({
        engine: "ai-sdk:openai",
        baseUrl: "https://member-gateway.example/v1",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAI_API_KEY.*user-controlled endpoint/i);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("rejects deployment fallback for a member-owned saved endpoint", async () => {
    resolveSecretDetailed.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? {
            value: "deploy-key",
            lookupFailed: false,
            source: "env",
          }
        : {
            value: "https://member-gateway.example/v1",
            lookupFailed: false,
            source: "user",
            scopeId: "member@example.test",
          },
    );

    const { run } = await import("./test-agent-engine.js");
    const result = JSON.parse(await run({ engine: "ai-sdk:openai" }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAI_API_KEY.*user-controlled endpoint/i);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it.each([
    { trusted: false, allowedOrigins: [] },
    {
      trusted: true,
      allowedOrigins: ["http://127.0.0.1:11434"],
    },
  ])(
    "guards the default Ollama endpoint with private access trusted=$trusted",
    async ({ trusted, allowedOrigins }) => {
      isTrustedSelfHostedRuntime.mockReturnValue(trusted);

      const { run } = await import("./test-agent-engine.js");
      const result = JSON.parse(await run({ engine: "ai-sdk:ollama" }));

      expect(result.ok).toBe(true);
      expect(createProviderEndpointFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:11434",
        allowedOrigins,
      );
      expect(createEngine).toHaveBeenCalledWith(
        expect.objectContaining({ requestFetch: expect.any(Function) }),
      );
    },
  );
});
