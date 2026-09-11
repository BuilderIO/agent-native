import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  isConnected: vi.fn(),
  getConnectedAccounts: vi.fn(),
  ensureInboxFresh: vi.fn(),
  readSettings: vi.fn(),
  readInboxThreads: vi.fn(),
  readCachedLabels: vi.fn(),
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

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  getConnectedAccounts: mocks.getConnectedAccounts,
}));

vi.mock("../server/lib/inbox-sync.js", () => ({
  ensureInboxFresh: mocks.ensureInboxFresh,
}));

vi.mock("../server/lib/mail-settings.js", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../server/lib/inbox-store.js", () => ({
  readInboxThreads: mocks.readInboxThreads,
  readCachedLabels: mocks.readCachedLabels,
  // Identity-ish: the action only needs a stable row -> item mapping here,
  // not the real Gmail-label-id remap (covered in inbox-store.spec.ts).
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
  mocks.isConnected.mockResolvedValue(true);
  // Gmail-connected by default; local-mode tests override this to [].
  mocks.getConnectedAccounts.mockResolvedValue([OWNER]);
  mocks.ensureInboxFresh.mockResolvedValue([
    { accountEmail: OWNER, state: "ready", lastSyncedAt: Date.now() },
  ]);
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
  mocks.readLocalEmails.mockResolvedValue([]);
  mocks.getUserSetting.mockResolvedValue(undefined);
});

describe("list-inbox-threads action", () => {
  it("defaults pinnedLabels to Important when unset, and defaults the active tab to the first tab", async () => {
    mocks.readInboxThreads.mockResolvedValue([
      row({ threadId: "t1", latestMessageId: "m1", isAutomated: false }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.tabs.map((t) => t.id)).toEqual(["important", "other"]);
    expect(result.activeTabId).toBe("important");
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("falls back to the first tab for an unrecognized `tab` id (back-compat)", async () => {
    mocks.readInboxThreads.mockResolvedValue([row({})]);

    const result = await action.run(
      { tab: "not-a-real-tab", limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.activeTabId).toBe("important");
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
    // total/tab counts describe the whole tab, not the unread-filtered page.
    expect(result.total).toBe(2);
    expect(result.tabs.find((t) => t.id === "important")?.total).toBe(2);
    expect(result.tabs.find((t) => t.id === "important")?.unread).toBe(1);
  });

  it("reports syncing when any selected account is still in its initial sync", async () => {
    mocks.readInboxThreads.mockResolvedValue([]);
    mocks.ensureInboxFresh.mockResolvedValue([
      { accountEmail: OWNER, state: "initial", lastSyncedAt: null },
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(result.syncing).toBe(true);
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
    mocks.getConnectedAccounts.mockResolvedValue([]);
  });

  it("never calls the synced-store path when no Google account is connected", async () => {
    mocks.readLocalEmails.mockResolvedValue([localEmail()]);

    await action.run({ limit: 50, offset: 0 } as any, undefined as any);

    expect(mocks.ensureInboxFresh).not.toHaveBeenCalled();
    expect(mocks.readInboxThreads).not.toHaveBeenCalled();
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
      // Not in the inbox — excluded from the thread.
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
    expect(item.id).toBe("m2"); // latest by date
    expect(item.messageCount).toBe(2);
    expect(item.unreadCount).toBe(1);
    expect(item.messageIds.sort()).toEqual(["m1", "m2"]);
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

    expect(result.tabs.map((t) => t.id)).toEqual(["important", "other"]);
    expect(result.activeTabId).toBe("important");
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
  it("uses the synced-store path, not local fallback, when getConnectedAccounts reports a managed grant", async () => {
    // HIGH review finding: a managed Gmail grant has no per-user OAuth row,
    // so the "is this account connected" check must go through
    // getConnectedAccounts (which falls back to the managed client's email),
    // not listOAuthAccountsByOwner directly.
    mocks.getConnectedAccounts.mockResolvedValue(["managed@example.com"]);
    mocks.readInboxThreads.mockResolvedValue([
      row({
        threadId: "t1",
        latestMessageId: "m1",
        accountEmail: "managed@example.com",
      }),
    ]);

    const result = await action.run(
      { limit: 50, offset: 0 } as any,
      undefined as any,
    );

    expect(mocks.ensureInboxFresh).toHaveBeenCalled();
    expect(mocks.readInboxThreads).toHaveBeenCalled();
    expect(mocks.readLocalEmails).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
  });
});
