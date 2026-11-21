import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readAppSecretMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());
const getProviderCredentialAuthFailureMock = vi.hoisted(() => vi.fn());
const readOrgMemberRoleMock = vi.hoisted(() => vi.fn());
const requestContextState = vi.hoisted(() => ({
  synthetic: false,
  orgId: undefined as string | undefined,
  orgScope: undefined as "personal" | undefined,
  defaultAgentEngineScope: undefined as "deployment" | undefined,
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: readAppSecretMock,
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: getSettingMock,
}));

vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => {
    const context = {
      ...(requestContextState.synthetic ? { isSyntheticTraffic: true } : {}),
      ...(requestContextState.orgScope
        ? { orgScope: requestContextState.orgScope }
        : {}),
      ...(requestContextState.defaultAgentEngineScope
        ? {
            defaultAgentEngineScope:
              requestContextState.defaultAgentEngineScope,
          }
        : {}),
    };
    return Object.keys(context).length > 0 ? context : undefined;
  },
  getRequestOrgId: () => requestContextState.orgId,
  getRequestUserEmail: () => "owner@example.com",
}));

// With no request org the policy resolves the person's own org from the
// database; these specs run without one.
vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

vi.mock("../server/credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/credential-provider.js")
  >()),
  resolveSecretDetailed: vi.fn(async () => ({
    value: null,
    lookupFailed: false,
  })),
  prefetchSecrets: vi.fn(async () => {}),
  canUseDeployCredentialFallbackForRequest:
    canUseDeployCredentialFallbackForRequestMock,
  getProviderCredentialAuthFailure: getProviderCredentialAuthFailureMock,
  readDeployCredentialEnv: readDeployCredentialEnvMock,
}));

vi.mock(
  "../server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >()),
    readOrgMemberRole: readOrgMemberRoleMock,
  }),
);

import {
  getAgentEngineEntry,
  isResolvedEngineUsableForRequest,
  registerAgentEngine,
  unregisterAgentEngine,
  type AgentEngineEntry,
} from "./engine/registry.js";
import {
  getOwnerApiKey,
  getOwnerApiKeyForEngine,
  resolveChatEngine,
  resolveOwnerEngineApiKey,
} from "./production-agent.js";

vi.mock("./app-model-defaults.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./app-model-defaults.js")>()),
  getAgentAppModelDefaultForCurrentRequest: vi.fn(async () => null),
}));

function ownerSecrets(secrets: Record<string, string>) {
  readAppSecretMock.mockImplementation(async ({ key }: { key: string }) =>
    secrets[key] ? { value: secrets[key], last4: "-key", updatedAt: 1 } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ownerSecrets({});
  getSettingMock.mockResolvedValue(undefined);
  readDeployCredentialEnvMock.mockReturnValue(undefined);
  canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);
  getProviderCredentialAuthFailureMock.mockResolvedValue(null);
  requestContextState.synthetic = false;
  requestContextState.orgId = undefined;
  requestContextState.orgScope = undefined;
  requestContextState.defaultAgentEngineScope = undefined;
  readOrgMemberRoleMock.mockResolvedValue("member");
});

describe("getOwnerApiKey scope order", () => {
  it("runs an owner or admin on the org's key ahead of their own, and a member on theirs", async () => {
    requestContextState.orgId = "org-1";
    readAppSecretMock.mockImplementation(
      async ({ key, scope }: { key: string; scope: string }) =>
        key === "ANTHROPIC_API_KEY" && (scope === "user" || scope === "org")
          ? { value: `test-anthropic-${scope}`, last4: "-key", updatedAt: 1 }
          : null,
    );
    for (const [role, expected] of [
      ["owner", "test-anthropic-org"],
      ["admin", "test-anthropic-org"],
      ["member", "test-anthropic-user"],
    ] as const) {
      readOrgMemberRoleMock.mockResolvedValue(role);
      await expect(
        getOwnerApiKey("anthropic", "owner@example.com"),
      ).resolves.toBe(expected);
    }
    expect(readOrgMemberRoleMock).toHaveBeenCalledWith(
      "org-1",
      "owner@example.com",
    );
  });

  it("does not replace an unreadable owner-key lookup with a deployment key", async () => {
    readAppSecretMock.mockRejectedValue(new Error("secret store unavailable"));
    readDeployCredentialEnvMock.mockReturnValue("deploy-provider-key");
    const onLookupFailure = vi.fn();

    await expect(
      getOwnerApiKeyForEngine("ai-sdk:openai", "owner@example.com", {
        onLookupFailure,
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });

    expect(onLookupFailure).toHaveBeenCalledOnce();
    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });

  it("does not fall back to a legacy owner key after secret-store failure", async () => {
    readAppSecretMock.mockRejectedValue(new Error("secret store unavailable"));
    getSettingMock.mockResolvedValue({ key: "legacy-openai-owner-key" });
    const onLookupFailure = vi.fn();

    await expect(
      getOwnerApiKeyForEngine("ai-sdk:openai", "owner@example.com", {
        onLookupFailure,
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });

    expect(onLookupFailure).toHaveBeenCalledOnce();
    expect(getSettingMock).not.toHaveBeenCalled();
    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });

  it("can disable deployment-key fallback for a confirmed missing owner key", async () => {
    readDeployCredentialEnvMock.mockReturnValue("deploy-provider-key");

    await expect(
      getOwnerApiKeyForEngine("ai-sdk:openai", "owner@example.com", {
        allowDeploymentFallback: false,
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });

    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });
});

describe("saved owner credential engine selection", () => {
  const originalEntries: AgentEngineEntry[] = [];
  beforeEach(() => {
    for (const name of ["builder", "ai-sdk:openai", "anthropic"]) {
      const entry = getAgentEngineEntry(name);
      if (entry) originalEntries.push(entry);
      unregisterAgentEngine(name);
    }
  });
  afterEach(() => {
    unregisterAgentEngine("ai-sdk:openai");
    unregisterAgentEngine("anthropic");
    for (const entry of originalEntries.splice(0)) registerAgentEngine(entry);
    vi.unstubAllEnvs();
  });

  function setupLegacyCredential() {
    vi.stubEnv("AGENT_ENGINE", "");
    requestContextState.defaultAgentEngineScope = "deployment";
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === "agent-engine") return { engine: "ai-sdk:openai" };
      if (key === "user-api-key:openai:owner@example.com") {
        return { key: "fake-owner-key" };
      }
      return null;
    });
    const openaiEngine = { name: "ai-sdk:openai", stream: vi.fn() };
    const anthropicEngine = { name: "anthropic", stream: vi.fn() };
    const openaiCreate = vi.fn().mockReturnValue(openaiEngine);
    const anthropicCreate = vi.fn().mockReturnValue(anthropicEngine);
    const capabilities = {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    };
    registerAgentEngine({
      name: "ai-sdk:openai",
      label: "OpenAI",
      description: "",
      capabilities,
      defaultModel: "test",
      supportedModels: [],
      requiredEnvVars: ["OPENAI_API_KEY"],
      create: openaiCreate,
    });
    registerAgentEngine({
      name: "anthropic",
      label: "Anthropic",
      description: "",
      capabilities,
      defaultModel: "test",
      supportedModels: [],
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: anthropicCreate,
    });

    return {
      openaiEngine,
      anthropicEngine,
      openaiCreate,
      anthropicCreate,
      capabilities,
    };
  }

  it("selects the saved provider using its legacy owner credential", async () => {
    const { openaiEngine, openaiCreate, anthropicCreate } =
      setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    expect(ownerKey).toMatchObject({
      apiKey: "fake-owner-key",
      credentialProvenance: { scope: "user", source: "settings" },
    });
    const engine = await resolveChatEngine({
      ownerKey,
      credentialIdentity: { userEmail: "owner@example.com" },
    });
    expect(engine).toBe(openaiEngine);
    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "fake-owner-key" }),
    );
    expect(anthropicCreate).not.toHaveBeenCalled();
    await expect(
      isResolvedEngineUsableForRequest(engine, {
        apiKey: ownerKey.apiKey,
        apiKeyEnvVar: ownerKey.apiKeyEnvVar,
        apiKeyEngineBinding: ownerKey.apiKeyEngineBinding,
        apiKeyProvenance: ownerKey.credentialProvenance,
        credentialIdentity: { userEmail: "owner@example.com" },
      }),
    ).resolves.toBe(true);
  });

  it("does not apply or preflight the legacy key for another owner", async () => {
    const { openaiCreate, anthropicEngine, anthropicCreate } =
      setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    const identity = { userEmail: "other@example.com" };
    const engine = await resolveChatEngine({
      ownerKey,
      credentialIdentity: identity,
    });
    expect(engine).toBe(anthropicEngine);
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
    await expect(
      isResolvedEngineUsableForRequest(engine, {
        apiKey: ownerKey.apiKey,
        apiKeyEnvVar: ownerKey.apiKeyEnvVar,
        apiKeyEngineBinding: ownerKey.apiKeyEngineBinding,
        apiKeyProvenance: ownerKey.credentialProvenance,
        credentialIdentity: identity,
      }),
    ).resolves.toBe(false);
  });

  it("does not reuse the legacy key after the organization scope changes", async () => {
    const { openaiEngine, openaiCreate } = setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    requestContextState.orgId = "other-org";
    vi.stubEnv("AGENT_ENGINE", "ai-sdk:openai");
    const identity = { userEmail: "owner@example.com", orgId: "other-org" };
    const engine = await resolveChatEngine({
      ownerKey,
      credentialIdentity: identity,
    });
    expect(engine).toBe(openaiEngine);
    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
    await expect(
      isResolvedEngineUsableForRequest(engine, {
        apiKey: ownerKey.apiKey,
        apiKeyEnvVar: ownerKey.apiKeyEnvVar,
        apiKeyEngineBinding: ownerKey.apiKeyEngineBinding,
        apiKeyProvenance: ownerKey.credentialProvenance,
        credentialIdentity: identity,
      }),
    ).resolves.toBe(false);
  });

  it("does not send the legacy key to another provider", async () => {
    const { anthropicEngine, anthropicCreate } = setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    vi.stubEnv("AGENT_ENGINE", "anthropic");
    const engine = await resolveChatEngine({
      ownerKey,
      credentialIdentity: { userEmail: "owner@example.com" },
    });
    expect(engine).toBe(anthropicEngine);
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it("does not send the legacy key to a different engine for the same provider", async () => {
    const { capabilities } = setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    const otherEngine = { name: "other-openai", stream: vi.fn() };
    const otherCreate = vi.fn().mockReturnValue(otherEngine);
    registerAgentEngine({
      name: "other-openai",
      label: "Other",
      description: "",
      capabilities,
      defaultModel: "test",
      supportedModels: [],
      requiredEnvVars: ["OPENAI_API_KEY"],
      create: otherCreate,
    });
    vi.stubEnv("AGENT_ENGINE", "other-openai");
    try {
      const engine = await resolveChatEngine({
        ownerKey,
        credentialIdentity: { userEmail: "owner@example.com" },
      });
      expect(engine).toBe(otherEngine);
      expect(otherCreate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: undefined }),
      );
      await expect(
        isResolvedEngineUsableForRequest(engine, {
          apiKey: ownerKey.apiKey,
          apiKeyEnvVar: ownerKey.apiKeyEnvVar,
          apiKeyEngineBinding: ownerKey.apiKeyEngineBinding,
          apiKeyProvenance: ownerKey.credentialProvenance,
          credentialIdentity: { userEmail: "owner@example.com" },
        }),
      ).resolves.toBe(false);
    } finally {
      unregisterAgentEngine("other-openai");
    }
  });

  it("does not reuse a legacy key when the request becomes synthetic", async () => {
    const { openaiCreate, anthropicEngine, anthropicCreate } =
      setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    requestContextState.synthetic = true;
    const engine = await resolveChatEngine({
      ownerKey,
      credentialIdentity: { userEmail: "owner@example.com" },
    });
    expect(engine).toBe(anthropicEngine);
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it("does not use a legacy key rejected after owner resolution", async () => {
    const { openaiCreate, anthropicEngine, anthropicCreate } =
      setupLegacyCredential();
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: "owner@example.com",
    });
    getProviderCredentialAuthFailureMock.mockResolvedValue({ status: 401 });
    const engine = await resolveChatEngine({
      ownerKey,
      credentialIdentity: { userEmail: "owner@example.com" },
    });
    expect(engine).toBe(anthropicEngine);
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });
});

describe("resolveOwnerEngineApiKey", () => {
  it("resolves the named engine's own key rather than the active setting's", async () => {
    getSettingMock.mockResolvedValue({ engine: "anthropic" });
    ownerSecrets({
      ANTHROPIC_API_KEY: "test-anthropic-owner",
      OPENAI_API_KEY: "sk-openai-owner",
    });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "ai-sdk:openai",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({
      apiKey: "sk-openai-owner",
      apiKeyEnvVar: "OPENAI_API_KEY",
      credentialProvenance: {
        scope: "user",
        scopeId: "owner@example.com",
        source: "app_secrets",
      },
    });
  });

  it("never returns another provider's key for an engine the owner has no key for", async () => {
    getSettingMock.mockResolvedValue({ engine: "anthropic" });
    ownerSecrets({ ANTHROPIC_API_KEY: "test-anthropic-owner" });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "ai-sdk:openai",
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
  });

  it("reads the name out of an engine config object, not just a string", async () => {
    ownerSecrets({ OPENAI_API_KEY: "sk-openai-owner" });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: { name: "ai-sdk:openai", config: {} },
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toEqual({
      apiKey: "sk-openai-owner",
      apiKeyEnvVar: "OPENAI_API_KEY",
      credentialProvenance: {
        scope: "user",
        scopeId: "owner@example.com",
        source: "app_secrets",
      },
    });
  });

  it("preserves the active engine key's provenance when no engine is named", async () => {
    // The registry may select another engine, so the key must stay tagged for
    // provider matching while retaining the scope that owns its value.
    requestContextState.defaultAgentEngineScope = "deployment";
    getSettingMock.mockResolvedValue({ engine: "anthropic" });
    ownerSecrets({ ANTHROPIC_API_KEY: "test-anthropic-owner" });

    await expect(
      resolveOwnerEngineApiKey({ ownerEmail: "owner@example.com" }),
    ).resolves.toEqual({
      apiKey: "test-anthropic-owner",
      apiKeyEnvVar: undefined,
      credentialProvenance: {
        scope: "user",
        scopeId: "owner@example.com",
        source: "app_secrets",
      },
    });
  });

  it("uses the tagged host fallback when the active engine setting is unavailable", async () => {
    requestContextState.defaultAgentEngineScope = "deployment";
    getSettingMock.mockRejectedValue(new Error("settings unavailable"));

    await expect(
      resolveOwnerEngineApiKey({
        ownerEmail: "owner@example.com",
        anthropicFallback: "host-anthropic-key",
      }),
    ).resolves.toEqual({
      apiKey: "host-anthropic-key",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      credentialProvenance: { scope: "deployment", source: "env" },
    });
    expect(readAppSecretMock).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable active engine setting without a safe fallback", async () => {
    requestContextState.defaultAgentEngineScope = "deployment";
    const settingsError = new Error("settings unavailable");
    getSettingMock.mockRejectedValue(settingsError);

    await expect(
      resolveOwnerEngineApiKey({ ownerEmail: "owner@example.com" }),
    ).rejects.toMatchObject({
      errorCode: "agent_engine_settings_unavailable",
      cause: settingsError,
    });
  });

  it("does not read a personal key when the active engine scope is unresolved", async () => {
    ownerSecrets({ ANTHROPIC_API_KEY: "test-anthropic-owner" });

    await expect(
      resolveOwnerEngineApiKey({ ownerEmail: "owner@example.com" }),
    ).rejects.toMatchObject({
      errorCode: "agent_engine_settings_unavailable",
      cause: expect.objectContaining({
        message: "Organization scope could not be resolved.",
      }),
    });
    expect(readAppSecretMock).not.toHaveBeenCalled();
  });

  it("pairs an explicit OpenAI engine with the OpenAI deploy key", async () => {
    readDeployCredentialEnvMock.mockImplementation((key: string) =>
      key === "OPENAI_API_KEY" ? "sk-openai-deploy" : undefined,
    );

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "openai",
        ownerEmail: "owner@example.com",
        anthropicFallback: "test-anthropic-plugin-key",
      }),
    ).resolves.toEqual({
      apiKey: "sk-openai-deploy",
      apiKeyEnvVar: "OPENAI_API_KEY",
      credentialProvenance: { scope: "deployment", source: "env" },
    });
  });

  it("tags the host fallback so a non-Anthropic engine cannot receive it", async () => {
    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "openai",
        ownerEmail: "owner@example.com",
        anthropicFallback: "test-anthropic-plugin-key",
      }),
    ).resolves.toEqual({
      apiKey: "test-anthropic-plugin-key",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      credentialProvenance: { scope: "deployment", source: "env" },
    });
  });

  it("prefers a scoped owner key over the host fallback", async () => {
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    ownerSecrets({ ANTHROPIC_API_KEY: "scoped-owner-key" });

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "anthropic",
        ownerEmail: "owner@example.com",
        anthropicFallback: "plugin-api-key",
      }),
    ).resolves.toEqual({
      apiKey: "scoped-owner-key",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      credentialProvenance: {
        scope: "user",
        scopeId: "owner@example.com",
        source: "app_secrets",
      },
    });
  });

  it("does not use deploy-level fallback keys for guarded runs", async () => {
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    readDeployCredentialEnvMock.mockReturnValue("deploy-provider-key");

    await expect(
      resolveOwnerEngineApiKey({
        engineOption: "anthropic",
        ownerEmail: "owner@example.com",
        anthropicFallback: "plugin-api-key",
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });

  it("does not replace a rejected synthetic user key with a shared scope key", async () => {
    requestContextState.synthetic = true;
    requestContextState.orgId = "org-1";
    readAppSecretMock.mockImplementation(
      async ({ scope }: { scope: string }) => {
        if (scope === "user") {
          return { value: "sk-user-rejected", last4: "cted", updatedAt: 1 };
        }
        if (scope === "org") {
          return { value: "sk-shared", last4: "ared", updatedAt: 1 };
        }
        return null;
      },
    );
    getProviderCredentialAuthFailureMock.mockImplementation(
      async ({ value }: { value: string }) =>
        value === "sk-user-rejected" ? { status: 401 } : null,
    );

    await expect(getOwnerApiKey("openai", "owner@example.com")).resolves.toBe(
      undefined,
    );
    expect(readAppSecretMock).toHaveBeenCalledTimes(1);
    expect(readAppSecretMock).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      scope: "user",
      scopeId: "owner@example.com",
    });
  });
});
