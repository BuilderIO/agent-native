import {
  deleteOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { getOAuthAccounts } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOAuth2Client,
  gmailBatchGetThreads,
  gmailGetThread,
  gmailListMessages as gmailListMessagesApi,
  gmailListThreads,
  googleFetch,
} from "./google-api.js";
import {
  gmailBatchModifyByAccount,
  getClientsWithErrors,
  listGmailMessages,
  markAllUnreadReadForAccount,
} from "./google-auth.js";

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  hasOAuthTokens: vi.fn(),
  listOAuthAccounts: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getOAuthAccounts: vi.fn(),
  isOAuthConnected: vi.fn(),
  resolveSecret: vi.fn(async (key: string) =>
    key === "GOOGLE_CLIENT_ID" ? "client-id" : "client-secret",
  ),
  runWithRequestContext: vi.fn(async (_context, fn) => fn()),
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: vi.fn(),
  gmailBatchGetMessages: vi.fn(),
  gmailBatchGetThreads: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailGetProfile: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailListHistory: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailListMessages: vi.fn(),
  gmailListThreads: vi.fn(),
  gmailStopWatch: vi.fn(),
  gmailWatch: vi.fn(),
  googleFetch: vi.fn(),
  peopleGetProfile: vi.fn(),
}));

function mockAccount() {
  vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
    {
      accountId: "connected@example.com",
      owner: "owner@example.com",
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expiry_date: Date.now() + 60 * 60 * 1000,
      },
    },
  ] as any);
}

describe("listGmailMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccount();
    vi.mocked(gmailListMessagesApi).mockResolvedValue({ messages: [] } as any);
  });

  it("uses Gmail thread search when requested so duplicate matching messages do not consume result slots", async () => {
    vi.mocked(gmailListThreads).mockResolvedValue({
      threads: [{ id: "thread-a" }, { id: "thread-b" }],
      nextPageToken: "next-thread-page",
      resultSizeEstimate: 12,
    } as any);
    vi.mocked(gmailBatchGetThreads).mockResolvedValue([
      {
        id: "thread-a",
        data: {
          messages: [
            { id: "a1", threadId: "thread-a", internalDate: "20" },
            { id: "a2", threadId: "thread-a", internalDate: "30" },
          ],
        },
      },
      {
        id: "thread-b",
        data: {
          messages: [{ id: "b1", threadId: "thread-b", internalDate: "10" }],
        },
      },
    ] as any);

    const result = await listGmailMessages(
      "quarterly-update",
      2,
      "owner@example.com",
      undefined,
      { mode: "threads" },
    );

    expect(gmailListMessagesApi).not.toHaveBeenCalled();
    expect(gmailListThreads).toHaveBeenCalledWith("access-token", {
      q: "quarterly-update",
      maxResults: 2,
      pageToken: undefined,
    });
    expect(gmailBatchGetThreads).toHaveBeenCalledWith(
      "access-token",
      ["thread-a", "thread-b"],
      "full",
    );
    expect(result.messages.map((m) => m.id)).toEqual(["a1", "a2", "b1"]);
    expect(
      result.messages.every((m) => m._accountEmail === "connected@example.com"),
    ).toBe(true);
    expect(result.nextPageTokens).toEqual({
      "connected@example.com": "next-thread-page",
    });
    expect(result.resultSizeEstimate).toBe(12);
  });

  it("keeps a four-account metadata inventory to eight provider reads", async () => {
    const accounts = ["a", "b", "c", "d"].map((name) => ({
      accountId: `${name}@example.com`,
      owner: "owner@example.com",
      tokens: {
        access_token: `${name}-token`,
        refresh_token: `${name}-refresh`,
        expiry_date: Date.now() + 60 * 60 * 1000,
      },
    }));
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue(accounts as any);
    vi.mocked(gmailListThreads).mockImplementation(async (token: string) => ({
      threads: [{ id: `${token}-thread` }],
    }));
    vi.mocked(gmailBatchGetThreads).mockImplementation(
      async (_token: string, ids: string[]) =>
        ids.map((id) => ({
          id,
          data: { messages: [{ id: `${id}-message`, threadId: id }] },
        })) as any,
    );

    const result = await listGmailMessages(
      "in:inbox",
      10,
      "owner@example.com",
      undefined,
      {
        mode: "threads",
        threadFormat: "metadata",
        accountEmails: accounts.map((account) => account.accountId),
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.messages).toHaveLength(4);
    expect(gmailListThreads).toHaveBeenCalledTimes(4);
    expect(gmailBatchGetThreads).toHaveBeenCalledTimes(4);
    expect(
      vi
        .mocked(gmailBatchGetThreads)
        .mock.calls.every(([, , format]) => format === "metadata"),
    ).toBe(true);
    expect(gmailListMessagesApi).not.toHaveBeenCalled();
  });

  it("uses recent message candidates so old inbox threads with fresh replies can lead normal pages", async () => {
    vi.mocked(gmailListThreads).mockResolvedValue({
      threads: [{ id: "thread-old" }, { id: "thread-other" }],
      nextPageToken: "next-thread-page",
    } as any);
    vi.mocked(gmailListMessagesApi).mockResolvedValue({
      messages: [
        { id: "recent-message", threadId: "thread-recent" },
        { id: "old-message", threadId: "thread-old" },
      ],
    } as any);
    vi.mocked(gmailBatchGetThreads).mockResolvedValue([
      {
        id: "thread-recent",
        data: {
          messages: [{ id: "recent-full", threadId: "thread-recent" }],
        },
      },
      {
        id: "thread-old",
        data: {
          messages: [{ id: "old-full", threadId: "thread-old" }],
        },
      },
    ] as any);

    const result = await listGmailMessages(
      "in:inbox -in:sent",
      2,
      "recent-owner@example.com",
      undefined,
      { mode: "threads", threadRecentMessageCandidateLimit: 5 },
    );

    expect(gmailListThreads).toHaveBeenCalledWith("access-token", {
      q: "in:inbox -in:sent",
      maxResults: 2,
      pageToken: undefined,
    });
    expect(gmailListMessagesApi).toHaveBeenCalledWith("access-token", {
      q: "in:inbox -in:sent",
      maxResults: 5,
    });
    expect(gmailBatchGetThreads).toHaveBeenCalledWith(
      "access-token",
      ["thread-recent", "thread-old"],
      "full",
    );
    expect(result.messages.map((m) => m.id)).toEqual([
      "recent-full",
      "old-full",
    ]);
    expect(result.nextPageTokens?.["connected@example.com"]).toMatch(
      /^__an_thread_candidates__:/,
    );
  });

  it("hydrates recently modified matching threads even when Gmail lists them deep in the search page", async () => {
    const threads = Array.from({ length: 60 }, (_, index) => ({
      id: `thread-${index + 1}`,
      historyId: String(index + 1),
    }));
    threads[59] = { id: "thread-slack-marketplace", historyId: "999" };
    const candidateMetadata = threads.map((thread, index) => ({
      id: thread.id,
      data: {
        messages: [
          {
            id: `meta-${thread.id}`,
            threadId: thread.id,
            internalDate:
              thread.id === "thread-slack-marketplace"
                ? "999"
                : String(index + 1),
          },
        ],
      },
    }));
    vi.mocked(gmailListThreads).mockResolvedValue({ threads } as any);
    vi.mocked(gmailBatchGetThreads)
      .mockResolvedValueOnce(candidateMetadata as any)
      .mockResolvedValueOnce([
        {
          id: "thread-slack-marketplace",
          data: {
            messages: [
              {
                id: "slack-latest",
                threadId: "thread-slack-marketplace",
                internalDate: "999",
              },
            ],
          },
        },
        {
          id: "thread-59",
          data: {
            messages: [{ id: "other-latest", threadId: "thread-59" }],
          },
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "thread-58",
          data: {
            messages: [{ id: "next-a", threadId: "thread-58" }],
          },
        },
        {
          id: "thread-57",
          data: {
            messages: [{ id: "next-b", threadId: "thread-57" }],
          },
        },
      ] as any);

    const result = await listGmailMessages(
      "slack",
      2,
      "owner@example.com",
      undefined,
      { mode: "threads", threadCandidateLimit: 100 },
    );

    expect(gmailListThreads).toHaveBeenCalledWith("access-token", {
      q: "slack",
      maxResults: 100,
      pageToken: undefined,
    });
    expect(gmailBatchGetThreads).toHaveBeenNthCalledWith(
      1,
      "access-token",
      [
        "thread-slack-marketplace",
        ...Array.from({ length: 59 }, (_, index) => `thread-${59 - index}`),
      ],
      "metadata",
    );
    expect(gmailBatchGetThreads).toHaveBeenNthCalledWith(
      2,
      "access-token",
      ["thread-slack-marketplace", "thread-59"],
      "full",
    );
    expect(result.messages.map((m) => m.id)).toEqual([
      "slack-latest",
      "other-latest",
    ]);
    const nextToken = result.nextPageTokens?.["connected@example.com"];
    expect(nextToken).toMatch(/^__an_thread_candidates__:/);

    const nextResult = await listGmailMessages(
      "slack",
      2,
      "owner@example.com",
      { "connected@example.com": nextToken! },
      { mode: "threads", threadCandidateLimit: 100 },
    );

    expect(gmailListThreads).toHaveBeenCalledTimes(1);
    expect(gmailBatchGetThreads).toHaveBeenLastCalledWith(
      "access-token",
      ["thread-58", "thread-57"],
      "full",
    );
    expect(nextResult.messages.map((m) => m.id)).toEqual(["next-a", "next-b"]);
  });

  it("ranks search candidates by latest message time instead of history mutations", async () => {
    const threads = [
      { id: "old-label-touched", historyId: "9999" },
      { id: "recent-message", historyId: "1" },
    ];
    vi.mocked(gmailListThreads).mockResolvedValue({ threads } as any);
    vi.mocked(gmailBatchGetThreads)
      .mockResolvedValueOnce([
        {
          id: "old-label-touched",
          data: {
            messages: [
              {
                id: "old-meta",
                threadId: "old-label-touched",
                internalDate: "100",
              },
            ],
          },
        },
        {
          id: "recent-message",
          data: {
            messages: [
              {
                id: "recent-meta",
                threadId: "recent-message",
                internalDate: "900",
              },
            ],
          },
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "recent-message",
          data: {
            messages: [
              {
                id: "recent-full",
                threadId: "recent-message",
                internalDate: "900",
              },
            ],
          },
        },
      ] as any);

    const result = await listGmailMessages(
      "slack-history-mismatch",
      1,
      "owner@example.com",
      undefined,
      { mode: "threads", threadCandidateLimit: 100 },
    );

    expect(gmailBatchGetThreads).toHaveBeenNthCalledWith(
      1,
      "access-token",
      ["old-label-touched", "recent-message"],
      "metadata",
    );
    expect(gmailBatchGetThreads).toHaveBeenNthCalledWith(
      2,
      "access-token",
      ["recent-message"],
      "full",
    );
    expect(result.messages.map((m) => m.id)).toEqual(["recent-full"]);
  });

  it("limits expensive metadata ranking while keeping recent matching messages in the shortlist", async () => {
    const threads = Array.from({ length: 200 }, (_, index) => ({
      id: `thread-${index + 1}`,
      historyId: String(index + 1),
    }));
    vi.mocked(gmailListThreads).mockResolvedValue({ threads } as any);
    vi.mocked(gmailListMessagesApi).mockResolvedValue({
      messages: [{ id: "message-recent", threadId: "thread-25" }],
    } as any);
    vi.mocked(gmailBatchGetThreads).mockImplementation(
      async (_accessToken, ids, format) =>
        (ids as string[]).map((id) => ({
          id,
          data: {
            messages: [
              {
                id: `${format}-${id}`,
                threadId: id,
                internalDate: id === "thread-25" ? "9999" : id.slice(7),
              },
            ],
          },
        })),
    );

    const result = await listGmailMessages(
      "slack",
      2,
      "owner@example.com",
      undefined,
      { mode: "threads", threadCandidateLimit: 500 },
    );

    const rankedIds = vi.mocked(gmailBatchGetThreads).mock.calls[0][1];
    expect(rankedIds).toHaveLength(120);
    expect(rankedIds[0]).toBe("thread-25");
    expect(rankedIds).toContain("thread-200");
    expect(rankedIds).not.toContain("thread-24");
    expect(result.messages.map((m) => m.id)).toEqual([
      "full-thread-25",
      "full-thread-200",
    ]);
  });

  it("refills missing thread batch parts before returning search results", async () => {
    vi.mocked(gmailListThreads).mockResolvedValue({
      threads: [{ id: "thread-refill" }],
    } as any);
    vi.mocked(gmailBatchGetThreads).mockResolvedValue([
      { id: "thread-refill", data: null, error: "No response part" },
    ] as any);
    vi.mocked(gmailGetThread).mockResolvedValue({
      messages: [{ id: "refilled", threadId: "thread-refill" }],
    } as any);

    const result = await listGmailMessages(
      "refill-case",
      1,
      "owner@example.com",
      undefined,
      { mode: "threads" },
    );

    expect(gmailGetThread).toHaveBeenCalledWith(
      "access-token",
      "thread-refill",
      "full",
    );
    expect(result.messages.map((m) => m.id)).toEqual(["refilled"]);
  });

  it("marks an account failed when missing thread metadata cannot be refilled", async () => {
    vi.mocked(gmailListThreads).mockResolvedValue({
      threads: [{ id: "thread-missing" }],
    } as any);
    vi.mocked(gmailBatchGetThreads).mockResolvedValue([
      { id: "thread-missing", data: null, error: "No response part" },
    ] as any);
    vi.mocked(gmailGetThread).mockRejectedValue(new Error("still missing"));

    const result = await listGmailMessages(
      "missing-case",
      1,
      "owner@example.com",
      undefined,
      { mode: "threads", threadFormat: "metadata" },
    );

    expect(result.messages).toEqual([]);
    expect(result.errors).toEqual([
      {
        email: "connected@example.com",
        error: "Gmail thread metadata response was incomplete",
      },
    ]);
  });

  it("keeps default inbox and explicit all-mail thread pages separate in the list cache", async () => {
    vi.mocked(gmailListThreads).mockResolvedValue({
      threads: [],
    } as any);

    await listGmailMessages(
      undefined,
      3,
      "cache-owner@example.com",
      undefined,
      {
        mode: "threads",
        threadFormat: "metadata",
      },
    );
    await listGmailMessages("", 3, "cache-owner@example.com", undefined, {
      mode: "threads",
      threadFormat: "metadata",
    });

    expect(gmailListThreads).toHaveBeenNthCalledWith(1, "access-token", {
      q: "in:inbox",
      maxResults: 3,
      pageToken: undefined,
    });
    expect(gmailListThreads).toHaveBeenNthCalledWith(2, "access-token", {
      q: "",
      maxResults: 3,
      pageToken: undefined,
    });
  });
});

describe("getClientsWithErrors with unusable token records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces a reconnect error without deleting the row when a record parses to an empty object", async () => {
    // A stored oauth_tokens row that fails to decrypt (key rotation / wrong
    // key) parses to `{}` in core's parseStoredTokens. The account must fail
    // with a reconnect-style error — but the row must NOT be deleted, because
    // this process may simply hold the wrong key while the row is still
    // decryptable by a correctly configured deployment.
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "connected@example.com",
        owner: "owner@example.com",
        tokens: {},
      },
    ] as any);

    const { clients, errors } = await getClientsWithErrors("owner@example.com");

    expect(clients).toEqual([]);
    expect(errors).toEqual([
      {
        email: "connected@example.com",
        error: expect.stringContaining("please reconnect"),
      },
    ]);
    expect(deleteOAuthTokens).not.toHaveBeenCalled();
  });

  it("filters selected accounts before token validation or refresh", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "unrelated@example.com",
        owner: "owner@example.com",
        tokens: {},
      },
      {
        accountId: "selected@example.com",
        owner: "owner@example.com",
        tokens: {
          access_token: "selected-token",
          refresh_token: "selected-refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);

    const result = await getClientsWithErrors("owner@example.com", [
      "SELECTED@example.com",
    ]);

    expect(result).toEqual({
      clients: [
        {
          email: "selected@example.com",
          accessToken: "selected-token",
          refreshToken: "selected-refresh",
        },
      ],
      errors: [],
    });
    expect(deleteOAuthTokens).not.toHaveBeenCalled();
  });
});

describe("getAuthStatus with unusable token records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not report decrypt-failed OAuth rows as connected", async () => {
    const { getAuthStatus } = await import("./google-auth.js");
    vi.mocked(getOAuthAccounts).mockResolvedValue([
      {
        accountId: "broken@example.com",
        tokens: {},
      },
    ] as any);

    await expect(getAuthStatus("owner@example.com")).resolves.toEqual({
      connected: false,
      accounts: [],
    });
    expect(deleteOAuthTokens).not.toHaveBeenCalled();
  });

  it("keeps valid accounts connected when another row is unreadable", async () => {
    const { getAuthStatus } = await import("./google-auth.js");
    vi.mocked(getOAuthAccounts).mockResolvedValue([
      {
        accountId: "broken@example.com",
        tokens: {},
      },
      {
        accountId: "connected@example.com",
        displayName: "Connected User",
        tokens: {
          access_token: "access-token",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);

    await expect(getAuthStatus("owner@example.com")).resolves.toMatchObject({
      connected: true,
      accounts: [{ email: "connected@example.com" }],
    });
  });
});

describe("markAllUnreadReadForAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccount();
    vi.mocked(googleFetch).mockResolvedValue({} as any);
  });

  it("paginates lightweight unread refs, preserves an excluded thread, batches once, and verifies", async () => {
    const messages = Array.from({ length: 38 }, (_, index) => ({
      id: `message-${index}`,
      threadId:
        index < 2
          ? "thread-shared"
          : index === 37
            ? "thread-protected"
            : `thread-${index}`,
    }));
    vi.mocked(gmailListMessagesApi)
      .mockResolvedValueOnce({
        messages: messages.slice(0, 20),
        nextPageToken: "page-2",
      } as any)
      .mockResolvedValueOnce({ messages: messages.slice(20) } as any)
      .mockResolvedValueOnce({ messages: [messages[37]] } as any);

    const result = await markAllUnreadReadForAccount({
      ownerEmail: "owner@example.com",
      accountEmail: "connected@example.com",
      excludeThreadIds: ["thread-protected"],
    });

    expect(gmailListMessagesApi).toHaveBeenNthCalledWith(1, "access-token", {
      q: "is:unread",
      maxResults: 500,
      pageToken: undefined,
    });
    expect(gmailListMessagesApi).toHaveBeenNthCalledWith(2, "access-token", {
      q: "is:unread",
      maxResults: 500,
      pageToken: "page-2",
    });
    expect(googleFetch).toHaveBeenCalledTimes(1);
    const mutationOptions = vi.mocked(googleFetch).mock.calls[0]?.[2] as any;
    const mutationBody = JSON.parse(mutationOptions.body);
    expect(mutationBody.ids).toHaveLength(37);
    expect(mutationBody.ids).not.toContain("message-37");
    expect(mutationBody.removeLabelIds).toEqual(["UNREAD"]);
    expect(result).toMatchObject({
      matchedMessages: 38,
      matchedThreads: 37,
      excludedMessages: 1,
      excludedThreads: 1,
      changedMessages: 37,
      batchCount: 1,
      failures: [],
      remainingUnreadMessages: 1,
      remainingUnreadThreads: 1,
      remainingProtectedMessages: 1,
      remainingProtectedThreads: 1,
      unexpectedUnreadMessages: 0,
      unexpectedUnreadThreads: 0,
      verificationComplete: true,
    });
  });

  it("reports exact chunk failures and incomplete verification above Gmail's 1000-id limit", async () => {
    const messages = Array.from({ length: 1001 }, (_, index) => ({
      id: `message-${index}`,
      threadId: `thread-${index}`,
    }));
    vi.mocked(gmailListMessagesApi)
      .mockResolvedValueOnce({ messages } as any)
      .mockResolvedValueOnce({ messages: [messages[1000]] } as any);
    vi.mocked(googleFetch)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await markAllUnreadReadForAccount({
      ownerEmail: "owner@example.com",
      accountEmail: "connected@example.com",
      excludeThreadIds: [],
    });

    expect(googleFetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      matchedMessages: 1001,
      changedMessages: 1000,
      batchCount: 2,
      remainingUnreadMessages: 1,
      unexpectedUnreadMessages: 1,
      verificationComplete: false,
    });
    expect(result.failures).toEqual([
      { id: "message-1000", error: "provider unavailable" },
    ]);
  });

  it("returns structured mutation proof when the verification read fails", async () => {
    vi.mocked(gmailListMessagesApi)
      .mockResolvedValueOnce({
        messages: [{ id: "message-1", threadId: "thread-1" }],
      } as any)
      .mockRejectedValueOnce(new Error("verification unavailable"));

    const result = await markAllUnreadReadForAccount({
      ownerEmail: "owner@example.com",
      accountEmail: "connected@example.com",
      excludeThreadIds: [],
    });

    expect(result).toMatchObject({
      matchedMessages: 1,
      changedMessages: 1,
      batchCount: 1,
      failures: [],
      remainingUnreadMessages: null,
      unexpectedUnreadMessages: null,
      verificationComplete: false,
      verificationError: "verification unavailable",
    });
  });

  it("rejects an unowned account before listing or mutating Gmail", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([]);

    await expect(
      markAllUnreadReadForAccount({
        ownerEmail: "owner@example.com",
        accountEmail: "stranger@example.com",
        excludeThreadIds: [],
      }),
    ).rejects.toThrow("not connected for this user");

    expect(gmailListMessagesApi).not.toHaveBeenCalled();
    expect(googleFetch).not.toHaveBeenCalled();
  });
});

describe("gmailBatchModifyByAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(googleFetch).mockResolvedValue({} as any);
  });

  it("resolves an explicit secondary account through the authenticated owner", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "primary@example.com",
        owner: "owner@example.com",
        tokens: {
          access_token: "primary-token",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
      {
        accountId: "secondary@example.com",
        owner: "owner@example.com",
        tokens: {
          access_token: "secondary-token",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);

    const result = await gmailBatchModifyByAccount(
      "owner@example.com",
      [{ id: "message-secondary", accountEmail: "secondary@example.com" }],
      undefined,
      ["UNREAD"],
    );

    expect(result).toEqual({ succeeded: ["message-secondary"], failed: [] });
    expect(googleFetch).toHaveBeenCalledWith(
      expect.stringContaining("messages/batchModify"),
      "secondary-token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the legacy default-account fallback when no account is supplied", async () => {
    mockAccount();

    const result = await gmailBatchModifyByAccount(
      "owner@example.com",
      [{ id: "message-default" }],
      undefined,
      ["UNREAD"],
    );

    expect(result).toEqual({ succeeded: ["message-default"], failed: [] });
    expect(googleFetch).toHaveBeenCalledWith(
      expect.stringContaining("messages/batchModify"),
      "access-token",
      expect.any(Object),
    );
  });

  it.each([
    ["explicit secondary", "secondary@example.com"],
    ["default account", undefined],
  ])(
    "refreshes a refresh-token-only %s grant",
    async (_label, accountEmail) => {
      vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
        {
          accountId: "secondary@example.com",
          owner: "owner@example.com",
          tokens: { refresh_token: "refresh-only" },
        },
      ] as any);
      vi.mocked(createOAuth2Client).mockReturnValue({
        refreshToken: vi.fn().mockResolvedValue({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        }),
      } as any);

      const result = await gmailBatchModifyByAccount(
        "owner@example.com",
        [{ id: "message-refresh", accountEmail }],
        undefined,
        ["UNREAD"],
      );

      expect(result).toEqual({ succeeded: ["message-refresh"], failed: [] });
      expect(googleFetch).toHaveBeenCalledWith(
        expect.stringContaining("messages/batchModify"),
        "refreshed-access-token",
        expect.any(Object),
      );
    },
  );
});
