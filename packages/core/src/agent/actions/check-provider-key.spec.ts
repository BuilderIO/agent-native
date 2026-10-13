import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../../server/request-context.js";

const mockCheckProviderKey = vi.fn();
const mockReadAppSecret = vi.fn();
const mockResolveSecretDetailed = vi.fn();
const mockRecordFailure = vi.fn();
const mockSsrfSafeFetch = vi.fn();
const mockGetOrgRoleForEmail = vi.fn();

vi.mock("../../server/agent-engine-provider-models-route.js", async (load) => {
  const actual =
    await load<
      typeof import("../../server/agent-engine-provider-models-route.js")
    >();
  return {
    ...actual,
    checkProviderKey: (...args: unknown[]) => mockCheckProviderKey(...args),
  };
});

vi.mock("../../secrets/storage.js", () => ({
  readAppSecret: (...args: unknown[]) => mockReadAppSecret(...args),
}));

vi.mock("../../server/credential-provider.js", () => ({
  clearProviderCredentialAuthFailure: vi.fn(),
  recordProviderCredentialAuthFailure: (...args: unknown[]) =>
    mockRecordFailure(...args),
  isTrustedSelfHostedRuntime: () => false,
  resolveSecretDetailed: (...args: unknown[]) =>
    mockResolveSecretDetailed(...args),
}));

vi.mock("../../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
  isBlockedExtensionUrlWithDns: async () => false,
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: (...args: unknown[]) => mockGetOrgRoleForEmail(...args),
}));

import action from "./check-provider-key.js";

describe("check-provider-key action", () => {
  beforeEach(() => {
    mockCheckProviderKey.mockReset();
    mockCheckProviderKey.mockResolvedValue({
      ok: true,
      provider: "anthropic",
      models: ["claude-a"],
      checkedAt: 1,
    });
  });

  it("checks a pasted key for the signed-in caller", async () => {
    await expect(
      action.run({ provider: "anthropic", key: " sk-ant-fake-placeholder " }, {
        userEmail: "alice@example.test",
        caller: "agent",
      } as any),
    ).resolves.toMatchObject({ ok: true, models: ["claude-a"] });
    expect(mockCheckProviderKey).toHaveBeenCalledWith({
      provider: "anthropic",
      key: "sk-ant-fake-placeholder",
    });
  });

  it("checks the saved key at a scope when no key is passed", async () => {
    await action.run({ provider: "openai", scope: "org" }, {
      userEmail: "alice@example.test",
      caller: "http",
    } as any);
    expect(mockCheckProviderKey).toHaveBeenCalledWith({
      provider: "openai",
      scope: "org",
    });
  });

  it("refuses an anonymous caller", async () => {
    await expect(
      action.run({ provider: "anthropic" }, { caller: "http" } as any),
    ).rejects.toThrow("Not authenticated.");
    expect(mockCheckProviderKey).not.toHaveBeenCalled();
  });
});

describe("check-provider-key action: saved keys stay put", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<
      typeof import("../../server/agent-engine-provider-models-route.js")
    >("../../server/agent-engine-provider-models-route.js");
    mockCheckProviderKey.mockImplementation(actual.checkProviderKey);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Both rows hold an obviously fake saved key.
    mockReadAppSecret.mockResolvedValue({ value: "sk-fake-placeholder" });
    mockResolveSecretDetailed.mockResolvedValue({
      value: "sk-fake-placeholder",
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    });
    mockGetOrgRoleForEmail.mockResolvedValue("member");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runAsMember(args: Record<string, unknown>) {
    return runWithRequestContext(
      { userEmail: "mallory@example.test", orgId: "org-1" },
      () =>
        action.run(
          args as any,
          {
            userEmail: "mallory@example.test",
            orgId: "org-1",
            caller: "agent",
          } as any,
        ),
    );
  }

  it("refuses an endpoint without a key and sends nothing", async () => {
    await expect(
      runAsMember({ provider: "openai", baseUrl: "https://evil.example/v1" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message:
        "Pass a key with baseUrl. A saved key is only checked against its saved endpoint.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("refuses a member checking the organization's key and reads nothing", async () => {
    await expect(
      runAsMember({ provider: "openai", scope: "org" }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Only organization owners and admins can check organization keys.",
    });
    expect(mockReadAppSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });
});
