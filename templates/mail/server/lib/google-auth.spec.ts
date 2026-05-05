import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import {
  gmailBatchGetThreads,
  gmailGetThread,
  gmailListMessages as gmailListMessagesApi,
  gmailListThreads,
} from "./google-api.js";
import { listGmailMessages } from "./google-auth.js";

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
