import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class SyncClaimLostError extends Error {
    constructor(accountEmail: string) {
      super(`Sync claim for ${accountEmail} was lost to another worker`);
      this.name = "SyncClaimLostError";
    }
  }
  return {
    listOAuthAccountsByOwner: vi.fn(),
    getConnectedAccountsWithErrors: vi.fn(),
    gmailGetProfile: vi.fn(),
    gmailListThreads: vi.fn(),
    gmailListHistory: vi.fn(),
    gmailListLabels: vi.fn(),
    gmailBatchGetThreads: vi.fn(),
    getClientForConnectedAccount: vi.fn(),
    invalidateHistoryCacheForAccount: vi.fn(),
    invalidateListCacheForOwner: vi.fn(),
    ensureSyncAccountRow: vi.fn(),
    claimSyncAccount: vi.fn(),
    releaseSyncAccount: vi.fn(),
    patchSyncAccount: vi.fn(),
    resetSyncAccountProgress: vi.fn(),
    readInboxPushGeneration: vi.fn(),
    upsertInboxThreadRows: vi.fn(),
    deleteInboxThreadRow: vi.fn(),
    markThreadsOutOfInboxBeforeSync: vi.fn(),
    readSyncAccounts: vi.fn(),
    withSyncClaim: vi.fn(),
    SyncClaimLostError,
  };
});

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
}));

vi.mock("./google-api.js", () => ({
  gmailGetProfile: mocks.gmailGetProfile,
  gmailListThreads: mocks.gmailListThreads,
  gmailListHistory: mocks.gmailListHistory,
  gmailListLabels: mocks.gmailListLabels,
  gmailBatchGetThreads: mocks.gmailBatchGetThreads,
}));

vi.mock("./google-auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./google-auth.js")>();
  return {
    ...actual,
    getClientForConnectedAccount: mocks.getClientForConnectedAccount,
    getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
    invalidateHistoryCacheForAccount: mocks.invalidateHistoryCacheForAccount,
    invalidateListCacheForOwner: mocks.invalidateListCacheForOwner,
  };
});

vi.mock("./inbox-store.js", () => ({
  ensureSyncAccountRow: mocks.ensureSyncAccountRow,
  claimSyncAccount: mocks.claimSyncAccount,
  releaseSyncAccount: mocks.releaseSyncAccount,
  patchSyncAccount: mocks.patchSyncAccount,
  resetSyncAccountProgress: mocks.resetSyncAccountProgress,
  readInboxPushGeneration: mocks.readInboxPushGeneration,
  upsertInboxThreadRows: mocks.upsertInboxThreadRows,
  deleteInboxThreadRow: mocks.deleteInboxThreadRow,
  markThreadsOutOfInboxBeforeSync: mocks.markThreadsOutOfInboxBeforeSync,
  readSyncAccounts: mocks.readSyncAccounts,
  withSyncClaim: mocks.withSyncClaim,
  SyncClaimLostError: mocks.SyncClaimLostError,
}));

import {
  ensureInboxFresh,
  resetInboxSync,
  syncInboxAccount,
} from "./inbox-sync.js";

const OWNER = "owner@example.com";
const ACCOUNT = "acct1@example.com";

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "owner:acct1",
    ownerEmail: OWNER,
    accountEmail: ACCOUNT,
    historyId: null,
    fullSyncPageToken: null,
    fullSyncHistoryId: null,
    fullSyncStartedAt: null,
    status: "syncing",
    lastError: null,
    lastSyncedAt: null,
    lastPushGeneration: 0,
    syncClaimId: "claim-1",
    syncClaimedAt: Date.now(),
    labels: [],
    labelsUpdatedAt: Date.now(),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function thread(
  id: string,
  opts: {
    from: string;
    labelIds: string[];
    internalDate?: string;
  },
) {
  return {
    id,
    historyId: "500",
    snippet: `snippet ${id}`,
    messages: [
      {
        id: `${id}-m1`,
        internalDate: opts.internalDate ?? "1700000000000",
        labelIds: opts.labelIds,
        snippet: `snippet ${id}`,
        payload: {
          headers: [
            { name: "From", value: `Sender <${opts.from}>` },
            { name: "To", value: OWNER },
            { name: "Subject", value: `Subject ${id}` },
          ],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOAuthAccountsByOwner.mockResolvedValue([
    { accountId: ACCOUNT, displayName: null, tokens: {} },
  ]);
  mocks.getConnectedAccountsWithErrors.mockResolvedValue({
    accounts: [ACCOUNT],
    errors: [],
  });
  mocks.getClientForConnectedAccount.mockResolvedValue({
    accessToken: "tok",
    email: ACCOUNT,
  });
  mocks.claimSyncAccount.mockImplementation(async (_owner, _account) => ({
    claimId: "claim-1",
    row: currentRow,
  }));
  mocks.ensureSyncAccountRow.mockResolvedValue(baseRow());
  mocks.patchSyncAccount.mockResolvedValue(true);
  mocks.releaseSyncAccount.mockResolvedValue(undefined);
  mocks.upsertInboxThreadRows.mockResolvedValue(undefined);
  mocks.deleteInboxThreadRow.mockResolvedValue(undefined);
  mocks.markThreadsOutOfInboxBeforeSync.mockResolvedValue(undefined);
  mocks.resetSyncAccountProgress.mockResolvedValue(true);
  mocks.readInboxPushGeneration.mockResolvedValue(0);
  mocks.withSyncClaim.mockImplementation(
    async (_owner, _account, _claimId, write) => write({}),
  );
});

let currentRow: any;

describe("syncInboxAccount — full sync", () => {
  it("walks 2 pages, exhausting the budget after page 1, then resumes on the next call", async () => {
    currentRow = baseRow();
    mocks.gmailGetProfile.mockResolvedValue({ historyId: "9000" });

    mocks.gmailListThreads.mockImplementationOnce(async () => {
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
      return { threads: [{ id: "t1" }, { id: "t2" }], nextPageToken: "page2" };
    });
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: thread("t1", { from: "a@ex.com", labelIds: ["INBOX", "UNREAD"] }),
      },
      {
        id: "t2",
        data: thread("t2", { from: "b@ex.com", labelIds: ["INBOX"] }),
      },
    ]);

    const first = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 50 });

    expect(first.state).toBe("initial");
    expect(mocks.upsertInboxThreadRows).toHaveBeenCalledTimes(1);
    expect(mocks.upsertInboxThreadRows.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ fullSyncPageToken: "page2" }),
      { claimId: "claim-1" },
    );
    expect(mocks.gmailListThreads).toHaveBeenCalledTimes(1);
    expect(mocks.markThreadsOutOfInboxBeforeSync).not.toHaveBeenCalled();

    vi.restoreAllMocks();

    currentRow = baseRow({
      fullSyncHistoryId: "9000",
      fullSyncStartedAt: 123,
      fullSyncPageToken: "page2",
    });
    mocks.gmailListThreads.mockResolvedValueOnce({
      threads: [{ id: "t3" }],
      nextPageToken: undefined,
    });
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t3",
        data: thread("t3", { from: "c@ex.com", labelIds: ["INBOX"] }),
      },
    ]);

    const second = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(second.state).toBe("ready");
    expect(mocks.gmailListThreads).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ pageToken: "page2" }),
    );
    expect(mocks.markThreadsOutOfInboxBeforeSync).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      123,
      expect.anything(),
    );
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ historyId: "9000", fullSyncPageToken: null }),
      { claimId: "claim-1" },
    );
  });

  it("aborts a lost claim before the page upsert without writing the page's rows", async () => {
    currentRow = baseRow();
    mocks.gmailGetProfile.mockResolvedValue({ historyId: "9000" });
    mocks.gmailListThreads.mockResolvedValue({
      threads: [{ id: "t1" }],
      nextPageToken: undefined,
    });
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: thread("t1", { from: "a@ex.com", labelIds: ["INBOX"] }),
      },
    ]);
    mocks.withSyncClaim.mockRejectedValueOnce(
      new mocks.SyncClaimLostError(ACCOUNT),
    );

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("initial");
    expect(mocks.upsertInboxThreadRows).not.toHaveBeenCalled();
    expect(mocks.markThreadsOutOfInboxBeforeSync).not.toHaveBeenCalled();
  });
});

describe("syncInboxAccount — incremental sync", () => {
  it("flips in_inbox to 0 when history reports a removed INBOX label", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory.mockResolvedValue({
      history: [
        {
          labelsRemoved: [
            { labelIds: ["INBOX"], message: { id: "t1-m1", threadId: "t1" } },
          ],
        },
      ],
      historyId: "1005",
    });
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: thread("t1", { from: "a@ex.com", labelIds: ["UNREAD"] }),
      },
    ]);

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("ready");
    expect(mocks.invalidateHistoryCacheForAccount).toHaveBeenCalledWith(
      ACCOUNT,
    );
    expect(
      mocks.invalidateHistoryCacheForAccount.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.releaseSyncAccount.mock.invocationCallOrder[0]);
    expect(
      mocks.invalidateListCacheForOwner.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.releaseSyncAccount.mock.invocationCallOrder[0]);
    const upserted = mocks.upsertInboxThreadRows.mock.calls[0][0];
    expect(upserted).toHaveLength(1);
    expect(upserted[0].inInbox).toBe(false);
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ historyId: "1005" }),
      { claimId: "claim-1" },
    );
  });

  it("does not invalidate the history cache after an empty incremental sync", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory.mockResolvedValue({
      history: [],
      historyId: "1000",
    });

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("ready");
    expect(mocks.invalidateHistoryCacheForAccount).not.toHaveBeenCalled();
    expect(mocks.invalidateListCacheForOwner).toHaveBeenCalledWith(OWNER);
  });

  it("stamps upserts at the start of each Gmail read", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory.mockResolvedValue({
      history: [
        {
          messagesAdded: [{ message: { id: "t1-m1", threadId: "t1" } }],
        },
      ],
      historyId: "1005",
    });

    let batchCalledAt = 0;
    let releaseBatch!: () => void;
    const batchReleased = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    mocks.gmailBatchGetThreads.mockImplementationOnce(async () => {
      batchCalledAt = Date.now();
      await batchReleased;
      return [
        {
          id: "t1",
          data: thread("t1", { from: "a@ex.com", labelIds: ["INBOX"] }),
        },
      ];
    });

    const syncPromise = syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });
    await vi.waitFor(() => expect(batchCalledAt).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseBatch();
    await syncPromise;

    const upserted = mocks.upsertInboxThreadRows.mock.calls[0][0];
    expect(upserted[0].syncedAt).toBeLessThanOrEqual(batchCalledAt);
  });

  it("fences deletions to the start of each Gmail read", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory.mockResolvedValue({
      history: [
        {
          messagesDeleted: [{ message: { id: "t1-m1", threadId: "t1" } }],
        },
      ],
      historyId: "1005",
    });

    let batchCalledAt = 0;
    let releaseBatch!: () => void;
    const batchReleased = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    mocks.gmailBatchGetThreads.mockImplementationOnce(async () => {
      batchCalledAt = Date.now();
      await batchReleased;
      return [{ id: "t1", error: "HTTP 404: not found" }];
    });

    const syncPromise = syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });
    await vi.waitFor(() => expect(batchCalledAt).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseBatch();
    await syncPromise;

    expect(mocks.deleteInboxThreadRow).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      "t1",
      expect.any(Number),
      expect.anything(),
    );
    expect(mocks.deleteInboxThreadRow.mock.calls[0][3]).toBeLessThanOrEqual(
      batchCalledAt,
    );
  });

  it("walks every history page and only adopts the mailbox historyId once caught up", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory
      .mockResolvedValueOnce({
        history: [
          {
            id: "1001",
            messagesAdded: [{ message: { id: "t1-m1", threadId: "t1" } }],
          },
        ],
        nextPageToken: "p2",
        historyId: "1010",
      })
      .mockResolvedValueOnce({
        history: [
          {
            id: "1007",
            messagesAdded: [{ message: { id: "t2-m1", threadId: "t2" } }],
          },
        ],
        historyId: "1010",
      });
    mocks.gmailBatchGetThreads
      .mockResolvedValueOnce([
        {
          id: "t1",
          data: thread("t1", { from: "a@ex.com", labelIds: ["INBOX"] }),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "t2",
          data: thread("t2", { from: "b@ex.com", labelIds: ["INBOX"] }),
        },
      ]);

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("ready");
    expect(mocks.gmailListHistory).toHaveBeenCalledTimes(2);
    expect(mocks.gmailListHistory.mock.calls[1][1]).toEqual(
      expect.objectContaining({ pageToken: "p2" }),
    );
    const watermarks = mocks.patchSyncAccount.mock.calls
      .map((call) => call[2].historyId)
      .filter(Boolean);
    expect(watermarks).toEqual(["1001", "1007", "1010"]);
  });

  it("recovers from a 404 on history.list with a fresh full sync", async () => {
    currentRow = baseRow({ historyId: "stale-1" });
    mocks.gmailListHistory.mockRejectedValue(
      new Error("Google API error (404): Requested entity was not found."),
    );
    mocks.gmailGetProfile.mockResolvedValue({ historyId: "2000" });
    mocks.gmailListThreads.mockResolvedValue({
      threads: [],
      nextPageToken: undefined,
    });

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(mocks.resetSyncAccountProgress).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      {
        claimId: "claim-1",
      },
    );
    expect(result.state).toBe("ready");
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ historyId: "2000" }),
      { claimId: "claim-1" },
    );
  });

  it("stops the sync step and reports a non-fatal status when the claim is lost mid-sync", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory.mockResolvedValue({
      history: [
        {
          id: "1001",
          messagesAdded: [{ message: { id: "t1-m1", threadId: "t1" } }],
        },
      ],
      historyId: "1010",
    });
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: thread("t1", { from: "a@ex.com", labelIds: ["INBOX"] }),
      },
    ]);
    mocks.patchSyncAccount.mockResolvedValue(false);

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("initial");
    expect(mocks.patchSyncAccount).not.toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ status: "error" }),
      expect.anything(),
    );
    expect(mocks.releaseSyncAccount).not.toHaveBeenCalled();
  });

  it("invalidates shared caches when a later history page fails after an earlier page was applied", async () => {
    currentRow = baseRow({ historyId: "1000" });
    mocks.gmailListHistory
      .mockResolvedValueOnce({
        history: [
          {
            id: "1001",
            messagesAdded: [{ message: { id: "t1-m1", threadId: "t1" } }],
          },
        ],
        historyId: "1005",
        nextPageToken: "page-2",
      })
      .mockRejectedValueOnce(new Error("history timeout"));
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: thread("t1", { from: "a@ex.com", labelIds: ["INBOX"] }),
      },
    ]);

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("error");
    expect(mocks.upsertInboxThreadRows).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateHistoryCacheForAccount).toHaveBeenCalledWith(
      ACCOUNT,
    );
    expect(mocks.invalidateListCacheForOwner).toHaveBeenCalledWith(OWNER);
  });
});

describe("resetInboxSync", () => {
  it("clears history for every connected account when no accountEmail is given", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["a@example.com", "b@example.com"],
      errors: [],
    });

    await resetInboxSync(OWNER);

    expect(mocks.resetSyncAccountProgress).toHaveBeenCalledWith(
      OWNER,
      "a@example.com",
    );
    expect(mocks.resetSyncAccountProgress).toHaveBeenCalledWith(
      OWNER,
      "b@example.com",
    );
  });

  it("resets a managed workspace grant with no per-user OAuth row", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["managed@example.com"],
      errors: [],
    });

    await resetInboxSync(OWNER);

    expect(mocks.resetSyncAccountProgress).toHaveBeenCalledWith(
      OWNER,
      "managed@example.com",
    );
    expect(mocks.readSyncAccounts).not.toHaveBeenCalled();
  });
});

describe("ensureInboxFresh — managed workspace grant", () => {
  it("syncs a recent account when the pending push generation advances from 9 to 10", async () => {
    currentRow = baseRow({
      historyId: "500",
      lastSyncedAt: Date.now(),
      lastPushGeneration: 9,
    });
    mocks.ensureSyncAccountRow.mockResolvedValue(currentRow);
    mocks.readInboxPushGeneration.mockResolvedValue(10);
    mocks.gmailListHistory.mockResolvedValue({ historyId: "600", history: [] });

    const statuses = await ensureInboxFresh(OWNER, { budgetMs: 5_000 });

    expect(statuses).toEqual([
      expect.objectContaining({ accountEmail: ACCOUNT, state: "ready" }),
    ]);
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      { lastPushGeneration: 10 },
      { claimId: "claim-1" },
    );
  });

  it("leaves a newer push generation pending when it arrives during sync", async () => {
    let liveGeneration = 2;
    currentRow = baseRow({
      historyId: "500",
      lastSyncedAt: Date.now(),
      lastPushGeneration: 1,
    });
    mocks.ensureSyncAccountRow.mockImplementation(async () => currentRow);
    mocks.readInboxPushGeneration.mockImplementation(
      async () => liveGeneration,
    );
    mocks.gmailListHistory.mockImplementationOnce(async () => {
      liveGeneration = 3;
      return { historyId: "600", history: [] };
    });

    await ensureInboxFresh(OWNER, { budgetMs: 5_000 });

    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      { lastPushGeneration: 2 },
      { claimId: "claim-1" },
    );

    currentRow = baseRow({
      historyId: "600",
      lastSyncedAt: Date.now(),
      lastPushGeneration: 2,
    });
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "700",
      history: [],
    });
    const nextStatuses = await ensureInboxFresh(OWNER, { budgetMs: 5_000 });

    expect(nextStatuses).toEqual([
      expect.objectContaining({ accountEmail: ACCOUNT, state: "ready" }),
    ]);
    expect(mocks.claimSyncAccount).toHaveBeenCalledTimes(2);
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      { lastPushGeneration: 3 },
      { claimId: "claim-1" },
    );
  });

  it("syncs a managed grant even when listOAuthAccountsByOwner reports no accounts", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["managed@example.com"],
      errors: [],
    });
    currentRow = baseRow({
      accountEmail: "managed@example.com",
      historyId: "500",
    });
    mocks.ensureSyncAccountRow.mockResolvedValue(currentRow);
    mocks.getClientForConnectedAccount.mockResolvedValue({
      accessToken: "tok",
      email: "managed@example.com",
    });
    mocks.gmailListHistory.mockResolvedValue({
      historyId: "600",
      history: [],
    });

    const statuses = await ensureInboxFresh(OWNER, { budgetMs: 5_000 });

    expect(statuses).toEqual([
      expect.objectContaining({
        accountEmail: "managed@example.com",
        state: "ready",
      }),
    ]);
    expect(mocks.ensureSyncAccountRow).toHaveBeenCalledWith(
      OWNER,
      "managed@example.com",
    );
  });

  it("reuses one connected-account inventory across a multi-account full sync", async () => {
    const accountA = "acct-a@example.com";
    const accountB = "acct-b@example.com";
    const accounts = [accountA, accountB];
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts,
      errors: [],
    });
    mocks.ensureSyncAccountRow.mockImplementation(
      async (_owner, accountEmail) =>
        baseRow({ accountEmail, historyId: null }),
    );
    mocks.claimSyncAccount.mockImplementation(async (_owner, accountEmail) => ({
      claimId: `claim-${accountEmail}`,
      row: baseRow({
        accountEmail,
        historyId: null,
        syncClaimId: `claim-${accountEmail}`,
      }),
    }));
    mocks.getClientForConnectedAccount.mockImplementation(
      async (_owner, accountEmail) => ({
        accessToken: accountEmail,
        email: accountEmail,
      }),
    );
    mocks.gmailGetProfile.mockResolvedValue({ historyId: "900" });
    mocks.gmailListThreads.mockImplementation(async (accessToken: string) =>
      accessToken === accountA
        ? { threads: [{ id: "thread-a" }] }
        : { threads: [] },
    );
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "thread-a",
        data: {
          id: "thread-a",
          historyId: "900",
          snippet: "sent reply",
          messages: [
            {
              id: "external-message",
              threadId: "thread-a",
              internalDate: "1700000000000",
              labelIds: ["INBOX"],
              snippet: "received message",
              payload: {
                headers: [
                  { name: "From", value: "External <external@example.com>" },
                  { name: "To", value: accountA },
                  { name: "Subject", value: "Thread" },
                ],
              },
            },
            {
              id: "connected-message",
              threadId: "thread-a",
              internalDate: "1700000001000",
              labelIds: ["INBOX"],
              snippet: "sent reply",
              payload: {
                headers: [
                  { name: "From", value: `Account B <${accountB}>` },
                  { name: "To", value: "external@example.com" },
                  { name: "Subject", value: "Re: Thread" },
                ],
              },
            },
          ],
        },
      },
    ] as any);

    const statuses = await ensureInboxFresh(OWNER, { budgetMs: 5_000 });

    expect(statuses).toHaveLength(2);
    expect(mocks.getConnectedAccountsWithErrors).toHaveBeenCalledTimes(1);
    const upsertedRows = mocks.upsertInboxThreadRows.mock.calls.flatMap(
      ([rows]) => rows,
    );
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0].fromEmail).toBe("external@example.com");
  });
});

describe("syncInboxAccount — managed workspace grant", () => {
  it("syncs a managed-only account by resolving its client through getClientForConnectedAccount(ownerEmail, accountEmail)", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    currentRow = baseRow({
      accountEmail: "managed@example.com",
      historyId: "500",
    });
    mocks.getClientForConnectedAccount.mockResolvedValue({
      accessToken: "managed-tok",
      email: "managed@example.com",
    });
    mocks.gmailListHistory.mockResolvedValue({
      historyId: "600",
      history: [],
    });

    const result = await syncInboxAccount(OWNER, "managed@example.com", {
      budgetMs: 5_000,
    });

    expect(result.state).toBe("ready");
    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      OWNER,
      "managed@example.com",
    );
  });

  it("fails the account cleanly when neither an OAuth row nor the managed grant resolves a client", async () => {
    currentRow = baseRow({ accountEmail: "managed@example.com" });
    mocks.getClientForConnectedAccount.mockResolvedValue(null);

    const result = await syncInboxAccount(OWNER, "managed@example.com", {
      budgetMs: 5_000,
    });

    expect(result.state).toBe("error");
    expect(result.error).toContain("not connected");
  });

  it("treats the managed account's own sent reply as self even with no per-user OAuth row", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["managed@example.com"],
      errors: [],
    });
    currentRow = baseRow({
      accountEmail: "managed@example.com",
      historyId: "500",
    });
    mocks.getClientForConnectedAccount.mockResolvedValue({
      accessToken: "managed-tok",
      email: "managed@example.com",
    });
    mocks.gmailListHistory.mockResolvedValue({
      historyId: "600",
      history: [
        {
          id: "601",
          messagesAdded: [{ message: { id: "t1-m2", threadId: "t1" } }],
        },
      ],
    });
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: {
          id: "t1",
          historyId: "600",
          snippet: "thread snippet",
          messages: [
            {
              id: "t1-m1",
              internalDate: "1700000000000",
              labelIds: ["INBOX"],
              payload: {
                headers: [
                  { name: "From", value: "External <ext@example.com>" },
                  { name: "To", value: "managed@example.com" },
                  { name: "Subject", value: "Hello" },
                ],
              },
            },
            {
              id: "t1-m2",
              internalDate: "1700000005000",
              labelIds: ["INBOX"],
              payload: {
                headers: [
                  { name: "From", value: "Managed <managed@example.com>" },
                  { name: "To", value: "ext@example.com" },
                  { name: "Subject", value: "Re: Hello" },
                ],
              },
            },
          ],
        },
      },
    ]);

    const result = await syncInboxAccount(OWNER, "managed@example.com", {
      budgetMs: 5_000,
    });

    expect(result.state).toBe("ready");
    const upserted = mocks.upsertInboxThreadRows.mock.calls[0][0];
    expect(upserted).toHaveLength(1);
    expect(upserted[0].fromEmail).toBe("ext@example.com");
  });
});
