import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  getAgentEngineEntry,
  registerAgentEngine,
  unregisterAgentEngine,
  type AgentEngineEntry,
} from "../agent/engine/registry.js";
import {
  invalidateAgentEngineStatusCache,
  memoizeAgentEngineStatus,
} from "./agent-engine-status-cache.js";
import type { AgentEngineStatusResponse } from "./core-routes-plugin.js";

const credentialMocks = vi.hoisted(() => ({
  builderReady: vi.fn<() => Promise<boolean>>(),
  builderCredentials: vi.fn<() => Promise<any>>(),
  legacyBuilderKey: vi.fn<() => Promise<string | null>>(),
  resolveSecret: vi.fn<(key: string) => Promise<any>>(),
  authFailure:
    vi.fn<
      (args: {
        key: string;
        value: string;
        throwOnReadError?: boolean;
      }) => Promise<unknown>
    >(),
}));

vi.mock("./credential-provider.js", () => ({
  assertCredentialStoreReadable: vi.fn(),
  getProviderCredentialAuthFailure: (args: {
    key: string;
    value: string;
    throwOnReadError?: boolean;
  }) => credentialMocks.authFailure(args),
  prefetchSecrets: vi.fn(async () => undefined),
  resolveBuilderGatewayCredentialsDetailed: () =>
    credentialMocks.builderCredentials(),
  resolveBuilderPrivateKey: () => credentialMocks.legacyBuilderKey(),
  resolveSecretDetailed: (key: string) => credentialMocks.resolveSecret(key),
}));

vi.mock("./builder-oauth.js", () => ({
  hasUsableBuilderOAuthSessionForReadiness: () =>
    credentialMocks.builderReady(),
}));

vi.mock("./request-context.js", () => ({
  getRequestOrgId: () => "test-org",
  getRequestUserEmail: () => "steve@example.com",
}));

import {
  AGENT_CHAT_AI_SETUP_REQUIRED_CODE,
  isBuilderChatSetupReady,
  isAgentChatAiSetupReady,
  isAgentChatAiSetupRequiredError,
  queuedMessagesNeedAgentChatAiSetup,
  requireAgentChatAiSetup,
} from "./agent-chat-ai-setup.js";

describe("isBuilderChatSetupReady", () => {
  it.each([
    ["usable OAuth", { oauthSessionUsable: true }, true],
    ["Builder key pair", { privateKey: "private", publicKey: "public" }, true],
    ["legacy Builder private key", { legacyPrivateKey: "private" }, true],
    ["incomplete Builder key pair", { privateKey: "private" }, false],
    ["blank legacy key", { legacyPrivateKey: "   " }, false],
  ])("accepts %s consistently", (_label, input, expected) => {
    expect(isBuilderChatSetupReady(input)).toBe(expected);
  });
});

const testStatusEngineEntries: AgentEngineEntry[] = [
  {
    name: "builder",
    label: "Builder",
    description: "Test Builder engine",
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    defaultModel: "builder-test-model",
    supportedModels: ["builder-test-model"],
    requiredEnvVars: [],
    create: () => {
      throw new Error("The readiness test never creates an engine");
    },
  },
  {
    name: "ai-sdk:openai",
    label: "OpenAI",
    description: "Test OpenAI engine",
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    defaultModel: "openai-test-model",
    supportedModels: ["openai-test-model"],
    requiredEnvVars: ["OPENAI_API_KEY"],
    create: () => {
      throw new Error("The readiness test never creates an engine");
    },
  },
  {
    name: "chatgpt-subscription",
    label: "ChatGPT subscription",
    description: "Test subscription engine",
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    defaultModel: "subscription-test-model",
    supportedModels: ["subscription-test-model"],
    requiredEnvVars: [],
    create: () => {
      throw new Error("The readiness test never creates an engine");
    },
  },
];

describe("Agent-Native chat AI setup gate", () => {
  beforeEach(() => {
    invalidateAgentEngineStatusCache();
    for (const entry of testStatusEngineEntries) registerAgentEngine(entry);
    credentialMocks.builderReady.mockResolvedValue(false);
    credentialMocks.builderCredentials.mockResolvedValue({
      privateKey: null,
      publicKey: null,
      lookupFailed: false,
    });
    credentialMocks.legacyBuilderKey.mockResolvedValue(null);
    credentialMocks.resolveSecret.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    credentialMocks.authFailure.mockResolvedValue(null);
  });

  afterEach(() => {
    invalidateAgentEngineStatusCache();
    for (const entry of testStatusEngineEntries)
      unregisterAgentEngine(entry.name);
    vi.clearAllMocks();
  });

  it("rejects chat without Builder or a scoped provider API key", async () => {
    await expect(requireAgentChatAiSetup()).rejects.toMatchObject({
      statusCode: 403,
      data: { code: AGENT_CHAT_AI_SETUP_REQUIRED_CODE },
    });
    const refusal = await requireAgentChatAiSetup().catch(
      (error: unknown) => error,
    );
    expect(isAgentChatAiSetupRequiredError(refusal)).toBe(true);
    expect(isAgentChatAiSetupRequiredError(new Error("other"))).toBe(false);
  });

  it("accepts a usable saved Builder OAuth credential", async () => {
    credentialMocks.builderReady.mockResolvedValue(true);

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
    expect(credentialMocks.resolveSecret).not.toHaveBeenCalled();
  });

  it("accepts the legacy Builder private key used by the status route", async () => {
    credentialMocks.legacyBuilderKey.mockResolvedValue("legacy-builder-key");

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
  });

  it("rechecks credentials instead of trusting the status route memo for dispatch", async () => {
    await memoizeAgentEngineStatus(
      { userEmail: "steve@example.com", orgId: "test-org" },
      async () => ({ chatEligible: true }),
    );

    await expect(requireAgentChatAiSetup()).rejects.toMatchObject({
      statusCode: 403,
      data: { code: AGENT_CHAT_AI_SETUP_REQUIRED_CODE },
    });
    expect(credentialMocks.builderReady).toHaveBeenCalledOnce();
    expect(credentialMocks.resolveSecret).toHaveBeenCalled();
  });

  it("reports provider rejection marker read failures as unavailable", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "provider-key", source: "user", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );
    credentialMocks.authFailure.mockRejectedValueOnce(
      new Error("settings store unavailable"),
    );

    await expect(isAgentChatAiSetupReady()).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Could not read saved AI connections. Try again shortly.",
    });
  });

  it("keeps a usable provider when another provider rejection marker is unreadable", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) => {
      if (key === "OPENAI_API_KEY") {
        return { value: "sk-openai-key", source: "user", lookupFailed: false };
      }
      if (key === "ANTHROPIC_API_KEY") {
        return {
          value: "sk-anthropic-key",
          source: "org",
          lookupFailed: false,
        };
      }
      return { value: null, lookupFailed: false };
    });
    credentialMocks.authFailure.mockImplementation(async ({ key }) => {
      if (key === "OPENAI_API_KEY") {
        throw new Error("settings store unavailable");
      }
      return null;
    });

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
    expect(credentialMocks.authFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "OPENAI_API_KEY",
        throwOnReadError: true,
      }),
    );
    expect(credentialMocks.authFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "ANTHROPIC_API_KEY",
        throwOnReadError: true,
      }),
    );
  });

  it.each([
    ["Builder OAuth", "builder", true],
    ["Builder keys", "builder", true],
    ["BYOK", "ai-sdk:openai", true],
    ["ChatGPT subscription only", "chatgpt-subscription", false],
  ] as const)(
    "uses the shared eligibility policy for %s status (%s)",
    async (_label, engine, expected) => {
      const entry = getAgentEngineEntry(engine);
      if (!entry) throw new Error(`Test engine ${engine} is not registered`);
      if (engine === "ai-sdk:openai") {
        credentialMocks.resolveSecret.mockImplementation(async (key) =>
          key === "OPENAI_API_KEY"
            ? { value: "sk-test-key", source: "user", lookupFailed: false }
            : { value: null, lookupFailed: false },
        );
      }
      const result = await isAgentChatAiSetupReady({
        status: { configured: true, engine },
        detectFromUserSecrets: async () => null,
      });
      expect(result).toBe(expected);
    },
  );

  it("validates rejection markers before trusting a configured provider status", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "sk-rejected-key", source: "user", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );
    credentialMocks.authFailure.mockResolvedValue({ status: 401 });

    await expect(
      isAgentChatAiSetupReady({
        status: { configured: true, engine: "ai-sdk:openai" },
        detectFromUserSecrets: async () => null,
      }),
    ).resolves.toBe(false);
    expect(credentialMocks.authFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "OPENAI_API_KEY",
        value: "sk-rejected-key",
        throwOnReadError: true,
      }),
    );
  });

  it("returns unavailable when a configured provider status has an unreadable rejection marker", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "sk-test-key", source: "user", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );
    credentialMocks.authFailure.mockRejectedValueOnce(
      new Error("settings store unavailable"),
    );

    await expect(
      isAgentChatAiSetupReady({
        status: { configured: true, engine: "ai-sdk:openai" },
        detectFromUserSecrets: async () => null,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Could not read saved AI connections. Try again shortly.",
    });
  });

  it("accepts another usable saved provider when the configured provider marker is unreadable", async () => {
    const otherProvider: AgentEngineEntry = {
      name: "ai-sdk:anthropic",
      label: "Anthropic",
      description: "Test Anthropic engine",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "anthropic-test-model",
      supportedModels: ["anthropic-test-model"],
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: () => {
        throw new Error("The readiness test never creates an engine");
      },
    };
    credentialMocks.resolveSecret.mockImplementation(async (key: string) => {
      if (key === "OPENAI_API_KEY") {
        return { value: "sk-openai-key", source: "user", lookupFailed: false };
      }
      if (key === "ANTHROPIC_API_KEY") {
        return {
          value: "sk-anthropic-key",
          source: "org",
          lookupFailed: false,
        };
      }
      return { value: null, lookupFailed: false };
    });
    credentialMocks.authFailure.mockImplementation(async ({ key }) => {
      if (key === "OPENAI_API_KEY") {
        throw new Error("settings store unavailable");
      }
      return null;
    });

    await expect(
      isAgentChatAiSetupReady({
        status: { configured: true, engine: "ai-sdk:openai" },
        detectFromUserSecrets: async () => otherProvider,
      }),
    ).resolves.toBe(true);
    expect(credentialMocks.authFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "OPENAI_API_KEY",
        throwOnReadError: true,
      }),
    );
    expect(credentialMocks.authFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "ANTHROPIC_API_KEY",
        throwOnReadError: true,
      }),
    );
  });

  it.each([
    ["OpenAI-compatible endpoint", "OPENAI_BASE_URL"],
    ["Ollama endpoint", "OLLAMA_BASE_URL"],
  ] as const)(
    "accepts the shared status policy for a %s",
    async (_label, key) => {
      credentialMocks.resolveSecret.mockImplementation(async (candidate) =>
        candidate === key
          ? {
              value:
                key === "OLLAMA_BASE_URL"
                  ? "http://localhost:11434"
                  : "https://ai-gateway.example/v1",
              source: "user",
              lookupFailed: false,
            }
          : { value: null, lookupFailed: false },
      );
      const result = await isAgentChatAiSetupReady({
        status: {
          configured: false,
          ...(key === "OPENAI_BASE_URL"
            ? { openAiBaseUrlConfigured: true }
            : {}),
        },
        detectFromUserSecrets: async () => null,
      });
      expect(result).toBe(true);
    },
  );

  it("does not accept an engine when setup detection rejects its key", async () => {
    const rejected = getAgentEngineEntry("ai-sdk:openai");
    expect(rejected).toBeDefined();
    await expect(
      isAgentChatAiSetupReady({
        status: { configured: false },
        detectFromUserSecrets: async () => null,
      }),
    ).resolves.toBe(false);
  });

  it.each(["user", "org", "workspace"] as const)(
    "accepts recognized provider API keys from the %s scope",
    async (source) => {
      credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
        key === "OPENAI_API_KEY"
          ? { value: "sk-test-key", source, lookupFailed: false }
          : { value: null, lookupFailed: false },
      );

      await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
      expect(credentialMocks.authFailure).toHaveBeenCalledWith({
        key: "OPENAI_API_KEY",
        value: "sk-test-key",
        throwOnReadError: true,
      });
    },
  );

  it("accepts a locally allowed provider key from the resolver", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "site-key", source: "env", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
  });

  it("does not accept a hosted deploy provider key hidden by the resolver", async () => {
    credentialMocks.resolveSecret.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });

    await expect(isAgentChatAiSetupReady()).resolves.toBe(false);
  });

  it.each([
    ["OPENAI_BASE_URL", "user"],
    ["OLLAMA_BASE_URL", "workspace"],
    ["OLLAMA_BASE_URL", "env"],
  ] as const)(
    "accepts a configured custom endpoint without requiring a provider key (%s from %s)",
    async (endpointKey, source) => {
      credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
        key === endpointKey
          ? {
              value:
                endpointKey === "OLLAMA_BASE_URL"
                  ? "http://localhost:11434"
                  : "https://ai-gateway.example/v1",
              source,
              lookupFailed: false,
            }
          : { value: null, lookupFailed: false },
      );

      await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
      expect(credentialMocks.authFailure).not.toHaveBeenCalled();
    },
  );

  it("surfaces an unreadable custom endpoint store", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OLLAMA_BASE_URL"
        ? { value: null, lookupFailed: true }
        : { value: null, lookupFailed: false },
    );

    await expect(isAgentChatAiSetupReady()).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("allows a local endpoint when its recognized OpenAI API key is usable", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "sk-local-key", source: "user", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
  });

  it("does not treat an engine label without a saved endpoint as AI setup", async () => {
    await expect(isAgentChatAiSetupReady()).resolves.toBe(false);
    expect(
      credentialMocks.resolveSecret.mock.calls.map(([key]) => key),
    ).toEqual([
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "OPENROUTER_API_KEY",
      "GROQ_API_KEY",
      "MISTRAL_API_KEY",
      "COHERE_API_KEY",
      "OPENAI_BASE_URL",
      "OLLAMA_BASE_URL",
    ]);
  });

  it("does not accept a provider key marked as rejected", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? {
            value: "sk-test-rejected",
            source: "user",
            lookupFailed: false,
          }
        : { value: null, lookupFailed: false },
    );
    credentialMocks.authFailure.mockResolvedValue({ status: 401 });

    await expect(isAgentChatAiSetupReady()).resolves.toBe(false);
  });

  it("surfaces unreadable credential stores instead of claiming no setup", async () => {
    credentialMocks.resolveSecret.mockResolvedValue({
      value: null,
      lookupFailed: true,
      cause: new Error("credential store unavailable"),
    });

    await expect(isAgentChatAiSetupReady()).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("allows queue deletions but gates additions, edits, and reordering", () => {
    const existing = JSON.stringify({
      queuedMessages: [
        { id: "first", text: "one" },
        { id: "second", text: "two" },
      ],
    });

    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "second", text: "two" },
      ]),
    ).toBe(false);
    expect(queuedMessagesNeedAgentChatAiSetup(existing, [])).toBe(false);
    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "third", text: "three" },
      ]),
    ).toBe(true);
    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "first", text: "edited" },
      ]),
    ).toBe(true);
    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "second", text: "two" },
        { id: "first", text: "one" },
      ]),
    ).toBe(true);
  });

  it("exposes strict chat eligibility on the engine status response", () => {
    expectTypeOf<
      AgentEngineStatusResponse["chatEligible"]
    >().toEqualTypeOf<boolean>();
  });
});
