import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fakes just enough of the drizzle chain shape inbox-store.ts uses
 * (select().from(table).where(cond)[.orderBy()], update().set().where(),
 * insert().values()...) to drive it without a real database — same style as
 * inventory-cursor.spec.ts / queued-drafts.spec.ts. `where`/`orderBy`
 * conditions are recorded, not actually evaluated; each test controls what
 * the canned rows are directly.
 */
const dbState = vi.hoisted(() => ({
  syncAccounts: [] as any[],
  threadRows: [] as any[],
  updates: [] as Array<{ table: string; set: any; cond: any }>,
  // When true, the next update().set().where().returning() call reports 0
  // matched rows — simulates a fenced write whose claimId no longer matches
  // the row (another worker already claimed it).
  forceNoRowsMatched: false,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: unknown, val: unknown) => ({ op: "inArray", col, val }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  lt: (col: unknown, val: unknown) => ({ op: "lt", col, val }),
  desc: (col: unknown) => ({ op: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    strings,
    values,
  }),
}));

vi.mock("../db/index.js", () => {
  const schema = {
    mailSyncAccounts: { __name: "mail_sync_accounts" },
    mailInboxThreads: { __name: "mail_inbox_threads" },
  };

  function chainable(getRows: () => any[]) {
    const obj: any = {
      orderBy: () => chainable(getRows),
      limit: () => chainable(getRows),
      then: (resolve: any, reject: any) =>
        Promise.resolve(getRows()).then(resolve, reject),
    };
    return obj;
  }

  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () =>
          chainable(() =>
            table === schema.mailSyncAccounts
              ? dbState.syncAccounts
              : dbState.threadRows,
          ),
      }),
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: (cond: any) => {
          dbState.updates.push({ table: table.__name, set: values, cond });
          const rows = dbState.forceNoRowsMatched ? [] : [{ id: "row" }];
          return {
            returning: async () => rows,
            then: (resolve: any) => resolve(undefined),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
        onConflictDoUpdate: async () => undefined,
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  };

  return { schema, getDb: () => db };
});

import {
  applyLocalLabelDelta,
  assertSyncClaimHeld,
  patchSyncAccount,
  readCachedLabels,
  resetSyncAccountProgress,
  SyncClaimLostError,
} from "./inbox-store.js";

function syncAccountRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "owner:acct",
    ownerEmail: "owner@example.com",
    accountEmail: "acct1@example.com",
    historyId: "1",
    fullSyncPageToken: null,
    fullSyncHistoryId: null,
    fullSyncStartedAt: null,
    status: "idle",
    lastError: null,
    lastSyncedAt: 100,
    syncClaimId: null,
    syncClaimedAt: null,
    labelsJson: null,
    labelsUpdatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.syncAccounts = [];
  dbState.threadRows = [];
  dbState.updates = [];
  dbState.forceNoRowsMatched = false;
});

describe("readCachedLabels", () => {
  it("merges label counts across two accounts and keeps raw label maps per account", async () => {
    dbState.syncAccounts = [
      syncAccountRow({
        accountEmail: "acct1@example.com",
        labelsJson: JSON.stringify([
          { id: "INBOX", name: "INBOX", threadsTotal: 5, threadsUnread: 2 },
          { id: "Label_1", name: "Work", threadsTotal: 3, threadsUnread: 1 },
        ]),
      }),
      syncAccountRow({
        accountEmail: "acct2@example.com",
        labelsJson: JSON.stringify([
          { id: "INBOX", name: "INBOX", threadsTotal: 10, threadsUnread: 4 },
          { id: "Label_1", name: "Work", threadsTotal: 2, threadsUnread: 0 },
        ]),
      }),
    ];

    const { labels, labelMapByAccount } =
      await readCachedLabels("owner@example.com");

    const inbox = labels.find((l) => l.id === "inbox")!;
    expect(inbox.totalCount).toBe(15);
    expect(inbox.unreadCount).toBe(6);

    const work = labels.find((l) => l.id === "work")!;
    expect(work.type).toBe("user");
    expect(work.totalCount).toBe(5);
    expect(work.unreadCount).toBe(1);

    expect(labelMapByAccount.get("acct1@example.com")?.get("Label_1")).toBe(
      "Work",
    );
    expect(labelMapByAccount.get("acct2@example.com")?.get("INBOX")).toBe(
      "INBOX",
    );
  });

  it("never throws for a requested account with no cached labels — returns an empty map", async () => {
    dbState.syncAccounts = [
      syncAccountRow({ accountEmail: "acct1@example.com" }),
    ];

    const { labelMapByAccount } = await readCachedLabels("owner@example.com", [
      "acct1@example.com",
      "acct-never-synced@example.com",
    ]);

    expect(labelMapByAccount.get("acct1@example.com")?.size).toBe(0);
    expect(labelMapByAccount.get("acct-never-synced@example.com")?.size).toBe(
      0,
    );
  });
});

describe("applyLocalLabelDelta", () => {
  it("recomputes in_inbox/is_unread/is_starred from the add/remove delta", async () => {
    dbState.threadRows = [
      {
        id: "owner@example.com:acct1@example.com:t1",
        labelIdsJson: JSON.stringify(["INBOX", "UNREAD"]),
      },
    ];

    await applyLocalLabelDelta(
      "owner@example.com",
      "acct1@example.com",
      ["t1"],
      { add: ["STARRED"], remove: ["UNREAD"] },
    );

    expect(dbState.updates).toHaveLength(1);
    const { set } = dbState.updates[0];
    const labels = JSON.parse(set.labelIdsJson);
    expect(labels.sort()).toEqual(["INBOX", "STARRED"]);
    expect(set.inInbox).toBe(1);
    expect(set.isUnread).toBe(0);
    expect(set.isStarred).toBe(1);
  });

  it("flips in_inbox to 0 when INBOX is removed (archive)", async () => {
    dbState.threadRows = [
      {
        id: "owner@example.com:acct1@example.com:t1",
        labelIdsJson: JSON.stringify(["INBOX", "UNREAD"]),
      },
    ];

    await applyLocalLabelDelta(
      "owner@example.com",
      "acct1@example.com",
      ["t1"],
      { remove: ["INBOX"] },
    );

    expect(dbState.updates[0].set.inInbox).toBe(0);
  });

  it("is a no-op for a thread that hasn't synced yet", async () => {
    dbState.threadRows = [];
    await applyLocalLabelDelta(
      "owner@example.com",
      "acct1@example.com",
      ["missing"],
      {
        add: ["STARRED"],
      },
    );
    expect(dbState.updates).toHaveLength(0);
  });

  describe("scope: message", () => {
    it("removing UNREAD decrements unread_count by only the targeted message ids", async () => {
      dbState.threadRows = [
        {
          id: "owner@example.com:acct1@example.com:t1",
          labelIdsJson: JSON.stringify(["INBOX", "UNREAD"]),
          messageIdsJson: JSON.stringify(["m1", "m2", "m3"]),
          unreadCount: 3,
        },
      ];

      await applyLocalLabelDelta(
        "owner@example.com",
        "acct1@example.com",
        ["t1"],
        { remove: ["UNREAD"], scope: "message", messageIds: ["m1"] },
      );

      const { set } = dbState.updates[0];
      expect(set.unreadCount).toBe(2);
      expect(set.isUnread).toBe(1);
      // Other messages in the thread are still unread — the union must keep
      // UNREAD, not drop it just because one message was read.
      expect(JSON.parse(set.labelIdsJson)).toContain("UNREAD");
    });

    it("marks the thread read once the last targeted unread message is cleared", async () => {
      dbState.threadRows = [
        {
          id: "owner@example.com:acct1@example.com:t1",
          labelIdsJson: JSON.stringify(["INBOX", "UNREAD"]),
          messageIdsJson: JSON.stringify(["m1"]),
          unreadCount: 1,
        },
      ];

      await applyLocalLabelDelta(
        "owner@example.com",
        "acct1@example.com",
        ["t1"],
        { remove: ["UNREAD"], scope: "message", messageIds: ["m1"] },
      );

      const { set } = dbState.updates[0];
      expect(set.unreadCount).toBe(0);
      expect(set.isUnread).toBe(0);
      expect(JSON.parse(set.labelIdsJson)).not.toContain("UNREAD");
    });

    it("adding UNREAD increments unread_count and marks the thread unread", async () => {
      dbState.threadRows = [
        {
          id: "owner@example.com:acct1@example.com:t1",
          labelIdsJson: JSON.stringify(["INBOX"]),
          messageIdsJson: JSON.stringify(["m1", "m2"]),
          unreadCount: 0,
        },
      ];

      await applyLocalLabelDelta(
        "owner@example.com",
        "acct1@example.com",
        ["t1"],
        { add: ["UNREAD"], scope: "message", messageIds: ["m1"] },
      );

      const { set } = dbState.updates[0];
      expect(set.unreadCount).toBe(1);
      expect(set.isUnread).toBe(1);
    });

    it("adding STARRED sets the thread flag immediately", async () => {
      dbState.threadRows = [
        {
          id: "owner@example.com:acct1@example.com:t1",
          labelIdsJson: JSON.stringify(["INBOX"]),
          messageIdsJson: JSON.stringify(["m1"]),
          unreadCount: 0,
        },
      ];

      await applyLocalLabelDelta(
        "owner@example.com",
        "acct1@example.com",
        ["t1"],
        { add: ["STARRED"], scope: "message", messageIds: ["m1"] },
      );

      expect(dbState.updates[0].set.isStarred).toBe(1);
    });

    it("removing STARRED leaves the thread flag unchanged (no per-message star tracking)", async () => {
      dbState.threadRows = [
        {
          id: "owner@example.com:acct1@example.com:t1",
          labelIdsJson: JSON.stringify(["INBOX", "STARRED"]),
          messageIdsJson: JSON.stringify(["m1", "m2"]),
          unreadCount: 0,
        },
      ];

      await applyLocalLabelDelta(
        "owner@example.com",
        "acct1@example.com",
        ["t1"],
        { remove: ["STARRED"], scope: "message", messageIds: ["m1"] },
      );

      expect(dbState.updates[0].set.isStarred).toBeUndefined();
      // The union must not lose STARRED either — same reasoning as isStarred.
      expect(JSON.parse(dbState.updates[0].set.labelIdsJson)).toContain(
        "STARRED",
      );
    });
  });
});

describe("patchSyncAccount", () => {
  it("updates unconditionally when no claimId is given (label-cache writes)", async () => {
    const updated = await patchSyncAccount(
      "owner@example.com",
      "acct1@example.com",
      {
        lastError: null,
      },
    );

    expect(updated).toBe(true);
    expect(dbState.updates[0].cond.args).toHaveLength(1);
  });

  it("fences the write to the claim id when opts.claimId is given", async () => {
    const updated = await patchSyncAccount(
      "owner@example.com",
      "acct1@example.com",
      { lastError: null },
      { claimId: "claim-1" },
    );

    expect(updated).toBe(true);
    expect(dbState.updates[0].cond.args).toHaveLength(2);
  });

  it("reports false without throwing when the fenced claim no longer matches", async () => {
    dbState.forceNoRowsMatched = true;

    const updated = await patchSyncAccount(
      "owner@example.com",
      "acct1@example.com",
      { lastError: null },
      { claimId: "stale-claim" },
    );

    expect(updated).toBe(false);
  });
});

describe("assertSyncClaimHeld", () => {
  it("resolves when the row's claim still matches", async () => {
    dbState.syncAccounts = [syncAccountRow({ syncClaimId: "claim-1" })];

    await expect(
      assertSyncClaimHeld("owner@example.com", "acct1@example.com", "claim-1"),
    ).resolves.toBeUndefined();
  });

  it("throws SyncClaimLostError when a newer worker holds the claim", async () => {
    dbState.syncAccounts = [syncAccountRow({ syncClaimId: "claim-2" })];

    await expect(
      assertSyncClaimHeld("owner@example.com", "acct1@example.com", "claim-1"),
    ).rejects.toThrow(SyncClaimLostError);
  });

  it("throws SyncClaimLostError when the account row is gone", async () => {
    dbState.syncAccounts = [];

    await expect(
      assertSyncClaimHeld("owner@example.com", "acct1@example.com", "claim-1"),
    ).rejects.toThrow(SyncClaimLostError);
  });
});

describe("resetSyncAccountProgress", () => {
  it("clears the claim columns in the same update as the progress reset", async () => {
    await resetSyncAccountProgress("owner@example.com", "acct1@example.com");

    const { set } = dbState.updates[0];
    expect(set.historyId).toBeNull();
    expect(set.fullSyncPageToken).toBeNull();
    expect(set.fullSyncHistoryId).toBeNull();
    expect(set.fullSyncStartedAt).toBeNull();
    expect(set.syncClaimId).toBeNull();
    expect(set.syncClaimedAt).toBeNull();
  });
});
