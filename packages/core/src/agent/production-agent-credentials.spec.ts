import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppSecret = vi.fn();
const mockGetSetting = vi.fn();
const mockGetRequestOrgId = vi.fn<[], string | undefined>();
const mockGetRequestContext = vi.fn();
const mockResolveBuilderGatewayAuth = vi.fn();

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
}));

vi.mock("../settings/store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => mockGetRequestContext(),
  getRequestOrgId: () => mockGetRequestOrgId(),
  getRequestUserEmail: () => undefined,
}));
vi.mock("../server/credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/credential-provider.js")
  >()),
  resolveBuilderGatewayAuth: (...args: unknown[]) =>
    mockResolveBuilderGatewayAuth(...args),
}));

const mockIsPersonalProviderKeyUseRestricted = vi.fn();
vi.mock(
  "../server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >()),
    isPersonalProviderKeyUseRestricted: (...args: unknown[]) =>
      mockIsPersonalProviderKeyUseRestricted(...args),
  }),
);

import { resetOptionalKeyCache } from "../secrets/optional-key-cache.js";
import {
  getJevContextCredentials,
  getOwnerApiKey,
  getOwnerJevApiKey,
  missingCredentialsChatError,
} from "./production-agent.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAppSecret.mockResolvedValue(null);
  mockGetSetting.mockResolvedValue(undefined);
  mockGetRequestContext.mockReturnValue(undefined);
  mockGetRequestOrgId.mockReturnValue(undefined);
  mockResolveBuilderGatewayAuth.mockReset();
  mockResolveBuilderGatewayAuth.mockResolvedValue(null);
  mockIsPersonalProviderKeyUseRestricted.mockResolvedValue(false);
  resetOptionalKeyCache();
});

describe("missingCredentialsChatError", () => {
  it("tells a restricted member why, instead of asking them to add a key", async () => {
    mockIsPersonalProviderKeyUseRestricted.mockResolvedValue(true);
    await expect(
      missingCredentialsChatError({
        ownerEmail: "member@example.com",
        visitorFacing: false,
      }),
    ).resolves.toEqual({
      type: "error",
      error: "Owners and admins restricted personal API keys.",
      errorCode: "personal_provider_keys_restricted",
      recoverable: false,
    });
  });

  it("keeps the connect-a-provider copy for everyone else", async () => {
    await expect(
      missingCredentialsChatError({
        ownerEmail: "member@example.com",
        visitorFacing: false,
      }),
    ).resolves.toMatchObject({ errorCode: "missing_credentials" });

    mockIsPersonalProviderKeyUseRestricted.mockResolvedValue(true);
    await expect(
      missingCredentialsChatError({
        ownerEmail: "visitor@example.com",
        visitorFacing: true,
      }),
    ).resolves.toMatchObject({
      error: "AI features aren't available on this site right now.",
      errorCode: "missing_credentials",
    });

    mockIsPersonalProviderKeyUseRestricted.mockRejectedValue(new Error("blip"));
    await expect(
      missingCredentialsChatError({
        ownerEmail: "member@example.com",
        visitorFacing: false,
      }),
    ).resolves.toMatchObject({ errorCode: "missing_credentials" });
  });
});

describe("getOwnerApiKey with personal API keys restricted", () => {
  it("skips a restricted member's personal rows and uses the org key", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockIsPersonalProviderKeyUseRestricted.mockResolvedValue(true);
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "org"
        ? { value: "org-anthropic-key", last4: "-key", updatedAt: 1 }
        : { value: "personal-anthropic-key", last4: "-key", updatedAt: 1 },
    );

    await expect(
      getOwnerApiKey("anthropic", "member@example.com"),
    ).resolves.toBe("org-anthropic-key");
    expect(mockIsPersonalProviderKeyUseRestricted).toHaveBeenCalledWith({
      email: "member@example.com",
      orgId: "org-1",
    });
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scope)).toEqual([
      "org",
    ]);
  });

  it("never falls back to the legacy personal settings row while restricted", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockIsPersonalProviderKeyUseRestricted.mockResolvedValue(true);
    mockGetSetting.mockResolvedValue({ key: "legacy-personal-key" });

    await expect(
      getOwnerApiKey("anthropic", "member@example.com"),
    ).resolves.toBeUndefined();
    expect(mockGetSetting).not.toHaveBeenCalled();
  });

  it("still returns a restricted member's personal Jev key, which the policy does not cover", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockIsPersonalProviderKeyUseRestricted.mockResolvedValue(true);
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "user"
        ? { value: "user-jev-key", last4: "-key", updatedAt: 1 }
        : null,
    );

    await expect(getOwnerApiKey("jev", "member@example.com")).resolves.toBe(
      "user-jev-key",
    );
    expect(mockIsPersonalProviderKeyUseRestricted).not.toHaveBeenCalled();
  });

  it("does not fail a Jev lookup when the policy is unreadable", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockIsPersonalProviderKeyUseRestricted.mockRejectedValue(
      new Error("settings unavailable"),
    );
    mockGetSetting.mockResolvedValue({ key: "legacy-user-jev-key" });
    const onLookupFailure = vi.fn();

    await expect(
      getOwnerApiKey("jev", "member@example.com", { onLookupFailure }),
    ).resolves.toBe("legacy-user-jev-key");
    expect(onLookupFailure).not.toHaveBeenCalled();
  });

  it("reports an unreadable restriction as a lookup failure", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockIsPersonalProviderKeyUseRestricted.mockRejectedValue(
      new Error("settings unavailable"),
    );
    mockReadAppSecret.mockResolvedValue({
      value: "personal-anthropic-key",
      last4: "-key",
      updatedAt: 1,
    });
    const onLookupFailure = vi.fn();

    await expect(
      getOwnerApiKey("anthropic", "member@example.com", { onLookupFailure }),
    ).resolves.toBeUndefined();
    expect(onLookupFailure).toHaveBeenCalledTimes(1);
    expect(mockReadAppSecret).not.toHaveBeenCalled();
  });
});

describe("getOwnerApiKey", () => {
  it("returns a user-scoped app secret before shared rows", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockReadAppSecret.mockResolvedValueOnce({
      value: "user-openai-key",
      last4: "-key",
      updatedAt: 1,
    });

    await expect(getOwnerApiKey("openai", "owner@example.com")).resolves.toBe(
      "user-openai-key",
    );
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      scope: "user",
      scopeId: "owner@example.com",
    });
  });

  it("falls back to org-scoped app secrets for the active org", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
      value: "org-openai-key",
      last4: "-key",
      updatedAt: 1,
    });

    await expect(getOwnerApiKey("openai", "owner@example.com")).resolves.toBe(
      "org-openai-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      {
        key: "OPENAI_API_KEY",
        scope: "user",
        scopeId: "owner@example.com",
      },
      { key: "OPENAI_API_KEY", scope: "org", scopeId: "org-1" },
    ]);
  });

  it("falls back to workspace-scoped app secrets for registered shared keys", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockReadAppSecret
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: "workspace-openai-key",
        last4: "-key",
        updatedAt: 1,
      });

    await expect(getOwnerApiKey("openai", "owner@example.com")).resolves.toBe(
      "workspace-openai-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scope)).toEqual([
      "user",
      "org",
      "workspace",
    ]);
  });

  it("checks solo workspace scope when no active org exists", async () => {
    mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
      value: "solo-openai-key",
      last4: "-key",
      updatedAt: 1,
    });

    await expect(getOwnerApiKey("openai", "solo@example.com")).resolves.toBe(
      "solo-openai-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      {
        key: "OPENAI_API_KEY",
        scope: "user",
        scopeId: "solo@example.com",
      },
      {
        key: "OPENAI_API_KEY",
        scope: "workspace",
        scopeId: "solo:solo@example.com",
      },
    ]);
  });

  it("reads a Gemini key saved under either name, the chat name first at each scope", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockReadAppSecret.mockImplementation(
      async ({ key, scope }: { key: string; scope: string }) =>
        key === "GEMINI_API_KEY" && scope === "user"
          ? { value: "personal-service-key", last4: "-key", updatedAt: 1 }
          : key === "GOOGLE_GENERATIVE_AI_API_KEY" && scope === "org"
            ? { value: "org-chat-key", last4: "-key", updatedAt: 1 }
            : null,
    );

    await expect(getOwnerApiKey("google", "owner@example.com")).resolves.toBe(
      "personal-service-key",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      {
        key: "GOOGLE_GENERATIVE_AI_API_KEY",
        scope: "user",
        scopeId: "owner@example.com",
      },
      { key: "GEMINI_API_KEY", scope: "user", scopeId: "owner@example.com" },
    ]);
  });

  it("does not cache Jev as absent when the secret store is unreadable", async () => {
    mockReadAppSecret.mockRejectedValue(new Error("database unavailable"));

    await expect(
      getOwnerJevApiKey("owner@example.com"),
    ).resolves.toBeUndefined();
    await expect(
      getOwnerJevApiKey("owner@example.com"),
    ).resolves.toBeUndefined();

    expect(mockReadAppSecret).toHaveBeenCalledTimes(2);
  });

  it("uses a valid deployment Jev key when no scoped key is saved", async () => {
    vi.stubEnv("JEV_API_KEY", "deployment-jev-key");

    await expect(getOwnerJevApiKey("owner@example.com")).resolves.toBe(
      "deployment-jev-key",
    );
  });

  it("keeps a scoped Jev key distinct from the deployment fallback", async () => {
    mockReadAppSecret.mockResolvedValueOnce({
      value: "user-jev-key",
      last4: "-key",
      updatedAt: 1,
    });

    await expect(
      getJevContextCredentials("owner@example.com"),
    ).resolves.toEqual({
      apiKey: "user-jev-key",
      personalApiKey: "user-jev-key",
      builderAuth: null,
    });

    resetOptionalKeyCache();
    vi.stubEnv("JEV_API_KEY", "deployment-jev-key");
    mockReadAppSecret.mockResolvedValue(null);

    await expect(
      getJevContextCredentials("owner@example.com"),
    ).resolves.toEqual({
      apiKey: "deployment-jev-key",
      personalApiKey: undefined,
      builderAuth: null,
    });
  });

  it("keeps agent requests usable when Builder credentials cannot be resolved", async () => {
    mockResolveBuilderGatewayAuth.mockRejectedValueOnce(
      new Error("OAuth token store unavailable"),
    );

    await expect(getJevContextCredentials(null)).resolves.toEqual({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: null,
      builderAuthLookupFailed: true,
    });
  });

  it("keeps a saved Jev key when Builder credentials cannot be resolved", async () => {
    mockReadAppSecret.mockResolvedValueOnce({
      value: "user-jev-key",
      last4: "-key",
      updatedAt: 1,
    });
    mockResolveBuilderGatewayAuth.mockRejectedValueOnce(
      new Error("OAuth token store unavailable"),
    );

    await expect(
      getJevContextCredentials("owner@example.com"),
    ).resolves.toEqual({
      apiKey: "user-jev-key",
      personalApiKey: "user-jev-key",
      builderAuth: null,
      builderAuthLookupFailed: true,
    });
  });

  it("uses the owner's org for Builder auth in background automation", async () => {
    mockGetRequestOrgId.mockReturnValue(undefined);

    await getJevContextCredentials("owner@example.com");

    expect(mockResolveBuilderGatewayAuth).toHaveBeenCalledWith({
      userEmail: "owner@example.com",
      orgId: undefined,
    });
  });

  it("keeps Builder auth personal when Personal scope is explicit", async () => {
    mockGetRequestContext.mockReturnValue({ orgScope: "personal" });
    mockGetRequestOrgId.mockReturnValue(undefined);

    await getJevContextCredentials("owner@example.com");

    expect(mockResolveBuilderGatewayAuth).toHaveBeenCalledWith({
      userEmail: "owner@example.com",
      orgId: null,
    });
  });

  it("does not use a deployment Jev key when scoped lookup fails", async () => {
    vi.stubEnv("JEV_API_KEY", "deployment-jev-key");
    mockReadAppSecret.mockRejectedValue(new Error("database unavailable"));

    await expect(
      getOwnerJevApiKey("owner@example.com"),
    ).resolves.toBeUndefined();
  });
});
