import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getConnectedAccounts: vi.fn(),
  getAccessTokens: vi.fn(),
  getUserSetting: vi.fn(),
  readLocalEmails: vi.fn(),
  gmailListLabels: vi.fn(),
  readCachedLabels: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
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

vi.mock("../server/lib/google-auth.js", () => ({
  getConnectedAccounts: mocks.getConnectedAccounts,
}));

vi.mock("../server/lib/inbox-store.js", () => ({
  readCachedLabels: mocks.readCachedLabels,
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
    // Default: no cache for anyone, so tests that don't care about the
    // cache path fall straight through to the live-fetch assertions below.
    mocks.readCachedLabels.mockResolvedValue({
      labels: [],
      labelMapByAccount: new Map(),
    });
  });

  it("falls back to local labels only when no Gmail account is connected", async () => {
    mocks.getConnectedAccounts.mockResolvedValue([]);
    mocks.getAccessTokens.mockResolvedValue([]);

    const result = await action.run({}, undefined as any);

    expect(result).toEqual({ labels: [], errors: [] });
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "labels",
    );
    expect(mocks.readCachedLabels).not.toHaveBeenCalled();
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
  });

  it("serves cached labels without a live Gmail call when the cache has data", async () => {
    mocks.getConnectedAccounts.mockResolvedValue(["user@gmail.com"]);
    mocks.readCachedLabels.mockResolvedValue({
      labels: [
        {
          id: "clients",
          name: "Clients",
          type: "user",
          unreadCount: 2,
          totalCount: 5,
        },
      ],
      labelMapByAccount: new Map([
        ["user@gmail.com", new Map([["Label_1", "Clients"]])],
      ]),
    });

    const result = await action.run({}, undefined as any);

    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
    expect(result.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "clients",
          unreadCount: 2,
          totalCount: 5,
        }),
      ]),
    );
  });

  it("falls back to a live Gmail call for an account with no cache yet", async () => {
    mocks.getConnectedAccounts.mockResolvedValue(["user@gmail.com"]);
    mocks.getAccessTokens.mockResolvedValue([
      { email: "user@gmail.com", accessToken: "token-1" },
    ]);
    mocks.gmailListLabels.mockResolvedValue({
      labels: [
        { id: "Label_1", name: "Clients", threadsUnread: 2, threadsTotal: 5 },
      ],
    });

    const result = await action.run({}, undefined as any);

    expect(mocks.gmailListLabels).toHaveBeenCalledWith("token-1");
    expect(result.errors).toEqual([]);
    expect(result.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "clients",
          unreadCount: 2,
          totalCount: 5,
        }),
      ]),
    );
  });

  it("never fails the whole read when one account has no cache and its live fetch fails", async () => {
    mocks.getConnectedAccounts.mockResolvedValue([
      "broken@gmail.com",
      "ok@gmail.com",
    ]);
    mocks.readCachedLabels.mockResolvedValue({
      labels: [
        {
          id: "clients",
          name: "Clients",
          type: "user",
          unreadCount: 1,
          totalCount: 1,
        },
      ],
      labelMapByAccount: new Map([
        ["broken@gmail.com", new Map()],
        ["ok@gmail.com", new Map([["Label_1", "Clients"]])],
      ]),
    });
    // broken@gmail.com has no valid token at all (e.g. refresh failed) —
    // getAccessTokens() silently drops it, same as before this change.
    mocks.getAccessTokens.mockResolvedValue([]);

    const result = await action.run({}, undefined as any);

    // No throw: the cached account's labels still come back, and the
    // uncached/unresolvable account simply contributes nothing.
    expect(result.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "clients",
          unreadCount: 1,
          totalCount: 1,
        }),
      ]),
    );
  });

  it("reports a bounded, redacted error instead of swallowing a live Gmail fetch failure", async () => {
    mocks.getConnectedAccounts.mockResolvedValue(["user@gmail.com"]);
    mocks.getAccessTokens.mockResolvedValue([
      { email: "user@gmail.com", accessToken: "token-1" },
    ]);
    mocks.gmailListLabels.mockRejectedValue(
      new Error(
        `Gmail unavailable Bearer ${"x".repeat(300)} access_token=secret-value`,
      ),
    );

    const result = await action.run({}, undefined as any);

    // Well-known system tabs still come back with zeroed counts; nothing throws.
    expect(result.labels).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "important" })]),
    );
    expect(result.errors).toEqual([
      { accountEmail: "user@gmail.com", error: expect.any(String) },
    ]);
    const [{ error }] = result.errors;
    expect(error.length).toBeLessThanOrEqual(240);
    expect(error).not.toContain("secret-value");
    expect(error).toContain("Bearer [redacted]");
  });
});
