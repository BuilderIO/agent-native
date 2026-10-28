import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSyncAccounts: vi.fn(),
  readInboxThreads: vi.fn(),
  readCachedLabels: vi.fn(),
  getSnoozedThreadIds: vi.fn(),
}));

vi.mock("./inbox-store.js", () => ({
  readSyncAccounts: mocks.readSyncAccounts,
  readInboxThreads: mocks.readInboxThreads,
  readCachedLabels: mocks.readCachedLabels,
  inboxRowToItem: (row: any) => ({
    id: row.latestMessageId,
    threadId: row.threadId,
    from: { name: "", email: row.fromEmail ?? "" },
    to: [],
    subject: row.subject ?? "",
    snippet: "",
    body: "",
    date: new Date(row.latestDate).toISOString(),
    isRead: !row.isUnread,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: row.labelIds ?? [],
    accountEmail: row.accountEmail,
  }),
}));

vi.mock("./jobs.js", () => ({
  getSnoozedThreadIds: mocks.getSnoozedThreadIds,
}));

import {
  canServeFromInboxStore,
  readCachedInboxEmails,
} from "./cached-inbox-reads.js";

const OWNER = "owner@example.com";
const A = "a@example.com";
const B = "b@example.com";

function row(overrides: Record<string, unknown>) {
  return {
    threadId: "t",
    latestMessageId: "m",
    accountEmail: A,
    latestDate: Date.parse("2026-10-01T10:00:00Z"),
    isUnread: false,
    labelIds: ["INBOX"],
    ...overrides,
  };
}

function synced(
  accountEmail: string,
  lastSyncedAt: number | null,
  historyId = "1",
) {
  return { accountEmail, historyId, lastSyncedAt };
}

describe("canServeFromInboxStore", () => {
  it("serves only inbox-scoped views without a search", () => {
    expect(canServeFromInboxStore({ view: "inbox" })).toBe(true);
    expect(canServeFromInboxStore({ view: "unread" })).toBe(true);
    expect(canServeFromInboxStore({ view: "inbox", label: "pylon" })).toBe(
      true,
    );
    for (const view of [
      "drafts",
      "sent",
      "starred",
      "archive",
      "trash",
      "all",
    ]) {
      expect(canServeFromInboxStore({ view })).toBe(false);
    }
    expect(canServeFromInboxStore({ view: "inbox", q: "from:x" })).toBe(false);
    expect(
      canServeFromInboxStore({ view: "inbox", label: "note-to-self" }),
    ).toBe(false);
  });
});

describe("readCachedInboxEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSyncAccounts.mockResolvedValue([synced(A, 5_000)]);
    mocks.readCachedLabels.mockResolvedValue({
      labels: [],
      labelMapByAccount: new Map(),
    });
    mocks.getSnoozedThreadIds.mockResolvedValue(new Set());
    mocks.readInboxThreads.mockResolvedValue([
      row({ threadId: "t1", latestMessageId: "m1", isUnread: true }),
      row({ threadId: "t2", latestMessageId: "m2", isUnread: false }),
      row({
        threadId: "t3",
        latestMessageId: "m3",
        isUnread: true,
        labelIds: ["INBOX", "Label_1"],
      }),
    ]);
  });

  const read = (overrides: Record<string, unknown> = {}) =>
    readCachedInboxEmails({
      ownerEmail: OWNER,
      view: "inbox",
      accountEmails: [A],
      limit: 25,
      ...overrides,
    } as Parameters<typeof readCachedInboxEmails>[0]);

  it("returns the first page of inbox rows with the sync time they came from", async () => {
    const result = await read({ limit: 2 });

    expect(result?.emails.map((email) => email.id)).toEqual(["m1", "m2"]);
    expect(result?.totalEstimate).toBe(3);
    expect(result?.syncedAt).toBe(5_000);
  });

  it("narrows the unread view to unread threads", async () => {
    const result = await read({ view: "unread" });

    expect(result?.emails.map((email) => email.id)).toEqual(["m1", "m3"]);
  });

  it("excludes snoozed threads like the live inbox view", async () => {
    mocks.getSnoozedThreadIds.mockResolvedValue(new Set(["t2"]));

    const result = await read();

    expect(result?.emails.map((email) => email.id)).toEqual(["m1", "m3"]);
  });

  it("returns null, never an empty page, for views and queries the store cannot answer", async () => {
    expect(await read({ view: "drafts" })).toBeNull();
    expect(await read({ q: "from:someone" })).toBeNull();
    expect(mocks.readInboxThreads).not.toHaveBeenCalled();
  });

  it("returns null when an account has not finished its first sync (absent, not empty)", async () => {
    mocks.readSyncAccounts.mockResolvedValue([
      synced(A, 5_000),
      synced(B, null, null as unknown as string),
    ]);

    expect(await read({ accountEmails: [A, B] })).toBeNull();
    mocks.readSyncAccounts.mockResolvedValue([synced(A, 5_000)]);
    expect(await read({ accountEmails: [A, B] })).toBeNull();
  });

  it("reports the oldest last-sync across accounts", async () => {
    mocks.readSyncAccounts.mockResolvedValue([
      synced(A, 9_000),
      synced(B, 4_000),
    ]);

    const result = await read({ accountEmails: [A, B] });

    expect(result?.syncedAt).toBe(4_000);
  });
});
