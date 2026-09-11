import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  isConnected: vi.fn(),
  ensureInboxFresh: vi.fn(),
  readSettings: vi.fn(),
  readInboxThreads: vi.fn(),
  readCachedLabels: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  buildDeepLink: (input: any) => `/_agent-native/open?${JSON.stringify(input)}`,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
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
