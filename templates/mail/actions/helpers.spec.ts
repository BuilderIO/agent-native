import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  getClients: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  saveOAuthTokens: vi.fn(),
}));

vi.mock("../server/lib/google-api.js", () => ({
  createOAuth2Client: vi.fn(),
  gmailListLabels: vi.fn(),
}));

vi.mock("../server/lib/google-auth.js", () => ({
  getClients: mocks.getClients,
  getOAuth2Credentials: vi.fn(),
}));

import { getAccessTokens } from "./helpers.js";

const OWNER = "owner@example.com";

describe("getAccessTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue(OWNER);
  });

  it("returns refreshed tokens for the owner's per-user OAuth rows", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "connected@example.com",
        tokens: { access_token: "tok-1", expiry_date: Date.now() + 3600_000 },
      },
    ]);

    const result = await getAccessTokens();

    expect(result).toEqual([
      { email: "connected@example.com", accessToken: "tok-1" },
    ]);
    expect(mocks.getClients).not.toHaveBeenCalled();
  });

  // Regression coverage: a managed-only owner (connected only through the
  // workspace's shared Gmail grant) has zero per-user OAuth rows, and
  // getAccessTokens previously returned [] for that case — silently
  // dropping the account from every bulk-mutation and label-read caller.
  it("falls back to the managed client when the owner has no OAuth rows", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getClients.mockResolvedValue([
      {
        email: "managed@example.com",
        accessToken: "managed-token",
        refreshToken: "",
      },
    ]);

    const result = await getAccessTokens();

    expect(mocks.getClients).toHaveBeenCalledWith(OWNER);
    expect(result).toEqual([
      { email: "managed@example.com", accessToken: "managed-token" },
    ]);
  });

  it("returns an empty array when neither OAuth rows nor a managed grant exist", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getClients.mockResolvedValue([]);

    await expect(getAccessTokens()).resolves.toEqual([]);
  });
});
