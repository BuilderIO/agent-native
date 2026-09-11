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
    getConnectedAccounts: vi.fn(),
    gmailGetProfile: vi.fn(),
    gmailListThreads: vi.fn(),
    gmailListHistory: vi.fn(),
    gmailListLabels: vi.fn(),
    gmailBatchGetThreads: vi.fn(),
    getClientForAccount: vi.fn(),
    invalidateListCacheForOwner: vi.fn(),
    ensureSyncAccountRow: vi.fn(),
    claimSyncAccount: vi.fn(),
    releaseSyncAccount: vi.fn(),
    patchSyncAccount: vi.fn(),
    resetSyncAccountProgress: vi.fn(),
    upsertInboxThreadRows: vi.fn(),
    deleteInboxThreadRow: vi.fn(),
    markThreadsOutOfInboxBeforeSync: vi.fn(),
    readSyncAccounts: vi.fn(),
    assertSyncClaimHeld: vi.fn(),
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
    getClientForAccount: mocks.getClientForAccount,
    getConnectedAccounts: mocks.getConnectedAccounts,
    invalidateListCacheForOwner: mocks.invalidateListCacheForOwner,
  };
});

vi.mock("./inbox-store.js", () => ({
  ensureSyncAccountRow: mocks.ensureSyncAccountRow,
  claimSyncAccount: mocks.claimSyncAccount,
  releaseSyncAccount: mocks.releaseSyncAccount,
  patchSyncAccount: mocks.patchSyncAccount,
  resetSyncAccountProgress: mocks.resetSyncAccountProgress,
  upsertInboxThreadRows: mocks.upsertInboxThreadRows,
  deleteInboxThreadRow: mocks.deleteInboxThreadRow,
  markThreadsOutOfInboxBeforeSync: mocks.markThreadsOutOfInboxBeforeSync,
  readSyncAccounts: mocks.readSyncAccounts,
  assertSyncClaimHeld: mocks.assertSyncClaimHeld,
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
    syncClaimId: "claim-1",
    syncClaimedAt: Date.now(),
    // Fresh so tests don't also have to mock a labels.list round trip.
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
  mocks.getConnectedAccounts.mockResolvedValue([ACCOUNT]);
  mocks.getClientForAccount.mockResolvedValue({
    accessToken: "tok",
    email: ACCOUNT,
  });
  mocks.claimSyncAccount.mockImplementation(async (_owner, _account) => ({
    claimId: "claim-1",
    row: currentRow,
  }));
  mocks.ensureSyncAccountRow.mockResolvedValue(baseRow());
  // Fenced writes report whether a row matched — default to "matched" so
  // existing tests exercise the happy path; claim-loss tests below override
  // this to false for the specific call under test.
  mocks.patchSyncAccount.mockResolvedValue(true);
  mocks.releaseSyncAccount.mockResolvedValue(undefined);
  mocks.upsertInboxThreadRows.mockResolvedValue(undefined);
  mocks.deleteInboxThreadRow.mockResolvedValue(undefined);
  mocks.markThreadsOutOfInboxBeforeSync.mockResolvedValue(undefined);
  mocks.resetSyncAccountProgress.mockResolvedValue(true);
  mocks.assertSyncClaimHeld.mockResolvedValue(undefined);
});

// The row `claimSyncAccount` hands back for the call under test — tests set
// this directly since `syncInboxAccount` always claims via the mock above.
let currentRow: any;

describe("syncInboxAccount — full sync", () => {
  it("walks 2 pages, exhausting the budget after page 1, then resumes on the next call", async () => {
    currentRow = baseRow();
    mocks.gmailGetProfile.mockResolvedValue({ historyId: "9000" });

    mocks.gmailListThreads.mockImplementationOnce(async () => {
      // Simulate page 1 taking long enough to blow the budget.
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
    // Page token persisted so the next call resumes instead of restarting.
    // Fenced to the claim held for this sync step (see SyncClaimLostError).
    expect(mocks.patchSyncAccount).toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ fullSyncPageToken: "page2" }),
      { claimId: "claim-1" },
    );
    expect(mocks.gmailListThreads).toHaveBeenCalledTimes(1);
    expect(mocks.markThreadsOutOfInboxBeforeSync).not.toHaveBeenCalled();

    vi.restoreAllMocks();

    // Resume: the row now carries the persisted page token + full-sync id.
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
    // A newer worker has already taken the claim by the time this page's
    // hydrate round trip finishes.
    mocks.assertSyncClaimHeld.mockRejectedValueOnce(
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
    // Refetching the thread shows its current (post-removal) state.
    mocks.gmailBatchGetThreads.mockResolvedValueOnce([
      {
        id: "t1",
        data: thread("t1", { from: "a@ex.com", labelIds: ["UNREAD"] }),
      },
    ]);

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    expect(result.state).toBe("ready");
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
    // Page 1 must persist its last record id, never the mailbox id, so a
    // budget cut between pages cannot skip page 2.
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
    // The fenced watermark write reports 0 rows matched — another worker's
    // claim has already taken over this account.
    mocks.patchSyncAccount.mockResolvedValue(false);

    const result = await syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    // Non-fatal: never "error"/"needs_reauth", and no status/lastError write
    // (that would stomp the newer worker's row — see failAccount).
    expect(result.state).toBe("initial");
    expect(mocks.patchSyncAccount).not.toHaveBeenCalledWith(
      OWNER,
      ACCOUNT,
      expect.objectContaining({ status: "error" }),
      expect.anything(),
    );
    // The stale claim no longer matches, so releasing it is a no-op by
    // construction — never called with a status write for this worker's run.
    expect(mocks.releaseSyncAccount).not.toHaveBeenCalled();
  });
});

describe("resetInboxSync", () => {
  it("clears history for every connected account when no accountEmail is given", async () => {
    mocks.getConnectedAccounts.mockResolvedValue([
      "a@example.com",
      "b@example.com",
    ]);

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
    // No OAuth accounts at all — only getConnectedAccounts (which falls
    // back to the managed client's email) reports this account exists.
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getConnectedAccounts.mockResolvedValue(["managed@example.com"]);

    await resetInboxSync(OWNER);

    expect(mocks.resetSyncAccountProgress).toHaveBeenCalledWith(
      OWNER,
      "managed@example.com",
    );
    expect(mocks.readSyncAccounts).not.toHaveBeenCalled();
  });
});

describe("ensureInboxFresh — managed workspace grant", () => {
  it("syncs a managed grant even when listOAuthAccountsByOwner reports no accounts", async () => {
    // HIGH review finding: listOAuthAccountsByOwner returning [] must not be
    // read as "disconnected" — getConnectedAccounts (OAuth rows, else the
    // managed client's email) is the single source of which accounts exist.
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getConnectedAccounts.mockResolvedValue(["managed@example.com"]);
    currentRow = baseRow({
      accountEmail: "managed@example.com",
      historyId: "500",
    });
    mocks.ensureSyncAccountRow.mockResolvedValue(currentRow);
    mocks.getClientForAccount.mockResolvedValue({
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
});
