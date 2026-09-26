import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
  getClientsWithErrors: vi.fn(),
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
  getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
  getClientsWithErrors: mocks.getClientsWithErrors,
}));

vi.mock("../server/lib/inbox-store.js", () => ({
  readCachedLabels: mocks.readCachedLabels,
}));

import action from "./list-labels";

describe("list-labels action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getClientsWithErrors.mockResolvedValue({ clients: [], errors: [] });
    mocks.getUserSetting.mockResolvedValue({ labels: [] });
    mocks.readLocalEmails.mockResolvedValue([]);
    mocks.readCachedLabels.mockResolvedValue({
      labels: [],
      labelMapByAccount: new Map(),
    });
  });

  it("falls back to local labels only when no Gmail account is connected", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [],
      errors: [],
    });
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
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["user@gmail.com"],
      errors: [],
    });
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

  it("returns usable OAuth labels and reports a failed managed-account lookup", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["user@gmail.com"],
      errors: [{ email: "workspace", error: "workspace lookup unavailable" }],
    });
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

    expect(result.labels).toContainEqual(
      expect.objectContaining({ id: "clients" }),
    );
    expect(result.errors).toEqual([
      {
        accountEmail: "workspace",
        error: "workspace lookup unavailable",
      },
    ]);
  });

  it("falls back to a live Gmail call for an account with no cache yet", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["user@gmail.com"],
      errors: [],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: "user@gmail.com",
          accessToken: "token-1",
          refreshToken: "refresh-1",
        },
      ],
      errors: [],
    });
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

  it("never fails the whole read when one account has no cache and no usable client, and reports it in errors", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["broken@gmail.com", "ok@gmail.com"],
      errors: [],
    });
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
    const result = await action.run({}, undefined as any);

    expect(result.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "clients",
          unreadCount: 1,
          totalCount: 1,
        }),
      ]),
    );
    expect(result.errors).toEqual([
      {
        accountEmail: "broken@gmail.com",
        error: "no credentials available for broken@gmail.com",
      },
    ]);
  });

  it("reports a bounded, redacted error instead of swallowing a live Gmail fetch failure", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["user@gmail.com"],
      errors: [],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: "user@gmail.com",
          accessToken: "token-1",
          refreshToken: "refresh-1",
        },
      ],
      errors: [],
    });
    mocks.gmailListLabels.mockRejectedValue(
      new Error(
        `Gmail unavailable Bearer ${"x".repeat(300)} access_token=secret-value`,
      ),
    );

    const result = await action.run({}, undefined as any);

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

  it("fetches labels from a managed account when the cache misses alongside OAuth", async () => {
    const oauthEmail = "personal@example.com";
    const managedEmail = "managed@example.com";
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [oauthEmail, managedEmail],
      errors: [],
    });
    mocks.readCachedLabels.mockResolvedValue({
      labels: [
        {
          id: "personal",
          name: "Personal",
          type: "user",
          unreadCount: 1,
          totalCount: 2,
        },
      ],
      labelMapByAccount: new Map([
        [oauthEmail, new Map([["Label_1", "Personal"]])],
        [managedEmail, new Map()],
      ]),
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: managedEmail,
          accessToken: "managed-access-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });
    mocks.gmailListLabels.mockResolvedValue({
      labels: [
        {
          id: "Label_2",
          name: "Managed",
          threadsUnread: 2,
          threadsTotal: 4,
        },
      ],
    });

    const result = await action.run({}, undefined as any);

    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(
      "owner@example.com",
      [managedEmail],
    );
    expect(mocks.gmailListLabels).toHaveBeenCalledWith("managed-access-token");
    expect(result.errors).toEqual([]);
    expect(result.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "managed",
          unreadCount: 2,
          totalCount: 4,
        }),
      ]),
    );
  });

  it("attributes a managed client-resolution failure to the uncached mailbox", async () => {
    const oauthEmail = "personal@example.com";
    const managedEmail = "managed@example.com";
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [oauthEmail, managedEmail],
      errors: [],
    });
    mocks.readCachedLabels.mockResolvedValue({
      labels: [],
      labelMapByAccount: new Map([
        [oauthEmail, new Map([["Label_1", "Personal"]])],
        [managedEmail, new Map()],
      ]),
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [{ email: "workspace", error: "managed lookup unavailable" }],
    });

    const result = await action.run({}, undefined as any);

    expect(result.errors).toEqual([
      { accountEmail: managedEmail, error: "managed lookup unavailable" },
    ]);
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
  });

  it("retains the refresh failure when an uncached OAuth account has no usable client", async () => {
    const failedEmail = "broken@example.com";
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [failedEmail],
      errors: [],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [{ email: failedEmail, error: "refresh failed" }],
    });

    const result = await action.run({}, undefined as any);

    expect(result.errors).toEqual([
      { accountEmail: failedEmail, error: "refresh failed" },
    ]);
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
  });
});
