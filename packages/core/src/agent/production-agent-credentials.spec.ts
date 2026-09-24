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

import { resetOptionalKeyCache } from "../secrets/optional-key-cache.js";
import {
  getJevContextCredentials,
  getOwnerApiKey,
  getOwnerJevApiKey,
} from "./production-agent.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAppSecret.mockResolvedValue(null);
  mockGetSetting.mockResolvedValue(undefined);
  mockGetRequestContext.mockReturnValue(undefined);
  mockGetRequestOrgId.mockReturnValue(undefined);
  mockResolveBuilderGatewayAuth.mockReset();
  mockResolveBuilderGatewayAuth.mockResolvedValue(null);
  resetOptionalKeyCache();
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
