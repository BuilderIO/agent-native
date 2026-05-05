import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppSecret = vi.fn();
const mockGetSetting = vi.fn();
const mockGetRequestOrgId = vi.fn<[], string | undefined>();

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
}));

vi.mock("../settings/store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => mockGetRequestOrgId(),
  getRequestUserEmail: () => undefined,
}));

import { getOwnerApiKey } from "./production-agent.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAppSecret.mockResolvedValue(null);
  mockGetSetting.mockResolvedValue(undefined);
  mockGetRequestOrgId.mockReturnValue(undefined);
});

describe("getOwnerApiKey", () => {
  it("returns a user-scoped app secret before shared rows", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockReadAppSecret.mockResolvedValueOnce({
      value: "user-openai-key",
      last4: "-key",
      updatedAt: 1,
    });

    await expect(
      getOwnerApiKey("openai", "owner@example.com"),
    ).resolves.toBe("user-openai-key");
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      scope: "user",
      scopeId: "owner@example.com",
    });
  });

  it("falls back to org-scoped app secrets for the active org", async () => {
    mockGetRequestOrgId.mockReturnValue("org-1");
    mockReadAppSecret
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: "org-openai-key",
        last4: "-key",
        updatedAt: 1,
      });

    await expect(
      getOwnerApiKey("openai", "owner@example.com"),
    ).resolves.toBe("org-openai-key");
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

    await expect(
      getOwnerApiKey("openai", "owner@example.com"),
    ).resolves.toBe("workspace-openai-key");
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scope)).toEqual([
      "user",
      "org",
      "workspace",
    ]);
  });

  it("checks solo workspace scope when no active org exists", async () => {
    mockReadAppSecret
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: "solo-openai-key",
        last4: "-key",
        updatedAt: 1,
      });

    await expect(
      getOwnerApiKey("openai", "solo@example.com"),
    ).resolves.toBe("solo-openai-key");
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
});
