import { beforeEach, describe, expect, it, vi } from "vitest";

const localStoreMocks = vi.hoisted(() => ({
  locks: new Map<string, Promise<unknown>>(),
  readLocalEmails: vi.fn(),
  writeLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
}));

const inboxStoreSyncMocks = vi.hoisted(() => ({
  syncInboxLabelDelta: vi.fn(),
}));

const inboxStoreMocks = vi.hoisted(() => ({
  findThreadIdsByMessageIds: vi.fn(),
  findAccountForThread: vi.fn(),
  findAccountForMessage: vi.fn(),
}));

import {
  archiveEmail,
  unarchiveEmail,
  toggleStar,
  trashEmail,
  untrashEmail,
  markAllLocalUnreadRead,
  markRead,
  markThreadRead,
  resolveMutationAccounts,
  resolveMutationAccount,
  MutationAccountNotFoundError,
  MutationAccountLookupError,
  resolveAccountEmail,
  getAccountToken,
} from "./email-state.js";

vi.mock("@agent-native/core/settings", () => ({
  getSettingsEmitter: () => ({ emit: vi.fn() }),
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
  gmailBatchGetMessages: vi.fn(),
  gmailBatchGetThreads: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
  registerGmailAccountToken: vi.fn(),
  gmailTrashThread: vi.fn(),
}));

vi.mock("./google-auth.js", () => ({
  isConnected: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
  getClientForConnectedAccount: vi.fn(),
}));

vi.mock("./local-email-store.js", () => ({
  readLocalEmails: localStoreMocks.readLocalEmails,
  writeLocalEmails: localStoreMocks.writeLocalEmails,
  withLocalEmailMutationLock: localStoreMocks.withLocalEmailMutationLock,
}));

vi.mock("./thread-cache.js", () => ({
  invalidateThreadCache: vi.fn(),
  threadMessagesCache: new Map(),
  threadCacheKey: vi.fn((o: string, t: string) => `${o}:${t}`),
  THREAD_CACHE_TTL: 300_000,
}));

vi.mock("./inbox-store-sync.js", () => ({
  syncInboxLabelDelta: inboxStoreSyncMocks.syncInboxLabelDelta,
}));

vi.mock("./inbox-store.js", () => ({
  findThreadIdsByMessageIds: inboxStoreMocks.findThreadIdsByMessageIds,
  findAccountForThread: inboxStoreMocks.findAccountForThread,
  findAccountForMessage: inboxStoreMocks.findAccountForMessage,
}));

import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import {
  gmailGetMessage,
  gmailBatchGetMessages,
  gmailBatchGetThreads,
  gmailModifyMessage,
  gmailModifyThread,
  gmailTrashThread,
} from "./google-api.js";
import {
  getClientForConnectedAccount,
  getConnectedAccountsWithErrors,
  isConnected,
} from "./google-auth.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";
import { invalidateThreadCache } from "./thread-cache.js";

const OWNER = "owner@example.com";
const ACCT = "connected@example.com";
const ACCT2 = "connected2@example.com";
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

function mockTwoAccounts() {
  vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
    {
      accountId: ACCT,
      owner: OWNER,
      tokens: {
        access_token: ACCESS_TOKEN,
        expiry_date: Date.now() + 3600_000,
      },
    },
    {
      accountId: ACCT2,
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

function mockManaged(email = ACCT) {
  vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([]);
  vi.mocked(getConnectedAccountsWithErrors).mockResolvedValue({
    accounts: [email],
    errors: [],
  });
  vi.mocked(getClientForConnectedAccount).mockImplementation(
    async (_owner, accountEmail) =>
      accountEmail.toLowerCase() === email.toLowerCase()
        ? { accessToken: ACCESS_TOKEN, email }
        : null,
  );
}

function mockLocalEmails(
  emails = makeLocalEmails(),
  labels = [{ id: "inbox", name: "Inbox", unreadCount: 1, totalCount: 2 }],
) {
  vi.mocked(getUserSetting).mockImplementation(async (_owner, key) => {
    if (key === "local-emails") return { emails } as any;
    if (key === "labels") return { labels } as any;
    return undefined;
  });
  vi.mocked(putUserSetting).mockResolvedValue(undefined as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStoreMocks.locks.clear();
  localStoreMocks.readLocalEmails.mockImplementation(async (ownerEmail) => {
    const data = await getUserSetting(ownerEmail, "local-emails");
    return data && Array.isArray((data as any).emails)
      ? (data as any).emails
      : [];
  });
  localStoreMocks.writeLocalEmails.mockImplementation(
    async (ownerEmail, emails) => {
      await putUserSetting(ownerEmail, "local-emails", { emails });
    },
  );
  localStoreMocks.withLocalEmailMutationLock.mockImplementation(
    (ownerEmail, mutate) => {
      const key = ownerEmail.toLowerCase();
      const previous = localStoreMocks.locks.get(key) ?? Promise.resolve();
      const next = previous.then(mutate, mutate);
      localStoreMocks.locks.set(key, next);
      next.then(
        () => {
          if (localStoreMocks.locks.get(key) === next)
            localStoreMocks.locks.delete(key);
        },
        () => {
          if (localStoreMocks.locks.get(key) === next)
            localStoreMocks.locks.delete(key);
        },
      );
      return next;
    },
  );
  inboxStoreSyncMocks.syncInboxLabelDelta.mockResolvedValue(undefined);
  inboxStoreMocks.findThreadIdsByMessageIds.mockResolvedValue(new Map());
  inboxStoreMocks.findAccountForThread.mockResolvedValue(null);
  inboxStoreMocks.findAccountForMessage.mockResolvedValue(null);
  // By default the connected list is the owner's OAuth grants; managed tests
  // override it.
  vi.mocked(getConnectedAccountsWithErrors).mockImplementation((async (
    owner: string,
  ) => ({
    accounts: (await listOAuthAccountsByOwner("google", owner)).map(
      (account) => account.accountId,
    ),
    errors: [],
  })) as any);
});

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

    it("keeps archived user-label counts mailbox-wide", async () => {
      mockConnected(false);
      mockLocalEmails(
        makeLocalEmails().map((email) => ({
          ...email,
          labelIds: ["inbox", "github"],
        })),
        [
          { id: "inbox", name: "Inbox", unreadCount: 1, totalCount: 2 },
          { id: "github", name: "Github", unreadCount: 1, totalCount: 2 },
        ],
      );

      await archiveEmail({ id: MSG_ID, ownerEmail: OWNER });

      const [, , written] = vi
        .mocked(putUserSetting)
        .mock.calls.find(([, key]) => key === "labels")!;
      const github = (written as any).labels.find(
        (label: any) => label.id === "github",
      );
      expect(github).toMatchObject({ unreadCount: 1, totalCount: 2 });
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

      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
        ACCT,
      );
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
      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
        ACCT,
      );
    });
  });
});

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

      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
        ACCT,
      );
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

      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        "hint-thread",
        ACCT,
      );
    });

    it("mirrors the store with message scope, not thread scope (only this message starred)", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);

      await toggleStar({ id: MSG_ID, ownerEmail: OWNER, isStarred: true });

      expect(inboxStoreSyncMocks.syncInboxLabelDelta).toHaveBeenCalledWith(
        OWNER,
        ACCT,
        [THREAD_ID],
        expect.objectContaining({ scope: "message", messageIds: [MSG_ID] }),
      );
    });
  });
});

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
      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
        ACCT,
      );
    });
  });
});

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
    it("restores the Gmail thread to Inbox and clears Trash", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailGetMessage).mockResolvedValue({
        threadId: THREAD_ID,
      } as any);
      vi.mocked(gmailModifyThread).mockResolvedValue({
        historyId: "history-1",
      } as any);

      const result = await untrashEmail({ id: MSG_ID, ownerEmail: OWNER });

      expect(result).toEqual({
        id: MSG_ID,
        threadId: THREAD_ID,
        isTrashed: false,
      });
      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        ["INBOX"],
        ["TRASH"],
      );
      expect(inboxStoreSyncMocks.syncInboxLabelDelta).toHaveBeenCalledWith(
        OWNER,
        ACCT,
        [THREAD_ID],
        {
          add: ["INBOX"],
          remove: ["TRASH"],
          providerHistoryId: "history-1",
        },
      );
      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
        ACCT,
      );
    });
  });
});

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

    it("mirrors the store with message scope, not thread scope (only this message read)", async () => {
      mockConnected(true);
      mockAccounts();
      vi.mocked(gmailModifyMessage).mockResolvedValue({} as any);
      inboxStoreMocks.findThreadIdsByMessageIds.mockResolvedValue(
        new Map([[MSG_ID, THREAD_ID]]),
      );

      await markRead({ id: MSG_ID, ownerEmail: OWNER, isRead: true });

      expect(inboxStoreSyncMocks.syncInboxLabelDelta).toHaveBeenCalledWith(
        OWNER,
        ACCT,
        [THREAD_ID],
        expect.objectContaining({ scope: "message", messageIds: [MSG_ID] }),
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
      expect(invalidateThreadCache).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
        ACCT,
      );
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

    it("resolves the account from the synced store when accountEmail is omitted", async () => {
      mockConnected(true);
      mockTwoAccounts();
      inboxStoreMocks.findAccountForThread.mockResolvedValue(ACCT2);
      vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

      const result = await markThreadRead({
        threadId: THREAD_ID,
        ownerEmail: OWNER,
        isRead: true,
      });

      expect(inboxStoreMocks.findAccountForThread).toHaveBeenCalledWith(
        OWNER,
        THREAD_ID,
      );
      expect(result).toEqual({ threadId: THREAD_ID, isRead: true });
      expect(gmailModifyThread).toHaveBeenCalledWith(
        ACCESS_TOKEN,
        THREAD_ID,
        undefined,
        ["UNREAD"],
      );
    });

    it("falls back to the owner's sole connected account when the store has no hit", async () => {
      mockConnected(true);
      mockAccounts();
      inboxStoreMocks.findAccountForThread.mockResolvedValue(null);
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
    });

    it("throws a clear error for an unknown thread with multiple connected accounts", async () => {
      mockConnected(true);
      mockTwoAccounts();
      inboxStoreMocks.findAccountForThread.mockResolvedValue(null);
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        _token: string,
        ids: string[],
      ) =>
        ids.map((id) => ({
          id,
          data: null,
          error: "HTTP 404 not found",
        }))) as any);

      await expect(
        markThreadRead({
          threadId: THREAD_ID,
          ownerEmail: OWNER,
          isRead: true,
        }),
      ).rejects.toThrow(
        `Cannot determine which connected account owns thread ${THREAD_ID}; pass accountEmail`,
      );
      expect(gmailModifyThread).not.toHaveBeenCalled();
    });
  });
});

describe("resolveMutationAccounts", () => {
  it("passes an explicit accountEmail through without a store lookup", async () => {
    const { resolved, unresolved } = await resolveMutationAccounts(OWNER, [
      { id: "m1", accountEmail: ACCT },
    ]);

    expect(resolved).toEqual([{ id: "m1", accountEmail: ACCT }]);
    expect(unresolved).toEqual([]);
    expect(inboxStoreMocks.findAccountForThread).not.toHaveBeenCalled();
    expect(inboxStoreMocks.findAccountForMessage).not.toHaveBeenCalled();
  });

  it("resolves a missing accountEmail from the store via threadId", async () => {
    inboxStoreMocks.findAccountForThread.mockResolvedValue(ACCT2);

    const { resolved } = await resolveMutationAccounts(OWNER, [
      { id: "m1", threadId: THREAD_ID },
    ]);

    expect(resolved).toEqual([
      { id: "m1", threadId: THREAD_ID, accountEmail: ACCT2 },
    ]);
  });

  it("resolves a missing accountEmail from the store via message id", async () => {
    inboxStoreMocks.findAccountForMessage.mockResolvedValue(ACCT2);

    const { resolved } = await resolveMutationAccounts(OWNER, [{ id: "m1" }]);

    expect(resolved).toEqual([{ id: "m1", accountEmail: ACCT2 }]);
  });

  it("falls back to the owner's sole connected account when the store has no hit", async () => {
    mockAccounts();

    const { resolved } = await resolveMutationAccounts(OWNER, [{ id: "m1" }]);

    expect(resolved).toEqual([{ id: "m1", accountEmail: ACCT }]);
  });

  it("reports (never guesses) a target that can't be resolved with multiple connected accounts", async () => {
    mockTwoAccounts();

    const { resolved, unresolved } = await resolveMutationAccounts(OWNER, [
      { id: "m1" },
    ]);

    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([
      {
        id: "m1",
        error: expect.stringContaining(
          "Cannot determine which connected account",
        ),
      },
    ]);
  });

  describe("after the store has purged the archived row", () => {
    const notFound = (id: string) => ({
      id,
      data: null,
      error: "HTTP 404 not found",
    });

    function tokensPerAccount() {
      mockTwoAccounts();
      vi.mocked(getOAuthTokens).mockImplementation((async (
        _provider: string,
        accountId: string,
      ) => ({
        access_token: `token-${accountId}`,
        expiry_date: Date.now() + 3600_000,
      })) as any);
    }

    it("finds the owning account with one minimal batch read per account", async () => {
      tokensPerAccount();
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        token: string,
        ids: string[],
      ) =>
        ids.map((id) =>
          token === `token-${ACCT}` ? notFound(id) : { id, data: { id } },
        )) as any);

      const { resolved } = await resolveMutationAccounts(OWNER, [
        { id: "m1", threadId: THREAD_ID },
      ]);

      expect(resolved).toEqual([
        { id: "m1", threadId: THREAD_ID, accountEmail: ACCT2 },
      ]);
      expect(vi.mocked(gmailBatchGetThreads).mock.calls).toEqual([
        [`token-${ACCT}`, [THREAD_ID], "minimal"],
        [`token-${ACCT2}`, [THREAD_ID], "minimal"],
      ]);
    });

    it("finds the owning account for a bare message id", async () => {
      tokensPerAccount();
      vi.mocked(gmailBatchGetMessages).mockImplementation((async (
        token: string,
        ids: string[],
      ) =>
        ids.map((id) =>
          token === `token-${ACCT2}` ? { id, data: { id } } : notFound(id),
        )) as any);

      await expect(
        resolveMutationAccount(OWNER, undefined, { messageId: "m1" }),
      ).resolves.toBe(ACCT2);
      expect(vi.mocked(gmailBatchGetMessages)).toHaveBeenCalledWith(
        `token-${ACCT2}`,
        ["m1"],
        "minimal",
      );
    });

    it("probes a managed workspace connection too, not only OAuth accounts", async () => {
      const MANAGED = "managed@example.com";
      mockAccounts();
      vi.mocked(getConnectedAccountsWithErrors).mockResolvedValue({
        accounts: [ACCT, MANAGED],
        errors: [],
      });
      vi.mocked(getOAuthTokens).mockImplementation((async (
        _provider: string,
        accountId: string,
      ) =>
        accountId === ACCT
          ? {
              access_token: "token-oauth",
              expiry_date: Date.now() + 3600_000,
            }
          : undefined) as any);
      vi.mocked(getClientForConnectedAccount).mockImplementation((async (
        _owner: string,
        account: string,
      ) =>
        account === MANAGED
          ? { accessToken: "token-managed", email: MANAGED }
          : null) as any);
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        token: string,
        ids: string[],
      ) =>
        ids.map((id) =>
          token === "token-managed" ? { id, data: { id } } : notFound(id),
        )) as any);

      const { resolved } = await resolveMutationAccounts(OWNER, [
        { id: "m1", threadId: THREAD_ID },
      ]);

      expect(resolved).toEqual([
        { id: "m1", threadId: THREAD_ID, accountEmail: MANAGED },
      ]);
    });

    it("never maps a thread to the sole OAuth account when a managed one also exists", async () => {
      mockAccounts();
      vi.mocked(getConnectedAccountsWithErrors).mockResolvedValue({
        accounts: [ACCT, "managed@example.com"],
        errors: [],
      });
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        _token: string,
        ids: string[],
      ) => ids.map(notFound)) as any);

      const error = await resolveMutationAccount(OWNER, undefined, {
        threadId: THREAD_ID,
      }).catch((err) => err);

      expect(error).toBeInstanceOf(MutationAccountNotFoundError);
    });

    it("resolves a 50-target batch with one batch read per account and leaves nothing unbounded", async () => {
      tokensPerAccount();
      const ids = Array.from({ length: 50 }, (_, index) => `t${index}`);
      // The first account owns the even threads, the second the odd ones.
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        token: string,
        requested: string[],
      ) =>
        requested.map((id) => {
          const even = Number(id.slice(1)) % 2 === 0;
          const owns = token === `token-${ACCT}` ? even : !even;
          return owns ? { id, data: { id } } : notFound(id);
        })) as any);

      const { resolved, unresolved } = await resolveMutationAccounts(
        OWNER,
        ids.map((id) => ({ id: `m-${id}`, threadId: id })),
      );

      expect(unresolved).toEqual([]);
      expect(resolved.map((target) => target.accountEmail)).toEqual(
        ids.map((_, index) => (index % 2 === 0 ? ACCT : ACCT2)),
      );
      // 50 ids fit one batch per account: 2 calls, never 100 serial probes.
      expect(vi.mocked(gmailBatchGetThreads)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(gmailBatchGetThreads).mock.calls[0][1]).toHaveLength(50);
      expect(vi.mocked(gmailBatchGetThreads).mock.calls[1][1]).toHaveLength(25);
    });

    it("stops probing at the unit budget and returns typed limit errors for the rest", async () => {
      tokensPerAccount();
      const ids = Array.from({ length: 120 }, (_, index) => `t${index}`);
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        _token: string,
        requested: string[],
      ) => requested.map(notFound)) as any);

      const { unresolved } = await resolveMutationAccounts(
        OWNER,
        ids.map((id) => ({ id: `m-${id}`, threadId: id })),
      );

      // 3,000 units / 40 per thread = 75 reads in total across both accounts.
      const read = vi
        .mocked(gmailBatchGetThreads)
        .mock.calls.reduce((sum, call) => sum + call[1].length, 0);
      expect(read).toBeLessThanOrEqual(75);
      expect(unresolved).toHaveLength(120);
      expect(
        unresolved.filter((entry) => /too many lookups/.test(entry.error))
          .length,
      ).toBeGreaterThanOrEqual(120 - 75);
    });

    it("throws a typed not-found error when no account has the thread", async () => {
      tokensPerAccount();
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        _token: string,
        ids: string[],
      ) => ids.map(notFound)) as any);

      const error = await resolveMutationAccount(OWNER, undefined, {
        threadId: THREAD_ID,
      }).catch((err) => err);

      expect(error).toBeInstanceOf(MutationAccountNotFoundError);
      expect(error.code).toBe("account_not_found");
    });

    it("reports a lookup failure, not not-found, when an account cannot be checked", async () => {
      tokensPerAccount();
      vi.mocked(gmailBatchGetThreads).mockImplementation((async (
        token: string,
        ids: string[],
      ) => {
        if (token === `token-${ACCT}`) return ids.map(notFound);
        throw Object.assign(new Error("HTTP 503"), { status: 503 });
      }) as any);

      const error = await resolveMutationAccount(OWNER, undefined, {
        threadId: THREAD_ID,
      }).catch((err) => err);

      expect(error).toBeInstanceOf(MutationAccountLookupError);
      expect(error.code).toBe("account_lookup_failed");
    });
  });

  it("resolves each target independently, mixing hits and misses", async () => {
    mockTwoAccounts();
    inboxStoreMocks.findAccountForThread.mockImplementation(
      async (_owner: string, threadId: string) =>
        threadId === "known-thread" ? ACCT2 : null,
    );

    const { resolved, unresolved } = await resolveMutationAccounts(OWNER, [
      { id: "m1", threadId: "known-thread" },
      { id: "m2", threadId: "unknown-thread" },
      { id: "m3", accountEmail: ACCT },
    ]);

    expect(resolved).toEqual([
      { id: "m1", threadId: "known-thread", accountEmail: ACCT2 },
      { id: "m3", accountEmail: ACCT },
    ]);
    expect(unresolved).toEqual([{ id: "m2", error: expect.any(String) }]);
  });
});

describe("managed workspace grant (no OAuth rows)", () => {
  const MANAGED = "managed@example.com";

  it("resolveAccountEmail accepts the managed grant's email", async () => {
    mockManaged(MANAGED);

    await expect(resolveAccountEmail(MANAGED, OWNER)).resolves.toBe(MANAGED);
  });

  it("resolveAccountEmail still rejects an email that isn't the managed grant either", async () => {
    mockManaged(MANAGED);

    await expect(
      resolveAccountEmail("someone-else@example.com", OWNER),
    ).rejects.toThrow("Account not owned by current user");
  });

  it("getAccountToken falls back to the managed client's access token", async () => {
    mockManaged(MANAGED);

    await expect(getAccountToken(MANAGED, OWNER)).resolves.toBe(ACCESS_TOKEN);
  });

  it("resolveMutationAccount falls back to the managed grant when it's the owner's sole connected account", async () => {
    mockManaged(MANAGED);

    await expect(resolveMutationAccount(OWNER, undefined)).resolves.toBe(
      MANAGED,
    );
  });

  it("archiveEmail (loop path) succeeds for a managed-only account", async () => {
    mockConnected(true);
    mockManaged(MANAGED);
    vi.mocked(gmailGetMessage).mockResolvedValue({
      threadId: THREAD_ID,
      labelIds: ["INBOX"],
    } as any);
    vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

    const result = await archiveEmail({ id: MSG_ID, ownerEmail: OWNER });

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

  it("markRead (loop path) succeeds for a managed-only account", async () => {
    mockConnected(true);
    mockManaged(MANAGED);
    vi.mocked(gmailModifyMessage).mockResolvedValue({} as any);
    inboxStoreMocks.findThreadIdsByMessageIds.mockResolvedValue(
      new Map([[MSG_ID, THREAD_ID]]),
    );

    const result = await markRead({
      id: MSG_ID,
      ownerEmail: OWNER,
      isRead: true,
    });

    expect(result).toEqual({ id: MSG_ID, isRead: true });
    expect(gmailModifyMessage).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      MSG_ID,
      undefined,
      ["UNREAD"],
    );
  });

  it("untrashEmail (resolveMutationAccount + getAccountToken path) succeeds for a managed-only account", async () => {
    mockConnected(true);
    mockManaged(MANAGED);
    vi.mocked(gmailGetMessage).mockResolvedValue({
      threadId: THREAD_ID,
    } as any);
    vi.mocked(gmailModifyThread).mockResolvedValue({} as any);

    const result = await untrashEmail({ id: MSG_ID, ownerEmail: OWNER });

    expect(result).toEqual({
      id: MSG_ID,
      threadId: THREAD_ID,
      isTrashed: false,
    });
    expect(gmailModifyThread).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      THREAD_ID,
      ["INBOX"],
      ["TRASH"],
    );
  });
});

describe("shared OAuth refresh", () => {
  it("uses the connected-account single-flight resolver near token expiry", async () => {
    mockAccounts();
    vi.mocked(getOAuthTokens).mockResolvedValue({
      access_token: "expiring-token",
      expiry_date: Date.now() + 60_000,
    } as any);
    vi.mocked(getClientForConnectedAccount).mockResolvedValue({
      accessToken: "refreshed-token",
      email: ACCT,
    });

    await expect(getAccountToken(ACCT, OWNER)).resolves.toBe("refreshed-token");
    expect(getClientForConnectedAccount).toHaveBeenCalledWith(OWNER, ACCT);
  });
});
