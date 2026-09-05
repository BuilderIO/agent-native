import { isActionContractError } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  getAccessTokens: vi.fn(),
  getUserSetting: vi.fn(),
  readLocalEmails: vi.fn(),
  gmailListLabels: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailListLabels: mocks.gmailListLabels,
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: mocks.getAccessTokens,
}));

import action from "./list-labels";

describe("list-labels action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getUserSetting.mockResolvedValue({ labels: [] });
    mocks.readLocalEmails.mockResolvedValue([]);
  });

  it("falls back to local labels only when no Gmail account is connected", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getAccessTokens.mockResolvedValue([]);

    const result = await action.run({}, undefined as any);

    expect(result).toEqual([]);
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "labels",
    );
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
  });

  it("fails loudly instead of returning local labels when a connected account's token is unavailable", async () => {
    // Regression: getAccessTokens() silently drops an account whose OAuth
    // refresh failed, which previously looked identical to "no account
    // connected" and fell through to synthetic local labels as if the real
    // mailbox were complete.
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      { accountId: "user@gmail.com", displayName: null, tokens: {} },
    ]);
    mocks.getAccessTokens.mockResolvedValue([]);

    await expect(action.run({}, undefined as any)).rejects.toSatisfy(
      (err: unknown) => {
        expect(isActionContractError(err)).toBe(true);
        expect((err as Error).message).toContain("user@gmail.com");
        expect((err as { statusCode?: number }).statusCode).toBeLessThan(500);
        return true;
      },
    );
    expect(mocks.getUserSetting).not.toHaveBeenCalled();
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
  });

  it("returns merged Gmail labels when every connected account resolves a token", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      { accountId: "user@gmail.com", displayName: null, tokens: {} },
    ]);
    mocks.getAccessTokens.mockResolvedValue([
      { email: "user@gmail.com", accessToken: "token-1" },
    ]);
    mocks.gmailListLabels.mockResolvedValue({
      labels: [
        {
          id: "Label_1",
          name: "Clients",
          threadsUnread: 2,
          threadsTotal: 5,
        },
      ],
    });

    const result = await action.run({}, undefined as any);

    expect(mocks.gmailListLabels).toHaveBeenCalledWith("token-1");
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "clients",
          unreadCount: 2,
          totalCount: 5,
        }),
      ]),
    );
  });

  it("returns a retryable contract error when Gmail label reads fail", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      { accountId: "user@gmail.com", displayName: null, tokens: {} },
    ]);
    mocks.getAccessTokens.mockResolvedValue([
      { email: "user@gmail.com", accessToken: "token-1" },
    ]);
    mocks.gmailListLabels.mockRejectedValue(new Error("Gmail unavailable"));

    await expect(action.run({}, undefined as any)).rejects.toSatisfy(
      (err: unknown) => {
        expect(isActionContractError(err)).toBe(true);
        expect((err as Error).message).toContain("Please retry");
        expect((err as { errorCode?: string }).errorCode).toBe(
          "labels_fetch_failed",
        );
        expect((err as { statusCode?: number }).statusCode).toBe(503);
        return true;
      },
    );
  });
});
