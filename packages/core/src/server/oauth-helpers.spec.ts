import { beforeEach, describe, expect, it, vi } from "vitest";

const listOAuthAccountsByOwnerMock = vi.hoisted(() => vi.fn());

vi.mock("../oauth-tokens/index.js", () => ({
  listOAuthAccountsByOwner: listOAuthAccountsByOwnerMock,
}));

const { isOAuthConnected, getOAuthAccounts } =
  await import("./oauth-helpers.js");

describe("isOAuthConnected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the owner has an account with usable tokens", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      {
        accountId: "steve@example.com",
        displayName: null,
        tokens: { access_token: "token", refresh_token: "refresh" },
      },
    ]);

    await expect(isOAuthConnected("google", "steve@example.com")).resolves.toBe(
      true,
    );
  });

  it("returns false when no accounts exist for the owner", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([]);

    await expect(isOAuthConnected("google", "steve@example.com")).resolves.toBe(
      false,
    );
  });

  it("returns false when forEmail is empty", async () => {
    await expect(isOAuthConnected("google", "")).resolves.toBe(false);
    expect(listOAuthAccountsByOwnerMock).not.toHaveBeenCalled();
  });

  it("ignores records whose token bundle parsed to an empty object", async () => {
    // parseStoredTokens returns {} when the stored row cannot be decrypted
    // (e.g. after a SECRETS_ENCRYPTION_KEY rotation). Such a record must not
    // count as "connected" — otherwise the reconnect banner never shows while
    // every provider call fails with an undefined bearer token.
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      { accountId: "steve@example.com", displayName: null, tokens: {} },
    ]);

    await expect(isOAuthConnected("google", "steve@example.com")).resolves.toBe(
      false,
    );
  });

  it("still reports connected when one of several records is unusable", async () => {
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      { accountId: "dead@example.com", displayName: null, tokens: {} },
      {
        accountId: "live@example.com",
        displayName: null,
        tokens: { access_token: "token" },
      },
    ]);

    await expect(isOAuthConnected("google", "steve@example.com")).resolves.toBe(
      true,
    );
  });
});

describe("getOAuthAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array without an owner email", async () => {
    await expect(getOAuthAccounts("google")).resolves.toEqual([]);
    expect(listOAuthAccountsByOwnerMock).not.toHaveBeenCalled();
  });

  it("passes through the owner's accounts, including unusable ones", async () => {
    // Deliberately unfiltered: per-account consumers (e.g. calendar's
    // getAuthStatus) surface per-account reconnect errors themselves and
    // need to see the broken record to do so.
    const accounts = [
      { accountId: "steve@example.com", displayName: null, tokens: {} },
    ];
    listOAuthAccountsByOwnerMock.mockResolvedValue(accounts);

    await expect(
      getOAuthAccounts("google", "steve@example.com"),
    ).resolves.toEqual(accounts);
  });
});
