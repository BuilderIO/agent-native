/**
 * Tests for email-state.ts — the shared server functions for email state
 * changes (archive, unarchive, star, trash, untrash, mark read, mark thread
 * read). Each test verifies the superset behaviour merged from the prior
 * action and REST handler implementations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveEmail,
  unarchiveEmail,
  toggleStar,
  trashEmail,
  untrashEmail,
  markAllLocalUnreadRead,
  markRead,
  markThreadRead,
} from "./email-state.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
  gmailTrashThread: vi.fn(),
  gmailUntrashThread: vi.fn(),
}));

vi.mock("./google-auth.js", () => ({
  isConnected: vi.fn(),
}));

vi.mock("./thread-cache.js", () => ({
  invalidateThreadCache: vi.fn(),
  threadMessagesCache: new Map(),
  threadCacheKey: vi.fn((o: string, t: string) => `${o}:${t}`),
  THREAD_CACHE_TTL: 300_000,
}));

import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import {
  gmailGetMessage,
  gmailModifyMessage,
  gmailModifyThread,
  gmailTrashThread,
  gmailUntrashThread,
} from "./google-api.js";
import { isConnected } from "./google-auth.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";
import { invalidateThreadCache } from "./thread-cache.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "owner@example.com";
const ACCT = "connected@example.com";
const ACCESS_TOKEN = "access-token-abc";
const MSG_ID = "msg-001";
const THREAD_ID = "thread-xyz";

function makeLocalEmails() {
  return [
    {
      id: MSG_ID,
      threadId: THREAD_ID,
      isRead: false,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      labelIds: ["inbox"],
      date: "2024-01-01T00:00:00Z",
    },
    {
      id: "msg-002",
      threadId: THREAD_ID,
      isRead: true,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      labelIds: ["inbox"],
      date: "2024-01-01T00:01:00Z",
    },
  ];
}

function mockConnected(connected: boolean) {
  vi.mocked(isConnected).mockResolvedValue(connected);
}

function mockAccounts() {
  vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
    {
      accountId: ACCT,
      owner: OWNER,
      tokens: {
        access_token: ACCESS_TOKEN,
        expiry_date: Date.now() + 3600_000,
      },
    },
  ] as any);
  vi.mocked(getOAuthTokens).mockResolvedValue({
    access_token: ACCESS_TOKEN,
    expiry_date: Date.now() + 3600_000,
  } as any);
}

function mockLocalEmails(emails = makeLocalEmails()) {
  vi.mocked(getUserSetting).mockImplementation(async (_owner, key) => {
    if (key === "local-emails") return { emails } as any;
    if (key === "labels")
      return {
        labels: [{ id: "inbox", name: "Inbox", unreadCount: 1, totalCount: 2 }],
      } as any;
    return undefined;
  });
  vi.mocked(putUserSetting).mockResolvedValue(undefined as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// archiveEmail
// ---------------------------------------------------------------------------

describe("archiveEmail", () => {
  describe("local mode", () => {
    it("marks entire thread as archived and removes inbox label", async () => {
      mockConnected(false);
      mockLocalEmails();

      const result = await archiveEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isArchived: true,
      });
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      const emails = (written as any).emails;
      // Both messages in the thread must be archived
      expect(emails.filter((e: any) => e.isArchived)).toHaveLength(2);
      expect(emails.every((e: any) => !e.labelIds.includes("inbox"))).toBe(
        true,
      );
    });

    it("recomputes label unread counts after archive", async () => {
      mockConnected(false);
      mockLocalEmails();

      await archiveEmail({ id: MSG_ID, ownerEmail: OWNER });

      const labelCall = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "labels");
      expect(labelCall).toBeDefined();
    });

    it("throws when email not found", async () => {
      mockConnected(false);
      mockLocalEmails([]);
      await expect(
        archiveEmail({ id: "nonexistent", ownerEmail: OWNER }),
      ).rejects.toThrow("not found");
    });
  });

  describe("Gmail mode", () => {
    it("uses preferred accountEmail-scoped account", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
        labelIds: ["INBOX"],
      } as any);
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      const result = await archiveEmail({
        id: MSG_ID,
        ownerEmail: OWNER,
        accountEmail: ACCT,
      });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isArchived: true,
      });
      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        undefined,
        ["INBOX"],
      );
    });

    it("invalidates thread cache after archive", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
        labelIds: ["INBOX"],
      } as any);
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      await archiveEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, THREAD_ID);
    });

    it("skips gmailGetMessage round-trip when threadId hint is provided and removeLabel absent", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      await archiveEmail({
        id: MSG_ID,
        ownerEmail: OWNER,
        threadId: THREAD_ID,
      });

      expect(gmailGetMessage).not.toHaveBeenCalled();
      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        undefined,
        ["INBOX"],
      );
    });

    it("appends removeLabel to the removal list", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
        labelIds: ["INBOX", "Label_42"],
      } as any);
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      await archiveEmail({
        id: MSG_ID,
        ownerEmail: OWNER,
        removeLabel: "Label_42",
      });

      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        undefined,
        ["INBOX", "Label_42"],
      );
    });

    it("falls through to next account when first account fails", async () => {
      mockConnected(true);
      vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
        {
          accountId: "bad@example.com",
          owner: OWNER,
          tokens: {
            access_token: "bad-token",
            expiry_date: Date.now() + 3600_000,
          },
        },
        {
          accountId: ACCT,
          owner: OWNER,
          tokens: {
            access_token: ACCESS_TOKEN,
            expiry_date: Date.now() + 3600_000,
          },
        },
      ] as any);
      vi.mocked(getOAuthTokens).mockResolvedValue({
        access_token: ACCESS_TOKEN,
        expiry_date: Date.now() + 3600_000,
      } as any);
      vi.mocked(gmailGetMessage)
        .mockRejectedValueOnce(new Error("Not Found"))
        .mockResolvedValueOnce({
          threadId: THREAD_ID,
          labelIds: ["INBOX"],
        } as any);
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      const result = await archiveEmail({ id: MSG_ID, ownerEmail: OWNER });
      expect(result.isArchived).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// unarchiveEmail
// ---------------------------------------------------------------------------

describe("unarchiveEmail", () => {
  describe("local mode", () => {
    it("unarchives entire thread and adds inbox label", async () => {
      mockConnected(false);
      const emails = makeLocalEmails().map((e) => ({
        ...e,
        isArchived: true,
        labelIds: [],
      }));
      mockLocalEmails(emails);

      const result = await unarchiveEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isArchived: false,
      });
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      const updated = (written as any).emails;
      expect(updated.every((e: any) => !e.isArchived)).toBe(true);
      expect(updated.every((e: any) => e.labelIds.includes("inbox"))).toBe(
        true,
      );
    });
  });

  describe("Gmail mode", () => {
    it("adds INBOX label and invalidates thread cache", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      const result = await unarchiveEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isArchived: false,
      });
      expect(gmailModifyThread).toHaveBeenCalledWith(ACCESS_TOKEN, THREAD_ID, [
        "INBOX",
      ]);
      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, THREAD_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// toggleStar
// ---------------------------------------------------------------------------

describe("toggleStar", () => {
  describe("local mode", () => {
    it("sets isStarred on the target message", async () => {
      mockConnected(false);
      mockLocalEmails();

      const result = await toggleStar({
        id: MSG_ID,
        ownerEmail: OWNER,
        isStarred: true,
      });

      expect(result.isStarred).toBe(true);
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      expect(
        (written as any).emails.find((e: any) => e.id === MSG_ID).isStarred,
      ).toBe(true);
    });
  });

  describe("Gmail mode", () => {
    it("adds STARRED label when starring", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);

      const result = await toggleStar({
        id: MSG_ID,
        ownerEmail: OWNER,
        isStarred: true,
      });

      expect(result.isStarred).toBe(true);
      expect(gmailModifyMessage).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        MSG_ID,
        ["STARRED"],
        undefined,
      );
    });

    it("removes STARRED label when unstarring", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);

      await toggleStar({ id: MSG_ID, ownerEmail: OWNER, isStarred: false });

      expect(gmailModifyMessage).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        MSG_ID,
        undefined,
        ["STARRED"],
      );
    });

    it("invalidates thread cache after star toggle", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);

      await toggleStar({ id: MSG_ID, ownerEmail: OWNER, isStarred: true });

      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, THREAD_ID);
    });

    it("uses hint threadId for cache invalidation without extra fetch", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({} as any);

      await toggleStar({
        id: MSG_ID,
        ownerEmail: OWNER,
        isStarred: true,
        threadId: "hint-thread",
      });

      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, "hint-thread");
    });
  });
});

// ---------------------------------------------------------------------------
// trashEmail
// ---------------------------------------------------------------------------

describe("trashEmail", () => {
  describe("local mode", () => {
    it("marks entire thread as trashed and clears isArchived", async () => {
      mockConnected(false);
      const emails = makeLocalEmails().map((e) => ({ ...e, isArchived: true }));
      mockLocalEmails(emails);

      const result = await trashEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isTrashed: true,
      });
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      const updated = (written as any).emails;
      expect(updated.every((e: any) => e.isTrashed)).toBe(true);
      expect(updated.every((e: any) => !e.isArchived)).toBe(true);
    });

    it("recomputes label counts after trash", async () => {
      mockConnected(false);
      mockLocalEmails();

      await trashEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(
        vi.mocked(putUserSetting).mock.calls.some(([, k]) => k === "labels"),
      ).toBe(true);
    });
  });

  describe("Gmail mode", () => {
    it("fetches threadId and calls gmailTrashThread, invalidates cache", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);
      vi.mocked(gmailTrashThread).mockResolvedValue({} as any);

      const result = await trashEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isTrashed: true,
      });
      expect(gmailTrashThread).toHaveBeenCalledWith(ACCESS_TOKEN, THREAD_ID);
      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, THREAD_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// untrashEmail
// ---------------------------------------------------------------------------

describe("untrashEmail", () => {
  describe("local mode", () => {
    it("clears isTrashed and restores inbox label on entire thread", async () => {
      mockConnected(false);
      const emails = makeLocalEmails().map((e) => ({
        ...e,
        isTrashed: true,
        labelIds: [],
      }));
      mockLocalEmails(emails);

      const result = await untrashEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isTrashed: false,
      });
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      const updated = (written as any).emails;
      expect(updated.every((e: any) => !e.isTrashed)).toBe(true);
      expect(updated.every((e: any) => e.labelIds.includes("inbox"))).toBe(
        true,
      );
    });
  });

  describe("Gmail mode", () => {
    it("calls gmailUntrashThread and invalidates cache", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);
      vi.mocked(gmailUntrashThread).mockResolvedValue({} as any);

      const result = await untrashEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isTrashed: false,
      });
      expect(gmailUntrashThread).toHaveBeenCalledWith(ACCESS_TOKEN, THREAD_ID);
      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, THREAD_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// markRead
// ---------------------------------------------------------------------------

describe("markRead", () => {
  describe("local mode", () => {
    it("updates isRead on the target message", async () => {
      mockConnected(false);
      mockLocalEmails();

      const result = await markRead({
        id: MSG_ID,
        ownerEmail: OWNER,
        isRead: true,
      });

      expect(result).toEqual({ id: MSG_ID, isRead: true });
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      expect(
        (written as any).emails.find((e: any) => e.id === MSG_ID).isRead,
      ).toBe(true);
    });

    it("recomputes label unread counts after mark read", async () => {
      mockConnected(false);
      mockLocalEmails();

      await markRead({ id: MSG_ID, ownerEmail: OWNER, isRead: true });

      expect(
        vi.mocked(putUserSetting).mock.calls.some(([, k]) => k === "labels"),
      ).toBe(true);
    });

    it("marks as unread when isRead=false", async () => {
      mockConnected(false);
      const emails = makeLocalEmails().map((e) => ({ ...e, isRead: true }));
      mockLocalEmails(emails);

      const result = await markRead({
        id: MSG_ID,
        ownerEmail: OWNER,
        isRead: false,
      });

      expect(result.isRead).toBe(false);
    });
  });

  describe("Gmail mode", () => {
    it("adds UNREAD label when marking unread", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({} as any);

      await markRead({ id: MSG_ID, ownerEmail: OWNER, isRead: false });

      expect(gmailModifyMessage).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        MSG_ID,
        ["UNREAD"],
        undefined,
      );
    });

    it("removes UNREAD label when marking read", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({} as any);

      await markRead({ id: MSG_ID, ownerEmail: OWNER, isRead: true });

      expect(gmailModifyMessage).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        MSG_ID,
        undefined,
        ["UNREAD"],
      );
    });
  });
});

describe("markAllLocalUnreadRead", () => {
  it("updates every non-protected unread message in one local write and verifies", async () => {
    let emails = [
      ...makeLocalEmails().map((email) => ({ ...email, isRead: false })),
      {
        ...makeLocalEmails()[0],
        id: "msg-protected",
        threadId: "thread-protected",
        isRead: false,
      },
    ];
    vi.mocked(getUserSetting).mockImplementation(async (_owner, key) => {
      if (key === "local-emails") return { emails } as any;
      if (key === "labels") {
        return {
          labels: [
            { id: "inbox", name: "Inbox", unreadCount: 3, totalCount: 3 },
          ],
        } as any;
      }
      return undefined;
    });
    vi.mocked(putUserSetting).mockImplementation(async (_owner, key, value) => {
      if (key === "local-emails") emails = (value as any).emails;
    });

    const result = await markAllLocalUnreadRead({
      ownerEmail: OWNER,
      accountEmail: OWNER,
      excludeThreadIds: ["thread-protected"],
    });

    expect(
      vi
        .mocked(putUserSetting)
        .mock.calls.filter(([, key]) => key === "local-emails"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(putUserSetting)
        .mock.calls.filter(([, key]) => key === "labels"),
    ).toHaveLength(1);
    expect(result).toMatchObject({
      matchedMessages: 3,
      matchedThreads: 2,
      excludedMessages: 1,
      excludedThreads: 1,
      changedMessages: 2,
      batchCount: 1,
      remainingUnreadMessages: 1,
      remainingUnreadThreads: 1,
      remainingProtectedMessages: 1,
      unexpectedUnreadMessages: 0,
      verificationComplete: true,
    });
  });

  it("rejects a different account before reading local mail", async () => {
    await expect(
      markAllLocalUnreadRead({
        ownerEmail: OWNER,
        accountEmail: ACCT,
        excludeThreadIds: [],
      }),
    ).rejects.toThrow("authenticated owner account");

    expect(getUserSetting).not.toHaveBeenCalled();
    expect(putUserSetting).not.toHaveBeenCalled();
  });

  it("serializes a concurrent external local-mail writer so neither update is lost", async () => {
    let emails = makeLocalEmails().map((email) => ({
      ...email,
      isRead: false,
      isStarred: false,
    }));
    let releaseBulkWrite!: () => void;
    const bulkWriteBlocked = new Promise<void>((resolve) => {
      releaseBulkWrite = resolve;
    });
    let signalBulkWrite!: () => void;
    const bulkWriteStarted = new Promise<void>((resolve) => {
      signalBulkWrite = resolve;
    });
    let localEmailWrites = 0;

    vi.mocked(isConnected).mockResolvedValue(false);
    vi.mocked(getUserSetting).mockImplementation(async (_owner, key) => {
      if (key === "local-emails") return { emails } as any;
      if (key === "labels") return { labels: [] } as any;
      return undefined;
    });
    vi.mocked(putUserSetting).mockImplementation(async (_owner, key, value) => {
      if (key !== "local-emails") return;
      localEmailWrites += 1;
      if (localEmailWrites === 1) {
        signalBulkWrite();
        await bulkWriteBlocked;
      }
      emails = (value as any).emails;
    });

    const bulk = markAllLocalUnreadRead({
      ownerEmail: OWNER,
      accountEmail: OWNER,
      excludeThreadIds: [],
    });
    await bulkWriteStarted;
    const externalSend = withLocalEmailMutationLock(OWNER, async () => {
      const current = await readLocalEmails(OWNER);
      current.push({
        ...makeLocalEmails()[0],
        id: "msg-concurrent-send",
        threadId: "thread-concurrent-send",
        isRead: true,
        isSent: true,
        from: { name: "Owner", email: OWNER },
        to: [{ name: "Recipient", email: "recipient@example.com" }],
        subject: "Concurrent send",
        snippet: "Concurrent send",
        body: "Concurrent send",
      });
      await writeLocalEmails(OWNER, current);
    });
    await Promise.resolve();

    expect(localEmailWrites).toBe(1);
    releaseBulkWrite();
    const [bulkResult] = await Promise.all([bulk, externalSend]);

    expect(bulkResult.verificationComplete).toBe(true);
    expect(emails.find((email) => email.id === MSG_ID)).toMatchObject({
      isRead: true,
    });
    expect(emails.map((email) => email.id)).toContain("msg-concurrent-send");
  });

  it("releases the local mutation lock after a failed write", async () => {
    let emails = makeLocalEmails();
    let localEmailWrites = 0;
    vi.mocked(isConnected).mockResolvedValue(false);
    vi.mocked(getUserSetting).mockImplementation(async (_owner, key) => {
      if (key === "local-emails") return { emails } as any;
      if (key === "labels") return { labels: [] } as any;
      return undefined;
    });
    vi.mocked(putUserSetting).mockImplementation(async (_owner, key, value) => {
      if (key !== "local-emails") return;
      localEmailWrites += 1;
      if (localEmailWrites === 1) throw new Error("write failed");
      emails = (value as any).emails;
    });

    const failedBulk = markAllLocalUnreadRead({
      ownerEmail: OWNER,
      accountEmail: OWNER,
      excludeThreadIds: [],
    });
    const queuedStar = toggleStar({
      id: MSG_ID,
      ownerEmail: OWNER,
      isStarred: true,
    });

    await expect(failedBulk).rejects.toThrow("write failed");
    await expect(queuedStar).resolves.toMatchObject({ isStarred: true });
    expect(emails.find((email) => email.id === MSG_ID)?.isStarred).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markThreadRead
// ---------------------------------------------------------------------------

describe("markThreadRead", () => {
  describe("local mode", () => {
    it("sets isRead on all thread messages and recomputes label counts", async () => {
      mockConnected(false);
      mockLocalEmails();

      const result = await markThreadRead({
        threadId: THREAD_ID,
        ownerEmail: OWNER,
        isRead: true,
      });

      expect(result).toEqual({ threadId: THREAD_ID, isRead: true });
      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, k]) => k === "local-emails")!;
      const updated = (written as any).emails;
      expect(updated.every((e: any) => e.isRead)).toBe(true);
    });

    it("skips write when no messages change", async () => {
      mockConnected(false);
      const emails = makeLocalEmails().map((e) => ({ ...e, isRead: true }));
      mockLocalEmails(emails);

      await markThreadRead({
        threadId: THREAD_ID,
        ownerEmail: OWNER,
        isRead: true,
      });

      // No write calls needed since nothing changed
      expect(
        vi
          .mocked(putUserSetting)
          .mock.calls.filter(([, k]) => k === "local-emails"),
      ).toHaveLength(0);
    });
  });

  describe("Gmail mode", () => {
    it("calls gmailModifyThread and invalidates cache", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      const result = await markThreadRead({
        threadId: THREAD_ID,
        ownerEmail: OWNER,
        isRead: true,
      });

      expect(result).toEqual({ threadId: THREAD_ID, isRead: true });
      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        undefined,
        ["UNREAD"],
      );
      expect(invalidateThreadCache).toHaveBeenCalledWith(OWNER, THREAD_ID);
    });

    it("adds UNREAD label when marking thread unread", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      await markThreadRead({
        threadId: THREAD_ID,
        ownerEmail: OWNER,
        isRead: false,
      });

      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        ["UNREAD"],
        undefined,
      );
    });
  });
});
