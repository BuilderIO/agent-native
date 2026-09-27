import {
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import {
  getCredentialContext,
  getOAuthAccounts,
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOAuth2Client,
  gmailBatchGetMessages,
  gmailBatchGetThreads,
  gmailGetProfile,
  gmailGetThread,
  gmailListMessages as gmailListMessagesApi,
  gmailListHistory,
  gmailListThreads,
  googleFetch,
} from "./google-api.js";
import {
  gmailBatchModifyByAccount,
  exchangeCode,
  gmailToEmailMessage,
  getAuthUrl,
  getClient,
  getClientForConnectedAccount,
  getConnectedAccounts,
  getConnectedAccountsWithErrors,
  getClientsWithErrors,
  invalidateHistoryCacheForAccount,
  invalidateListCacheForOwner,
  isConnected,
  listGmailMessages,
  markAllUnreadReadForAccount,
} from "./google-auth.js";
import { getMailProviderApiRuntime } from "./provider-api.js";

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  hasOAuthTokens: vi.fn(),
  listOAuthAccounts: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS: {
    clientIdKey: "GOOGLE_CLIENT_ID",
    clientSecretKey: "GOOGLE_CLIENT_SECRET",
  },
  getOAuthAccounts: vi.fn(),
  getCredentialContext: vi.fn(() => null),
  getRequestContext: vi.fn(() => undefined),
  isOAuthConnected: vi.fn(),
  resolveGoogleProviderCredentialCandidatesWithReader: vi.fn(
    async ({ readCredential, credentialKeyPairs }) => {
      const candidates = [];
      for (const keys of credentialKeyPairs) {
        const [clientId, clientSecret] = await Promise.all([
          readCredential(keys.clientIdKey),
          readCredential(keys.clientSecretKey),
        ]);
        if (clientId && clientSecret)
          candidates.push({ clientId, clientSecret });
      }
      return candidates;
    },
  ),
  resolveSecret: vi.fn(async (key: string) =>
    key === "GOOGLE_CLIENT_ID" ? "client-id" : "client-secret",
  ),
  runWithRequestContext: vi.fn(async (_context, fn) => fn()),
}));

const threadCandidatePages = vi.hoisted(
  () => new Map<string, Record<string, unknown>>(),
);

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(
    async (email: string, key: string) =>
      threadCandidatePages.get(`${email}:${key}`) ?? null,
  ),
  putUserSetting: vi.fn(
    async (email: string, key: string, value: Record<string, unknown>) => {
      threadCandidatePages.set(`${email}:${key}`, value);
    },
  ),
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: vi.fn(),
  GmailQuotaCooldownError: class GmailQuotaCooldownError extends Error {
    retryAfterMs: number;
    constructor(message: string, retryAfterMs: number) {
      super(message);
      this.retryAfterMs = retryAfterMs;
    }
  },
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

vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: vi.fn(),
}));

vi.mock("./provider-api.js", () => ({
  getMailProviderApiRuntime: vi.fn(),
}));

function mockManagedGrant(email: string, accessToken = "managed-token") {
  vi.mocked(getCredentialContext).mockReturnValue({ userEmail: email } as any);
  vi.mocked(resolveWorkspaceConnectionForApp).mockResolvedValue({
    available: true,
  } as any);
  vi.mocked(getMailProviderApiRuntime).mockReturnValue({
    resolveOAuthAccessToken: vi.fn().mockResolvedValue({
      accountId: email,
      accessToken,
    }),
  } as any);
}

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
    threadCandidatePages.clear();
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

  it("does not reuse or cache an in-flight response invalidated by a mutation", async () => {
    let releaseFirst!: (value: unknown) => void;
    const firstProviderResponse = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(gmailListThreads)
      .mockImplementationOnce(() => firstProviderResponse as any)
      .mockResolvedValueOnce({ threads: [{ id: "new-thread" }] } as any);
    vi.mocked(gmailBatchGetThreads).mockImplementation(
      async (_token: string, ids: string[]) =>
        ids.map((id) => ({
          id,
          data: { messages: [{ id: `${id}-message`, threadId: id }] },
        })) as any,
    );

    const first = listGmailMessages(
      "in:inbox",
      3,
      "inflight-owner@example.com",
      undefined,
      { mode: "threads" },
    );
    await vi.waitFor(() => expect(gmailListThreads).toHaveBeenCalledTimes(1));

    invalidateListCacheForOwner("inflight-owner@example.com");
    const second = listGmailMessages(
      "in:inbox",
      3,
      "inflight-owner@example.com",
      undefined,
      { mode: "threads" },
    );
    await vi.waitFor(() => expect(gmailListThreads).toHaveBeenCalledTimes(2));

    await expect(second).resolves.toMatchObject({
      messages: [{ threadId: "new-thread" }],
    });
    releaseFirst({ threads: [{ id: "old-thread" }] });
    await expect(first).resolves.toMatchObject({
      messages: [{ threadId: "old-thread" }],
    });

    const third = await listGmailMessages(
      "in:inbox",
      3,
      "inflight-owner@example.com",
      undefined,
      { mode: "threads" },
    );
    expect(third.messages).toEqual([
      expect.objectContaining({ threadId: "new-thread" }),
    ]);
    expect(gmailListThreads).toHaveBeenCalledTimes(2);
  });

  it("drops a stale history window and its in-flight completion after a mutation", async () => {
    const owner = "history-owner@example.com";
    const account = "connected@example.com";
    const makeMessage = (id: string) => ({
      id,
      threadId: id,
      internalDate: id === "old-message" ? "1" : "2",
      labelIds: ["INBOX"],
    });
    invalidateHistoryCacheForAccount(account);
    vi.mocked(gmailGetProfile).mockResolvedValue({ historyId: "10" } as any);
    vi.mocked(gmailBatchGetMessages).mockImplementation(
      async (_token: string, ids: string[]) =>
        ids.map((id) => ({ id, data: makeMessage(id) })) as any,
    );
    vi.mocked(gmailListMessagesApi)
      .mockResolvedValueOnce({ messages: [{ id: "old-message" }] } as any)
      .mockResolvedValueOnce({ messages: [{ id: "new-message" }] } as any);

    await listGmailMessages(undefined, 3, owner, undefined, {
      mode: "messages",
    });

    let releaseHistory!: (value: unknown) => void;
    vi.mocked(gmailListHistory)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseHistory = resolve;
          }) as any,
      )
      .mockResolvedValue({ history: [], historyId: "11" } as any);
    invalidateListCacheForOwner(owner);
    const stale = listGmailMessages(undefined, 3, owner, undefined, {
      mode: "messages",
    });
    await vi.waitFor(() => expect(gmailListHistory).toHaveBeenCalledTimes(1));

    invalidateHistoryCacheForAccount(account);
    invalidateListCacheForOwner(owner);
    const fresh = listGmailMessages(undefined, 3, owner, undefined, {
      mode: "messages",
    });
    await expect(fresh).resolves.toMatchObject({
      messages: [{ id: "new-message" }],
    });

    releaseHistory({
      history: [],
      historyId: "11",
      nextPageToken: "too-many-changes",
    });
    await expect(stale).resolves.toMatchObject({ messages: [] });

    invalidateListCacheForOwner(owner);
    const afterLateCompletion = await listGmailMessages(
      undefined,
      3,
      owner,
      undefined,
      { mode: "messages" },
    );
    expect(afterLateCompletion.messages).toEqual([
      expect.objectContaining({ id: "new-message" }),
    ]);
    expect(gmailListMessagesApi).toHaveBeenCalledTimes(3);
  });
});

describe("gmailToEmailMessage", () => {
  it("preserves commas inside quoted sender names", () => {
    const message = gmailToEmailMessage({
      id: "message-1",
      threadId: "thread-1",
      internalDate: "1750000000000",
      labelIds: ["INBOX"],
      payload: {
        headers: [
          {
            name: "From",
            value: '"Cuevas, Gustavo" <cuevas@example.com>',
          },
          { name: "Date", value: "2025-06-15T12:00:00.000Z" },
        ],
      },
      snippet: "",
    });

    expect(message.from).toEqual({
      name: "Cuevas, Gustavo",
      email: "cuevas@example.com",
    });
  });

  it("embeds inline image data when Gmail omits an attachment id", () => {
    const imageData = Buffer.from("inline-image").toString("base64url");
    const html = Buffer.from(
      '<img alt="logo" src="cid:image001%40example.com">',
    ).toString("base64url");
    const message = gmailToEmailMessage({
      id: "message-inline-image",
      threadId: "thread-inline-image",
      internalDate: "1750000000000",
      labelIds: ["INBOX"],
      payload: {
        mimeType: "multipart/related",
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "Date", value: "2025-06-15T12:00:00.000Z" },
        ],
        parts: [
          { mimeType: "text/html", body: { data: html } },
          {
            mimeType: "image/png",
            headers: [
              { name: "Content-ID", value: " <image001@example.com> " },
            ],
            body: { data: imageData },
          },
        ],
      },
      snippet: "",
    });

    expect(message.bodyHtml).toBe(
      '<img alt="logo" src="data:image/png;base64,aW5saW5lLWltYWdl">',
    );
  });
});

describe("getClientsWithErrors with unusable token records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces a reconnect error without deleting the row when a record parses to an empty object", async () => {
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

describe("getValidAccessToken single-flight refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockExpiredAccount() {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "connected@example.com",
        owner: "connected@example.com",
        tokens: {
          access_token: "stale-access-token",
          refresh_token: "refresh-token",
          expiry_date: Date.now() - 1000,
        },
      },
    ] as any);
  }

  it("coalesces 5 concurrent callers into 1 refreshToken call, all resolving the same token", async () => {
    mockExpiredAccount();
    const refreshToken = vi.fn().mockResolvedValue({
      access_token: "refreshed-token",
      expires_in: 3600,
    });
    vi.mocked(createOAuth2Client).mockReturnValue({ refreshToken } as any);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getClient("connected@example.com")),
    );

    expect(refreshToken).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result?.accessToken).toBe("refreshed-token");
    }
  });

  it("rejects every waiter on a failed refresh, then retries on the next call", async () => {
    mockExpiredAccount();
    const refreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        access_token: "refreshed-token",
        expires_in: 3600,
      });
    vi.mocked(createOAuth2Client).mockReturnValue({ refreshToken } as any);

    const settled = await Promise.allSettled(
      Array.from({ length: 3 }, () => getClient("connected@example.com")),
    );
    for (const outcome of settled) {
      expect(outcome.status).toBe("rejected");
      expect((outcome as PromiseRejectedResult).reason?.message).toBe(
        "network error",
      );
    }
    expect(refreshToken).toHaveBeenCalledTimes(1);

    const retried = await getClient("connected@example.com");
    expect(retried?.accessToken).toBe("refreshed-token");
    expect(refreshToken).toHaveBeenCalledTimes(2);
  });
});

describe("getClientsWithErrors parallel refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the good client plus one error when one of two accounts fails to refresh", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "bad@example.com",
        owner: "owner@example.com",
        tokens: {
          access_token: "stale-bad",
          refresh_token: "bad-refresh",
          expiry_date: Date.now() - 1000,
        },
      },
      {
        accountId: "good@example.com",
        owner: "owner@example.com",
        tokens: {
          access_token: "stale-good",
          refresh_token: "good-refresh",
          expiry_date: Date.now() - 1000,
        },
      },
    ] as any);
    const refreshToken = vi.fn(async (token: string) => {
      if (token === "bad-refresh") throw new Error("invalid_grant");
      return { access_token: "refreshed-good-token", expires_in: 3600 };
    });
    vi.mocked(createOAuth2Client).mockReturnValue({ refreshToken } as any);

    const { clients, errors } = await getClientsWithErrors("owner@example.com");

    expect(clients).toEqual([
      {
        email: "good@example.com",
        accessToken: "refreshed-good-token",
        refreshToken: "good-refresh",
      },
    ]);
    expect(errors).toEqual([
      {
        email: "bad@example.com",
        error: expect.stringContaining("invalid_grant"),
      },
    ]);
    expect(refreshToken).toHaveBeenCalledTimes(2);
  });
});

describe("getClientForConnectedAccount ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a secondary OAuth account only from the requested owner's rows", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "shared@example.com",
        owner: "owner@example.com",
        tokens: {
          access_token: "owner-token",
          refresh_token: "owner-refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);
    vi.mocked(listOAuthAccounts).mockResolvedValue([
      {
        accountId: "shared@example.com",
        owner: "another-owner@example.com",
        tokens: {
          access_token: "another-owner-token",
          refresh_token: "another-owner-refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);

    await expect(
      getClientForConnectedAccount("owner@example.com", "SHARED@example.com"),
    ).resolves.toEqual({
      accessToken: "owner-token",
      email: "shared@example.com",
    });
    expect(listOAuthAccountsByOwner).toHaveBeenCalledWith(
      "google",
      "owner@example.com",
    );
    expect(listOAuthAccounts).not.toHaveBeenCalled();
  });

  it("does not borrow a matching OAuth row owned by another user", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([] as any);
    vi.mocked(listOAuthAccounts).mockResolvedValue([
      {
        accountId: "shared@example.com",
        owner: "another-owner@example.com",
        tokens: {
          access_token: "another-owner-token",
          refresh_token: "another-owner-refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);

    await expect(
      getClientForConnectedAccount("owner@example.com", "shared@example.com"),
    ).resolves.toBeNull();
    expect(listOAuthAccounts).not.toHaveBeenCalled();
  });
});

describe("mixed OAuth and managed Gmail accounts", () => {
  const OWNER = "owner@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "oauth@example.com",
        owner: OWNER,
        tokens: {
          access_token: "oauth-token",
          refresh_token: "oauth-refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);
    vi.mocked(getOAuthAccounts).mockResolvedValue([
      {
        accountId: "oauth@example.com",
        displayName: "OAuth User",
        tokens: {
          access_token: "oauth-token",
          refresh_token: "oauth-refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);
  });

  afterEach(() => {
    vi.mocked(getCredentialContext).mockReturnValue(null);
  });

  it("lists OAuth accounts first and appends the managed account", async () => {
    mockManagedGrant("managed@example.com", "managed-token");

    await expect(getConnectedAccounts(OWNER)).resolves.toEqual([
      "oauth@example.com",
      "managed@example.com",
    ]);
  });

  it("returns both clients and filters the requested account before OAuth refresh", async () => {
    mockManagedGrant("managed@example.com", "managed-token");

    await expect(getClientsWithErrors(OWNER)).resolves.toEqual({
      clients: [
        {
          email: "oauth@example.com",
          accessToken: "oauth-token",
          refreshToken: "oauth-refresh",
        },
        {
          email: "managed@example.com",
          accessToken: "managed-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });

    await expect(
      getClientsWithErrors(OWNER, ["MANAGED@example.com"]),
    ).resolves.toEqual({
      clients: [
        {
          email: "managed@example.com",
          accessToken: "managed-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });
    expect(createOAuth2Client).not.toHaveBeenCalled();
  });

  it("skips managed lookup when the requested OAuth account is already usable", async () => {
    mockManagedGrant("managed@example.com", "managed-token");

    await expect(
      getClientsWithErrors(OWNER, ["oauth@example.com"]),
    ).resolves.toMatchObject({
      clients: [{ email: "oauth@example.com", accessToken: "oauth-token" }],
      errors: [],
    });
    expect(resolveWorkspaceConnectionForApp).not.toHaveBeenCalled();
  });

  it("resolves the managed grant while OAuth token refresh is still pending", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "oauth@example.com",
        owner: OWNER,
        tokens: {
          access_token: "expired-access-token",
          refresh_token: "oauth-refresh",
          expiry_date: Date.now() - 1000,
        },
      },
    ] as any);
    let finishRefresh!: (value: {
      access_token: string;
      expires_in: number;
    }) => void;
    const refreshToken = vi.fn(
      () =>
        new Promise<{ access_token: string; expires_in: number }>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    vi.mocked(createOAuth2Client).mockReturnValue({ refreshToken } as any);
    mockManagedGrant("managed@example.com", "managed-token");

    const pending = getClientsWithErrors(OWNER);
    await vi.waitFor(() =>
      expect(getMailProviderApiRuntime).toHaveBeenCalled(),
    );
    expect(refreshToken).toHaveBeenCalledTimes(1);

    finishRefresh({ access_token: "refreshed-oauth-token", expires_in: 3600 });
    await expect(pending).resolves.toMatchObject({
      clients: [
        { email: "oauth@example.com", accessToken: "refreshed-oauth-token" },
        { email: "managed@example.com", accessToken: "managed-token" },
      ],
      errors: [],
    });
  });

  it("keeps OAuth precedence and avoids a duplicate for a case-insensitive identity match", async () => {
    mockManagedGrant("OAUTH@example.com", "managed-shadow-token");

    await expect(getConnectedAccounts(OWNER)).resolves.toEqual([
      "oauth@example.com",
    ]);
    await expect(getClientsWithErrors(OWNER)).resolves.toMatchObject({
      clients: [
        {
          email: "oauth@example.com",
          accessToken: "oauth-token",
          refreshToken: "oauth-refresh",
        },
      ],
      errors: [],
    });
  });

  it("shows the managed account alongside OAuth in auth status", async () => {
    mockManagedGrant("managed@example.com", "managed-token");

    const { getAuthStatus } = await import("./google-auth.js");
    await expect(getAuthStatus(OWNER)).resolves.toMatchObject({
      connected: true,
      accounts: [
        { email: "oauth@example.com", displayName: "OAuth User" },
        { email: "managed@example.com", shared: true },
      ],
    });
  });

  it("keeps managed lookup failures distinguishable when OAuth is also connected", async () => {
    vi.mocked(getCredentialContext).mockReturnValue({
      userEmail: OWNER,
    } as any);
    vi.mocked(resolveWorkspaceConnectionForApp).mockRejectedValue(
      new Error("workspace lookup unavailable"),
    );

    await expect(getConnectedAccountsWithErrors(OWNER)).resolves.toEqual({
      accounts: ["oauth@example.com"],
      errors: [
        {
          email: "workspace",
          error: "workspace lookup unavailable",
        },
      ],
    });
    await expect(getConnectedAccounts(OWNER)).rejects.toThrow(
      "workspace lookup unavailable",
    );
    await expect(getClientsWithErrors(OWNER)).resolves.toMatchObject({
      clients: [{ email: "oauth@example.com" }],
      errors: [
        {
          email: "workspace",
          error: "workspace lookup unavailable",
        },
      ],
    });
    const { getAuthStatus } = await import("./google-auth.js");
    await expect(getAuthStatus(OWNER)).resolves.toMatchObject({
      connected: true,
      accounts: [{ email: "oauth@example.com" }],
      errors: [
        {
          email: "workspace",
          error: "workspace lookup unavailable",
        },
      ],
    });
  });

  it("does not fall back to a managed grant when a requested OAuth refresh fails", async () => {
    vi.mocked(getCredentialContext).mockReturnValue({
      userEmail: OWNER,
    } as any);
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "oauth@example.com",
        owner: OWNER,
        tokens: {
          access_token: "expired-token",
          refresh_token: "oauth-refresh",
          expiry_date: Date.now() - 1000,
        },
      },
    ] as any);
    const refreshToken = vi
      .fn()
      .mockRejectedValue(new Error("temporary refresh failure"));
    vi.mocked(createOAuth2Client).mockReturnValue({ refreshToken } as any);

    await expect(
      getClientsWithErrors(OWNER, ["oauth@example.com"]),
    ).resolves.toEqual({
      clients: [],
      errors: [
        {
          email: "oauth@example.com",
          error: "temporary refresh failure",
        },
      ],
    });
    expect(resolveWorkspaceConnectionForApp).not.toHaveBeenCalled();
  });

  it("does not let a mixed-request managed grant mask a failed OAuth identity", async () => {
    vi.mocked(getCredentialContext).mockReturnValue({
      userEmail: OWNER,
    } as any);
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "oauth@example.com",
        owner: OWNER,
        tokens: {
          access_token: "expired-token",
          refresh_token: "oauth-refresh",
          expiry_date: Date.now() - 1000,
        },
      },
    ] as any);
    const refreshToken = vi
      .fn()
      .mockRejectedValue(new Error("temporary refresh failure"));
    vi.mocked(createOAuth2Client).mockReturnValue({ refreshToken } as any);
    vi.mocked(resolveWorkspaceConnectionForApp).mockResolvedValue({
      available: true,
    } as any);
    vi.mocked(getMailProviderApiRuntime).mockReturnValue({
      resolveOAuthAccessToken: vi.fn().mockResolvedValue({
        accountId: "oauth@example.com",
        accessToken: "managed-shadow-token",
      }),
    } as any);

    await expect(
      getClientsWithErrors(OWNER, ["oauth@example.com", "managed@example.com"]),
    ).resolves.toEqual({
      clients: [],
      errors: [
        {
          email: "oauth@example.com",
          error: "temporary refresh failure",
        },
      ],
    });
  });
});

describe("managed Gmail request context", () => {
  const ownerEmail = "owner@example.com";
  const ambientContext = {
    userEmail: "ambient@example.com",
    orgId: "ambient-org",
    mcpRequestId: "ambient-request",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCredentialContext).mockReturnValue(null);
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([] as any);
    vi.mocked(getRequestContext).mockReturnValue(ambientContext as any);
    vi.mocked(runWithRequestContext).mockImplementation(async (context, fn) => {
      vi.mocked(getCredentialContext).mockReturnValueOnce({
        userEmail: context.userEmail,
        orgId: context.orgId ?? null,
      } as any);
      return await fn();
    });
    vi.mocked(resolveWorkspaceConnectionForApp).mockResolvedValue({
      available: true,
    } as any);
    vi.mocked(getMailProviderApiRuntime).mockReturnValue({
      resolveOAuthAccessToken: vi.fn().mockResolvedValue({
        accountId: "managed@example.com",
        accessToken: "managed-token",
      }),
    } as any);
  });

  afterEach(() => {
    vi.mocked(getCredentialContext).mockReturnValue(null);
    vi.mocked(getRequestContext).mockReturnValue(undefined);
    vi.mocked(runWithRequestContext).mockImplementation(async (_context, fn) =>
      fn(),
    );
    vi.mocked(resolveWorkspaceConnectionForApp).mockResolvedValue({
      available: false,
    } as any);
    vi.mocked(getMailProviderApiRuntime).mockReset();
  });

  it("resolves managed mailboxes in the owner's context while retaining ambient fields", async () => {
    await expect(getClientsWithErrors(ownerEmail)).resolves.toMatchObject({
      clients: [{ email: "managed@example.com", accessToken: "managed-token" }],
      errors: [],
    });
    await expect(getConnectedAccountsWithErrors(ownerEmail)).resolves.toEqual({
      accounts: ["managed@example.com"],
      errors: [],
    });
    await expect(isConnected(ownerEmail)).resolves.toBe(true);

    const expectedContext = { ...ambientContext, userEmail: ownerEmail };
    expect(runWithRequestContext).toHaveBeenCalledTimes(3);
    for (const [context] of vi.mocked(runWithRequestContext).mock.calls) {
      expect(context).toEqual(expectedContext);
    }
  });
});

describe("getAuthStatus with unusable token records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCredentialContext).mockReturnValue(null);
    vi.mocked(getRequestContext).mockReturnValue(undefined);
    vi.mocked(runWithRequestContext).mockImplementation(async (_context, fn) =>
      fn(),
    );
    vi.mocked(resolveWorkspaceConnectionForApp).mockResolvedValue({
      available: false,
    } as any);
    vi.mocked(getMailProviderApiRuntime).mockReset();
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
      errors: [
        {
          email: "broken@example.com",
          error: expect.stringContaining("please reconnect"),
        },
      ],
    });
    expect(deleteOAuthTokens).not.toHaveBeenCalled();
  });

  it("does not replace a failed OAuth identity with a same-address managed account", async () => {
    const ownerEmail = "owner@example.com";
    const accountEmail = "same@example.com";
    const { getAuthStatus } = await import("./google-auth.js");
    vi.mocked(getOAuthAccounts).mockResolvedValue([
      {
        accountId: accountEmail,
        tokens: {
          access_token: "expired-token",
          refresh_token: "refresh-token",
          expiry_date: Date.now() - 1000,
        },
      },
    ] as any);
    vi.mocked(getCredentialContext).mockReturnValue({
      userEmail: ownerEmail,
    } as any);
    vi.mocked(resolveWorkspaceConnectionForApp).mockResolvedValue({
      available: true,
    } as any);
    vi.mocked(createOAuth2Client).mockReturnValue({
      refreshToken: vi
        .fn()
        .mockRejectedValue(new Error("temporary refresh failure")),
    } as any);
    vi.mocked(getMailProviderApiRuntime).mockReturnValue({
      resolveOAuthAccessToken: vi.fn().mockResolvedValue({
        accountId: accountEmail,
        accessToken: "managed-token",
      }),
    } as any);

    await expect(getAuthStatus(ownerEmail)).resolves.toEqual({
      connected: false,
      accounts: [],
      errors: [
        {
          email: accountEmail,
          error: "temporary refresh failure",
        },
      ],
    });
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

  it("does not fail verification when unrelated unread mail arrives after the mutation snapshot", async () => {
    const target = { id: "message-target", threadId: "thread-target" };
    const protectedMessage = {
      id: "message-protected",
      threadId: "thread-protected",
    };
    const newlyArrived = { id: "message-new", threadId: "thread-new" };
    vi.mocked(gmailListMessagesApi)
      .mockResolvedValueOnce({
        messages: [target, protectedMessage],
      } as any)
      .mockResolvedValueOnce({
        messages: [protectedMessage, newlyArrived],
      } as any);

    const result = await markAllUnreadReadForAccount({
      ownerEmail: "owner@example.com",
      accountEmail: "connected@example.com",
      excludeThreadIds: ["thread-protected"],
    });

    expect(result).toMatchObject({
      changedMessages: 1,
      remainingUnreadMessages: 2,
      remainingProtectedMessages: 1,
      unexpectedUnreadMessages: 0,
      newUnreadMessages: 1,
      newUnreadThreads: 1,
      verificationComplete: true,
    });
  });

  it("still fails verification when an initially selected message remains unread", async () => {
    const target = { id: "message-target", threadId: "thread-target" };
    const newlyArrived = { id: "message-new", threadId: "thread-new" };
    vi.mocked(gmailListMessagesApi)
      .mockResolvedValueOnce({ messages: [target] } as any)
      .mockResolvedValueOnce({ messages: [target, newlyArrived] } as any);

    const result = await markAllUnreadReadForAccount({
      ownerEmail: "owner@example.com",
      accountEmail: "connected@example.com",
      excludeThreadIds: [],
    });

    expect(result).toMatchObject({
      remainingUnreadMessages: 2,
      unexpectedUnreadMessages: 1,
      unexpectedUnreadThreads: 1,
      newUnreadMessages: 1,
      verificationComplete: false,
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
      expect(createOAuth2Client).toHaveBeenCalledWith(
        "client-id",
        "client-secret",
        "",
      );
      expect(googleFetch).toHaveBeenCalledWith(
        expect.stringContaining("messages/batchModify"),
        "refreshed-access-token",
        expect.any(Object),
      );
    },
  );
});

describe("gmailBatchModifyByAccount — managed workspace grant", () => {
  const OWNER = "owner@example.com";
  const MANAGED = "managed@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(googleFetch).mockResolvedValue({} as any);
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.mocked(getCredentialContext).mockReturnValue(null);
  });

  it("resolves an explicit accountEmail through the managed grant when the owner has no OAuth rows", async () => {
    mockManagedGrant(MANAGED, "managed-token");

    const result = await gmailBatchModifyByAccount(
      OWNER,
      [{ id: "message-managed", accountEmail: MANAGED }],
      undefined,
      ["UNREAD"],
    );

    expect(result).toEqual({ succeeded: ["message-managed"], failed: [] });
    expect(googleFetch).toHaveBeenCalledWith(
      expect.stringContaining("messages/batchModify"),
      "managed-token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves the managed grant as the default account when none is supplied", async () => {
    mockManagedGrant(MANAGED, "managed-token");

    const result = await gmailBatchModifyByAccount(
      OWNER,
      [{ id: "message-default" }],
      undefined,
      ["UNREAD"],
    );

    expect(result).toEqual({ succeeded: ["message-default"], failed: [] });
    expect(googleFetch).toHaveBeenCalledWith(
      expect.stringContaining("messages/batchModify"),
      "managed-token",
      expect.any(Object),
    );
  });

  it("fails the target when neither an OAuth row nor the managed grant matches", async () => {
    vi.mocked(getCredentialContext).mockReturnValue(null);

    const result = await gmailBatchModifyByAccount(
      OWNER,
      [{ id: "message-orphan", accountEmail: MANAGED }],
      undefined,
      ["UNREAD"],
    );

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      {
        id: "message-orphan",
        error: expect.stringContaining("is not connected for this user"),
      },
    ]);
  });
});

describe("getClientForConnectedAccount", () => {
  const OWNER = "owner@example.com";
  const MANAGED = "managed@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.mocked(getCredentialContext).mockReturnValue(null);
  });

  it("returns the OAuth-backed client when a row exists for accountEmail", async () => {
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

    const result = await getClientForConnectedAccount(
      "owner@example.com",
      "connected@example.com",
    );

    expect(result).toEqual({
      accessToken: "access-token",
      email: "connected@example.com",
    });
  });

  it("falls back to the managed client when no OAuth row exists but it matches the managed grant", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([] as any);
    mockManagedGrant(MANAGED, "managed-token");

    const result = await getClientForConnectedAccount(OWNER, MANAGED);

    expect(result).toEqual({ accessToken: "managed-token", email: MANAGED });
  });

  it("returns null when neither an OAuth row nor the managed grant matches", async () => {
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([] as any);
    vi.mocked(getCredentialContext).mockReturnValue(null);

    const result = await getClientForConnectedAccount(
      OWNER,
      "nobody@example.com",
    );

    expect(result).toBeNull();
  });
});

describe("Google OAuth URL construction", () => {
  it("fails closed when no Google OAuth redirect URI is available", async () => {
    await expect(getAuthUrl()).rejects.toThrow(
      "Google OAuth redirect URI is required.",
    );
    await expect(exchangeCode("oauth-code")).rejects.toThrow(
      "Google OAuth redirect URI is required.",
    );
  });

  it("requests Gmail scopes and persists the first preview sign-in account", async () => {
    vi.clearAllMocks();
    const callbackUri =
      "https://beta.dispatch.agent-native.com/_agent-native/google/callback";
    const generateAuthUrl = vi
      .fn()
      .mockReturnValue("https://accounts.google.com/oauth");
    vi.mocked(createOAuth2Client).mockReturnValue({
      generateAuthUrl,
      getToken: vi.fn().mockResolvedValue({
        access_token: "gmail-access-token",
        refresh_token: "gmail-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      }),
    } as any);
    vi.mocked(gmailGetProfile).mockResolvedValue({
      emailAddress: "owner@example.com",
    } as any);

    await expect(
      getAuthUrl(
        undefined,
        callbackUri,
        "preview-relay-state",
        "owner@example.com",
      ),
    ).resolves.toBe("https://accounts.google.com/oauth");
    expect(generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        state: "preview-relay-state",
        scope: expect.arrayContaining([
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/calendar.events",
        ]),
      }),
    );

    await expect(
      exchangeCode(
        "preview-google-code",
        undefined,
        callbackUri,
        "owner@example.com",
      ),
    ).resolves.toBe("owner@example.com");
    expect(saveOAuthTokens).toHaveBeenCalledWith(
      "google",
      "owner@example.com",
      expect.objectContaining({
        access_token: "gmail-access-token",
        refresh_token: "gmail-refresh-token",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      }),
      "owner@example.com",
    );
  });
});
