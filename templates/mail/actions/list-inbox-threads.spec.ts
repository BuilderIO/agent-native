import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  listWorkspaceConnectionsForApp: vi.fn(),
  readSettings: vi.fn(),
  readInboxThreads: vi.fn(),
  readCachedLabels: vi.fn(),
  readSyncAccounts: vi.fn(),
  readInboxPushGeneration: vi.fn(),
  getUserSetting: vi.fn(),
  readLocalEmails: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  buildDeepLink: (input: any) => `/_agent-native/open?${JSON.stringify(input)}`,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionsForApp: mocks.listWorkspaceConnectionsForApp,
}));

vi.mock("../server/lib/google-auth.js", () => {
  throw new Error("list-inbox-threads must not load Gmail auth helpers");
});

vi.mock("../server/lib/inbox-sync.js", () => {
  throw new Error("list-inbox-threads must not load inbox sync helpers");
});

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
}));

vi.mock("../server/lib/mail-settings.js", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../server/lib/inbox-store.js", () => ({
  readInboxThreads: mocks.readInboxThreads,
  readCachedLabels: mocks.readCachedLabels,
  readSyncAccounts: mocks.readSyncAccounts,
  readInboxPushGeneration: mocks.readInboxPushGeneration,
  inboxRowToItem: (row: any) => ({
    id: row.latestMessageId,
    threadId: row.threadId,
    from: { name: row.fromName ?? "", email: row.fromEmail ?? "" },
    to: row.to ?? [],
    subject: row.subject ?? "",
    snippet: row.snippet ?? "",
    body: "",
    date: new Date(row.latestDate).toISOString(),
    isRead: !row.isUnread,
    isStarred: !!row.isStarred,
    isArchived: !row.inInbox,
    isTrashed: row.labelIds?.includes("TRASH") ?? false,
    labelIds: row.labelIds ?? [],
    accountEmail: row.accountEmail,
    messageCount: row.messageCount ?? 1,
    unreadCount: row.unreadCount ?? (row.isUnread ? 1 : 0),
    messageIds: row.messageIds ?? [row.latestMessageId],
    isAutomated: !!row.isAutomated,
  }),
}));

import action from "./list-inbox-threads";

const OWNER = "owner@example.com";

function row(overrides: Partial<any>): any {
  return {
    threadId: "t1",
    accountEmail: "owner@example.com",
    latestMessageId: "m1",
    latestDate: Date.now(),
    fromName: "Ada",
    fromEmail: "ada@example.com",
    to: [],
    subject: "Hi",
    snippet: "",
    inInbox: true,
    isUnread: true,
    isStarred: false,
    isAutomated: false,
    labelIds: [],
    messageCount: 1,
    unreadCount: 1,
    messageIds: ["m1"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.listOAuthAccountsByOwner.mockResolvedValue([
    {
      accountId: OWNER,
      tokens: { scope: "https://www.googleapis.com/auth/gmail.modify" },
    },
  ]);
  mocks.listWorkspaceConnectionsForApp.mockResolvedValue([]);
  mocks.readSyncAccounts.mockResolvedValue([
    {
      accountEmail: OWNER,
      status: "idle",
      historyId: "100",
      fullSyncPageToken: null,
      lastPushGeneration: 0,
      lastSyncedAt: Date.now(),
      lastError: null,
      labels: null,
    },
  ]);
  mocks.readInboxPushGeneration.mockResolvedValue(0);
  mocks.readSettings.mockResolvedValue({
    combineInbox: false,
    pinnedLabels: undefined,
    savedFilters: [],
    labelAliases: {},
  });
  mocks.readCachedLabels.mockResolvedValue({
    labels: [],
    labelMapByAccount: new Map(),
  });
  mocks.readInboxThreads.mockResolvedValue([]);
  mocks.readLocalEmails.mockResolvedValue([]);
  mocks.getUserSetting.mockResolvedValue(undefined);
});

describe("list-inbox-threads action", () => {
  it("shows All first by default and returns every inbox thread in it", async () => {
    mocks.readInboxThreads.mockResolvedValue([
      row({ threadId: "t1", latestMessageId: "m1", isAutomated: false }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.map((t) => t.id)).toEqual([
      "__inbox_all__",
      "important",
      "other",
    ]);
    expect(result.activeTabId).toBe("__inbox_all__");
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.tabs.find((t) => t.id === "__inbox_all__")?.total).toBe(1);
  });

  it("omits All when the user hides its tab", async () => {
    mocks.readInboxThreads.mockResolvedValue([]);
    mocks.readSettings.mockResolvedValue({
      combineInbox: false,
      showAllTab: false,
      pinnedLabels: undefined,
      savedFilters: [],
      labelAliases: {},
    });

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.map((t) => t.id)).toEqual(["important", "other"]);
  });

  it("falls back to the first tab for an unrecognized `tab` id (back-compat)", async () => {
    mocks.readInboxThreads.mockResolvedValue([row({})]);

    const result = await action.run(
      { tab: "not-a-real-tab", limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.activeTabId).toBe("__inbox_all__");
  });

  it("still accepts the legacy 'other'/'important'/'inbox' tab ids", async () => {
    mocks.readInboxThreads.mockResolvedValue([
      row({ threadId: "t1", isAutomated: true }),
    ]);

    const result = await action.run(
      { tab: "other", limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.activeTabId).toBe("other");
    expect(result.items).toHaveLength(1);
  });

  it("paginates the active tab with offset/limit without changing tab counts", async () => {
    mocks.readInboxThreads.mockResolvedValue([
      row({ threadId: "t1", latestMessageId: "m1" }),
      row({ threadId: "t2", latestMessageId: "m2" }),
      row({ threadId: "t3", latestMessageId: "m3" }),
    ]);

    const page = await action.run(
      { limit: 2, offset: 1 } as any,
      undefined as any,
    );

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.tabs.find((t) => t.id === "important")?.total).toBe(3);
  });

  it("unreadOnly filters the page but leaves tab counts unchanged", async () => {
    mocks.readInboxThreads.mockResolvedValue([
      row({
        threadId: "t1",
        latestMessageId: "m1",
        isUnread: true,
        unreadCount: 1,
      }),
      row({
        threadId: "t2",
        latestMessageId: "m2",
        isUnread: false,
        unreadCount: 0,
      }),
    ]);

    const result = await action.run(
      { unreadOnly: true, limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].threadId).toBe("t1");
    expect(result.total).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.tabs.find((t) => t.id === "important")?.total).toBe(2);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(1);
  });

  it("reports initial progress from SQL without making Gmail or token-refresh calls", async () => {
    mocks.readInboxThreads.mockResolvedValue([]);
    mocks.readSyncAccounts.mockResolvedValue([
      {
        accountEmail: OWNER,
        status: "idle",
        historyId: null,
        fullSyncPageToken: "next-page",
        lastPushGeneration: 0,
        lastSyncedAt: null,
        lastError: null,
        labels: null,
      },
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.syncing).toBe(true);
    expect(result.accounts[0]).toMatchObject({
      accountEmail: OWNER,
      state: "initial",
      backfillPending: true,
    });
    expect(mocks.readInboxThreads).toHaveBeenCalledWith(OWNER, {
      accountEmails: [OWNER],
    });
    expect(mocks.readInboxPushGeneration).toHaveBeenCalledWith(OWNER, OWNER);
  });

  it("does not report foreground syncing solely for ready backfill while marking cached totals as lower bounds", async () => {
    mocks.readSyncAccounts.mockResolvedValue([
      {
        accountEmail: OWNER,
        status: "idle",
        historyId: "100",
        fullSyncPageToken: null,
        fullSyncPhase: "reconcile",
        lastPushGeneration: 4,
        lastSyncedAt: Date.now(),
        lastError: null,
        labels: null,
      },
    ]);
    mocks.readInboxThreads.mockResolvedValue([row({})]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.syncing).toBe(false);
    expect(result.accounts[0]).toMatchObject({
      state: "ready",
      backfillPending: true,
    });
    expect(result.tabs.find((tab) => tab.id === "__inbox_all__")).toMatchObject(
      { total: 1, totalIsLowerBound: true },
    );
  });

  it("exposes a pending SQL push generation so the client can request incremental sync", async () => {
    mocks.readSyncAccounts.mockResolvedValue([
      {
        accountEmail: OWNER,
        status: "idle",
        historyId: "100",
        fullSyncPageToken: null,
        lastPushGeneration: 1,
        lastSyncedAt: Date.now(),
        lastError: null,
        labels: null,
      },
    ]);
    mocks.readInboxPushGeneration.mockResolvedValue(2);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.syncing).toBe(true);
    expect(result.accounts[0]).toMatchObject({
      state: "ready",
      pushPending: true,
    });
  });

  it("uses provider inbox totals and local lower-bound counts for label tabs during backfill", async () => {
    mocks.readSettings.mockResolvedValue({
      combineInbox: false,
      pinnedLabels: ["projects"],
      savedFilters: [],
      labelAliases: {},
    });
    mocks.readSyncAccounts.mockResolvedValue([
      {
        accountEmail: OWNER,
        status: "idle",
        historyId: "100",
        fullSyncPageToken: "older-page",
        lastPushGeneration: 0,
        lastSyncedAt: Date.now(),
        lastError: null,
        labels: [
          {
            id: "INBOX",
            name: "INBOX",
            threadsTotal: 12,
            threadsUnread: 3,
          },
          {
            id: "Label_123",
            name: "Projects",
            threadsTotal: 7,
            threadsUnread: 2,
          },
          {
            id: "Label_456",
            name: "Inbox",
            threadsTotal: 90,
            threadsUnread: 9,
          },
        ],
      },
    ]);
    mocks.readCachedLabels.mockResolvedValue({
      labels: [{ id: "projects", name: "Projects", type: "user" }],
      labelMapByAccount: new Map([
        [OWNER, new Map([["Label_123", "Projects"]])],
      ]),
    });
    mocks.readInboxThreads.mockResolvedValue([
      row({ threadId: "project-thread", labelIds: ["projects"] }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.find((tab) => tab.id === "__inbox_all__")).toMatchObject(
      { total: 12, unread: 3 },
    );
    expect(result.tabs.find((tab) => tab.id === "projects")).toMatchObject({
      total: 1,
      unread: 1,
      totalIsLowerBound: true,
    });
  });

  it("uses local inbox counts after backfill when cached labels remain stale after archive", async () => {
    mocks.readSyncAccounts.mockResolvedValue([
      {
        accountEmail: OWNER,
        status: "idle",
        historyId: "100",
        fullSyncPageToken: null,
        lastPushGeneration: 0,
        lastSyncedAt: Date.now(),
        lastError: null,
        labels: [
          {
            id: "INBOX",
            name: "INBOX",
            threadsTotal: 1,
            threadsUnread: 1,
          },
        ],
      },
    ]);
    mocks.readInboxThreads.mockResolvedValue([]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.find((tab) => tab.id === "__inbox_all__")).toMatchObject(
      { total: 0, unread: 0 },
    );
    expect(
      result.tabs.find((tab) => tab.id === "__inbox_all__")?.totalIsLowerBound,
    ).toBeUndefined();
  });
});

describe("list-inbox-threads action — local mode (no connected Google account)", () => {
  function localEmail(overrides: Partial<any> = {}): any {
    return {
      id: "m1",
      threadId: "t1",
      from: { name: "Ada", email: "ada@example.com" },
      to: [],
      subject: "Hi",
      snippet: "",
      body: "",
      date: new Date().toISOString(),
      isRead: false,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      isDraft: false,
      labelIds: ["inbox"],
      ...overrides,
    };
  }

  beforeEach(() => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.readSyncAccounts.mockResolvedValue([]);
  });

  it("never calls the synced-store path when no Google account is connected", async () => {
    mocks.readLocalEmails.mockResolvedValue([localEmail()]);

    await action.run({ limit: 50, offset: 0 } as any, undefined as any);

    expect(mocks.readInboxThreads).not.toHaveBeenCalled();
  });

  it("ignores a stale sync row when no current OAuth or managed grant exists", async () => {
    mocks.readSyncAccounts.mockResolvedValue([
      {
        accountEmail: "disconnected@example.com",
        status: "idle",
        historyId: "100",
        fullSyncPageToken: null,
        lastPushGeneration: 0,
        lastSyncedAt: Date.now(),
        lastError: null,
        labels: null,
      },
    ]);
    mocks.readLocalEmails.mockResolvedValue([localEmail()]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(mocks.readInboxThreads).not.toHaveBeenCalled();
    expect(mocks.readLocalEmails).toHaveBeenCalledWith(OWNER);
    expect(result.accounts).toEqual([]);
    expect(result.items).toHaveLength(1);
  });

  it("groups local messages into one thread item with unified counts and reports no accounts/syncing", async () => {
    mocks.readLocalEmails.mockResolvedValue([
      localEmail({
        id: "m1",
        threadId: "t1",
        isRead: false,
        date: "2024-01-01T00:00:00Z",
      }),
      localEmail({
        id: "m2",
        threadId: "t1",
        isRead: true,
        date: "2024-01-02T00:00:00Z",
      }),
      localEmail({ id: "m3", threadId: "t2", isArchived: true }),
      localEmail({ id: "m4", threadId: "t3", isTrashed: true }),
      localEmail({ id: "m5", threadId: "t4", isDraft: true }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.accounts).toEqual([]);
    expect(result.syncing).toBe(false);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.threadId).toBe("t1");
    expect(item.id).toBe("m2");
    expect(item.messageCount).toBe(2);
    expect(item.unreadCount).toBe(1);
    expect(item.messageIds.sort()).toEqual(["m1", "m2"]);
  });

  it("excludes sent-only threads but keeps sent replies in inbox threads", async () => {
    mocks.readLocalEmails.mockResolvedValue([
      localEmail({
        id: "sent-only",
        threadId: "sent-only-thread",
        isSent: true,
        labelIds: ["sent"],
      }),
      localEmail({
        id: "received",
        threadId: "reply-thread",
        labelIds: ["inbox"],
        date: "2024-01-01T00:00:00Z",
      }),
      localEmail({
        id: "reply",
        threadId: "reply-thread",
        isSent: true,
        labelIds: ["sent"],
        date: "2024-01-02T00:00:00Z",
      }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "reply",
      threadId: "reply-thread",
      messageCount: 2,
      messageIds: ["received", "reply"],
    });
    expect(result.tabs.find((tab) => tab.id === "__inbox_all__")?.total).toBe(
      1,
    );
  });

  it("runs the same tab partition: a promotions-labeled message lands in Other", async () => {
    mocks.readLocalEmails.mockResolvedValue([
      localEmail({
        id: "m1",
        threadId: "t1",
        labelIds: ["inbox", "promotions"],
      }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.map((t) => t.id)).toEqual([
      "__inbox_all__",
      "important",
      "other",
    ]);
    expect(result.activeTabId).toBe("__inbox_all__");
    expect(result.tabs.find((t) => t.id === "other")?.total).toBe(1);
    expect(result.tabs.find((t) => t.id === "important")?.total).toBe(0);
  });

  it("a plain sender lands in Important", async () => {
    mocks.readLocalEmails.mockResolvedValue([
      localEmail({ id: "m1", threadId: "t1", labelIds: ["inbox"] }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.find((t) => t.id === "important")?.total).toBe(1);
    expect(result.tabs.find((t) => t.id === "other")?.total).toBe(0);
  });
});

describe("list-inbox-threads action — managed workspace grant (no per-user OAuth row)", () => {
  it("discovers a connected managed account before its first sync row exists", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.listWorkspaceConnectionsForApp.mockResolvedValue([
      {
        accountId: "managed@example.com",
        status: "connected",
      },
    ]);
    mocks.readSyncAccounts.mockResolvedValue([]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(mocks.listWorkspaceConnectionsForApp).toHaveBeenCalledWith({
      appId: "mail",
      provider: "gmail",
    });
    expect(mocks.readInboxThreads).toHaveBeenCalledWith(OWNER, {
      accountEmails: ["managed@example.com"],
    });
    expect(mocks.readLocalEmails).not.toHaveBeenCalled();
    expect(result.accounts).toMatchObject([
      { accountEmail: "managed@example.com", state: "initial" },
    ]);
    expect(result.syncing).toBe(true);
  });
});
