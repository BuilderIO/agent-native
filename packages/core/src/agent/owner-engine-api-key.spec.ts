import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppSecretMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());
const getProviderCredentialAuthFailureMock = vi.hoisted(() => vi.fn());
const readOrgMemberRoleMock = vi.hoisted(() => vi.fn());
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());
const requestContextState = vi.hoisted(() => ({
  synthetic: false,
  orgId: undefined as string | undefined,
  orgScope: undefined as "personal" | undefined,
  defaultAgentEngineScope: undefined as "deployment" | undefined,
  userEmail: undefined as string | undefined,
  credentialScope: undefined as "org" | undefined,
  assurance: undefined as "user" | "organization" | "org-member" | undefined,
}));

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
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
      ...(requestContextState.userEmail
        ? { userEmail: requestContextState.userEmail }
        : {}),
      ...(requestContextState.credentialScope
        ? { credentialScope: requestContextState.credentialScope }
        : {}),
      ...(requestContextState.assurance
        ? { a2aIdentityAssurance: requestContextState.assurance }
        : {}),
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

vi.mock("../server/credential-provider.js", () => ({
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
    isPersonalProviderKeyUseRestricted: vi.fn(async () => false),
  }),
);

import { isPersonalProviderKeyUseRestricted } from "../server/personal-provider-key-policy.js";
import {
  getOwnerApiKey,
  getOwnerApiKeyForEngine,
  resolveOwnerEngineApiKey,
} from "./production-agent.js";

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
  requestContextState.userEmail = undefined;
  requestContextState.credentialScope = undefined;
  requestContextState.assurance = undefined;
  readOrgMemberRoleMock.mockResolvedValue("member");
  resolveOrgIdForEmailMock.mockResolvedValue("org-1");
  vi.mocked(isPersonalProviderKeyUseRestricted).mockResolvedValue(false);
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

  it.each(["org-only", "delegated member", "delegated organization"])(
    "does not read personal stores for %s identity checks",
    async (scenario) => {
      requestContextState.orgId = "org-1";
      requestContextState.userEmail = "owner@example.com";
      requestContextState.credentialScope =
        scenario === "org-only" ? "org" : undefined;
      requestContextState.assurance =
        scenario === "delegated member"
          ? "org-member"
          : scenario === "delegated organization"
            ? "organization"
            : undefined;
      await getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-unrecognized",
      });
      expect(
        readAppSecretMock.mock.calls.every(
          ([ref]) => ref.scope !== "user" && !ref.scopeId.startsWith("solo:"),
        ),
      ).toBe(true);
      expect(getSettingMock).not.toHaveBeenCalled();
    },
  );

  it.each(["org-only", "delegated member", "delegated organization"])(
    "marks unverified credential identity incomplete for %s",
    async (scenario) => {
      requestContextState.orgId = "org-1";
      requestContextState.userEmail = "owner@example.com";
      requestContextState.credentialScope =
        scenario === "org-only" ? "org" : undefined;
      requestContextState.assurance =
        scenario === "delegated member"
          ? "org-member"
          : scenario === "delegated organization"
            ? "organization"
            : undefined;
      const onIdentityIncomplete = vi.fn();
      await getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-unrecognized",
        onIdentityIncomplete,
      });
      expect(onIdentityIncomplete).toHaveBeenCalledOnce();
    },
  );

  it.each(["org-only", "delegated member", "delegated organization"])(
    "retains authorized org credentials without reading personal stores for %s",
    async (scenario) => {
      requestContextState.orgId = "org-1";
      requestContextState.userEmail = "owner@example.com";
      requestContextState.credentialScope =
        scenario === "org-only" ? "org" : undefined;
      requestContextState.assurance =
        scenario === "delegated member"
          ? "org-member"
          : scenario === "delegated organization"
            ? "organization"
            : undefined;
      readAppSecretMock.mockImplementation(
        async ({ scope, scopeId }: { scope: string; scopeId: string }) =>
          scope === "org" && scopeId === "org-1"
            ? { value: "test-org-key" }
            : null,
      );
      const onIdentityIncomplete = vi.fn();
      await expect(
        getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
          matchApiKey: "test-org-key",
          onIdentityIncomplete,
        }),
      ).resolves.toMatchObject({
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        credentialProvenance: { scope: "org", scopeId: "org-1" },
      });
      expect(onIdentityIncomplete).toHaveBeenCalledOnce();
      expect(
        readAppSecretMock.mock.calls.every(
          ([ref]) => ref.scope !== "user" && !ref.scopeId.startsWith("solo:"),
        ),
      ).toBe(true);
      expect(getSettingMock).not.toHaveBeenCalled();
      readAppSecretMock.mockClear();
      await expect(
        getOwnerApiKey("anthropic", "owner@example.com"),
      ).resolves.toBe("test-org-key");
      expect(
        readAppSecretMock.mock.calls.every(
          ([ref]) => ref.scope !== "user" && !ref.scopeId.startsWith("solo:"),
        ),
      ).toBe(true);
      expect(getSettingMock).not.toHaveBeenCalled();
    },
  );

  it("does not read any vault if delegated membership is revoked or points to another org", async () => {
    requestContextState.orgId = "org-1";
    requestContextState.userEmail = "owner@example.com";
    requestContextState.assurance = "org-member";
    for (const resolution of [null, "other-org"] as const) {
      resolveOrgIdForEmailMock.mockResolvedValue(resolution);
      const onLookupFailure = vi.fn();
      await expect(
        getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
          matchApiKey: "test-key",
          onLookupFailure,
        }),
      ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
      expect(onLookupFailure).toHaveBeenCalledOnce();
      expect(readAppSecretMock).not.toHaveBeenCalled();
      expect(getSettingMock).not.toHaveBeenCalled();
    }
  });

  it("identifies only the signed-in user's pre-org solo key when an org is active", async () => {
    requestContextState.orgId = "org-1";
    requestContextState.userEmail = "owner@example.com";
    readAppSecretMock.mockImplementation(
      async ({
        key,
        scope,
        scopeId,
      }: {
        key: string;
        scope: string;
        scopeId: string;
      }) => {
        if (key !== "ANTHROPIC_API_KEY") return null;
        if (scope === "org" && scopeId === "org-1")
          return { value: "test-current-org" };
        if (scope === "workspace" && scopeId === "solo:owner@example.com")
          return { value: "test-old-solo" };
        return null;
      },
    );
    await expect(
      getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-old-solo",
      }),
    ).resolves.toMatchObject({
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      credentialProvenance: {
        scope: "workspace",
        scopeId: "solo:owner@example.com",
        source: "app_secrets",
      },
    });
    expect(
      readAppSecretMock.mock.calls.every(([ref]) =>
        ref.scope === "user"
          ? ref.scopeId === "owner@example.com"
          : ref.scopeId === "org-1" || ref.scopeId === "solo:owner@example.com",
      ),
    ).toBe(true);
    readAppSecretMock.mockClear();
    await expect(
      getOwnerApiKeyForEngine("anthropic", "owner@example.com"),
    ).resolves.toMatchObject({
      apiKey: "test-current-org",
      credentialProvenance: { scope: "org", scopeId: "org-1" },
    });
    expect(
      readAppSecretMock.mock.calls.some(
        ([ref]) => ref.scopeId === "solo:owner@example.com",
      ),
    ).toBe(false);
  });

  it.each([
    "no request identity",
    "different identity",
    "org-only",
    "synthetic",
    "restricted",
    "delegated member",
    "delegated organization",
  ])("does not inspect solo credentials for %s", async (scenario) => {
    requestContextState.orgId = "org-1";
    requestContextState.userEmail =
      scenario === "no request identity"
        ? undefined
        : scenario === "different identity"
          ? "other@example.com"
          : "owner@example.com";
    requestContextState.credentialScope =
      scenario === "org-only" ? "org" : undefined;
    requestContextState.synthetic = scenario === "synthetic";
    requestContextState.assurance =
      scenario === "delegated member"
        ? "org-member"
        : scenario === "delegated organization"
          ? "organization"
          : undefined;
    vi.mocked(isPersonalProviderKeyUseRestricted).mockResolvedValue(
      scenario === "restricted",
    );
    const onLookupFailure = vi.fn();
    await getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
      matchApiKey: "test-unrecognized",
      onLookupFailure,
    });
    expect(
      readAppSecretMock.mock.calls.some(([ref]) =>
        ref.scopeId.startsWith("solo:"),
      ),
    ).toBe(false);
    expect(
      readAppSecretMock.mock.calls.every(
        ([ref]) => ref.scope === "user" || ref.scopeId === "org-1",
      ),
    ).toBe(true);
    if (scenario === "restricted")
      expect(onLookupFailure).toHaveBeenCalledOnce();
  });

  it.each(["org-only", "different identity", "delegated member"])(
    "does not inspect a solo key with no org and %s",
    async (scenario) => {
      requestContextState.orgId = undefined;
      requestContextState.userEmail =
        scenario === "different identity"
          ? "other@example.com"
          : "owner@example.com";
      requestContextState.credentialScope =
        scenario === "org-only" ? "org" : undefined;
      requestContextState.assurance =
        scenario === "delegated member" ? "org-member" : undefined;
      await getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-unrecognized",
      });
      expect(
        readAppSecretMock.mock.calls.some(([ref]) =>
          ref.scopeId.startsWith("solo:"),
        ),
      ).toBe(false);
    },
  );

  it("identifies a lower-priority scoped key even when it has failed authentication", async () => {
    requestContextState.orgId = "org-1";
    readOrgMemberRoleMock.mockResolvedValue("owner");
    readAppSecretMock.mockImplementation(
      async ({ key, scope }: { key: string; scope: string }) =>
        key === "ANTHROPIC_API_KEY" && (scope === "org" || scope === "user")
          ? { value: `test-anthropic-${scope}` }
          : null,
    );
    getProviderCredentialAuthFailureMock.mockResolvedValue({
      fingerprint: "failed",
    });
    await expect(
      getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-anthropic-user",
      }),
    ).resolves.toMatchObject({
      apiKey: "test-anthropic-user",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      credentialProvenance: {
        scope: "user",
        scopeId: "owner@example.com",
        source: "app_secrets",
      },
    });
    expect(getProviderCredentialAuthFailureMock).not.toHaveBeenCalled();
  });

  it("identifies both settings formats behind a current vault key", async () => {
    ownerSecrets({ ANTHROPIC_API_KEY: "test-current" });
    getSettingMock.mockImplementation(async (key: string) =>
      key.startsWith("user-anthropic-api-key:")
        ? { key: "test-legacy" }
        : key.startsWith("user-api-key:anthropic:")
          ? { key: "test-setting" }
          : undefined,
    );
    for (const key of ["test-setting", "test-legacy"]) {
      await expect(
        getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
          matchApiKey: key,
        }),
      ).resolves.toMatchObject({
        apiKey: key,
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        credentialProvenance: { scope: "user", source: "settings" },
      });
    }
    readDeployCredentialEnvMock.mockReturnValue("test-unrelated-deploy");
    await expect(
      getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-unknown",
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });

  it("fails closed without reading policy-restricted personal keys for identity", async () => {
    requestContextState.orgId = "org-1";
    vi.mocked(isPersonalProviderKeyUseRestricted).mockResolvedValue(true);
    const onLookupFailure = vi.fn();
    await expect(
      getOwnerApiKeyForEngine("anthropic", "owner@example.com", {
        matchApiKey: "test-unknown",
        onLookupFailure,
      }),
    ).resolves.toEqual({ apiKey: undefined, apiKeyEnvVar: undefined });
    expect(onLookupFailure).toHaveBeenCalledOnce();
    expect(
      readAppSecretMock.mock.calls.every(([ref]) => ref.scope !== "user"),
    ).toBe(true);
    expect(getSettingMock).not.toHaveBeenCalled();
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

  it("keeps the derived provider tag on a noncatalogued owner credential", async () => {
    ownerSecrets({ EXAMPLE_API_KEY: "example-provider-key" });
    await expect(
      getOwnerApiKeyForEngine("ai-sdk:example", "owner@example.com"),
    ).resolves.toMatchObject({
      apiKey: "example-provider-key",
      apiKeyEnvVar: "EXAMPLE_API_KEY",
    });
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
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
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
