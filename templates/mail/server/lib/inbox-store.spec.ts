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
  pushInvalidations: [] as any[],
  inserts: [] as any[],
  updates: [] as Array<{ table: string; set: any; cond: any }>,
  conflictUpdates: [] as any[],
  deletes: [] as any[],
  deleteTables: [] as string[],
  lockModes: [] as string[],
  transactions: 0,
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
    mailInboxPushInvalidations: {
      __name: "mail_inbox_push_invalidations",
      id: "id",
      ownerEmail: "ownerEmail",
      accountEmail: "accountEmail",
      generation: "generation",
    },
  };

  function chainable(getRows: () => any[]) {
    const obj: any = {
      orderBy: () => chainable(getRows),
      limit: () => chainable(getRows),
      for: (mode: string) => {
        dbState.lockModes.push(mode);
        return chainable(getRows);
      },
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
              : table === schema.mailInboxPushInvalidations
                ? dbState.pushInvalidations
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
    insert: (table: any) => ({
      values: (values: any) => {
        dbState.inserts.push({ table: table.__name, values });
        return {
          onConflictDoNothing: async () => undefined,
          onConflictDoUpdate: async (config: any) => {
            dbState.conflictUpdates.push(config);
          },
        };
      },
    }),
    delete: (table: any) => ({
      where: async (cond: any) => {
        dbState.deletes.push(cond);
        dbState.deleteTables.push(table.__name);
      },
    }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      dbState.transactions++;
      return fn(db);
    },
  };

  return { schema, getDb: () => db };
});

import {
  applyLocalLabelDelta,
  patchSyncAccount,
  readInboxPushGeneration,
  readCachedLabels,
  recordInboxPushInvalidation,
  resetSyncAccountProgress,
  SyncClaimLostError,
  deleteInboxThreadRow,
  markThreadsOutOfInboxBeforeSync,
  upsertInboxThreadRows,
  withSyncClaim,
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
    lastPushGeneration: 0,
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
  dbState.pushInvalidations = [];
  dbState.inserts = [];
  dbState.updates = [];
  dbState.conflictUpdates = [];
  dbState.deletes = [];
  dbState.deleteTables = [];
  dbState.lockModes = [];
  dbState.transactions = 0;
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
      {
        add: ["STARRED"],
        remove: ["UNREAD"],
        providerHistoryId: "12",
      },
    );

    expect(dbState.updates).toHaveLength(1);
    const { set } = dbState.updates[0];
    const labels = JSON.parse(set.labelIdsJson);
    expect(labels.sort()).toEqual(["INBOX", "STARRED"]);
    expect(set.inInbox).toBe(1);
    expect(set.isUnread).toBe(0);
    expect(set.isStarred).toBe(1);
    expect(set.localMutationAt).toEqual(expect.any(Number));
    expect(set.localMutationHistoryId).toBe("12");
    expect(set.localMutationFields).toEqual(expect.any(Number));
    expect(set.unreadCount).toBe(0);
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

  it("fences untrash label removal as an inbox and label mutation", async () => {
    dbState.threadRows = [
      {
        id: "owner@example.com:acct1@example.com:t1",
        labelIdsJson: JSON.stringify(["TRASH"]),
      },
    ];

    await applyLocalLabelDelta(
      "owner@example.com",
      "acct1@example.com",
      ["t1"],
      { remove: ["TRASH"], providerHistoryId: "12" },
    );

    expect(dbState.updates[0].set.localMutationAt).toEqual(expect.any(Number));
    expect(dbState.updates[0].set.localMutationHistoryId).toBe("12");
    expect(dbState.updates[0].set.localMutationFields).toBe(17);
  });

  it("keeps overlapping local field claims and the newest provider fence", async () => {
    dbState.threadRows = [
      {
        id: "owner@example.com:acct1@example.com:t1",
        labelIdsJson: JSON.stringify(["INBOX"]),
        messageIdsJson: JSON.stringify(["m1"]),
        unreadCount: 0,
        localMutationHistoryId: "20",
        localMutationFields: 1,
      },
    ];

    await applyLocalLabelDelta(
      "owner@example.com",
      "acct1@example.com",
      ["t1"],
      { add: ["UNREAD"], providerHistoryId: "10" },
    );

    expect(dbState.updates[0].set.localMutationFields).toBe(3);
    expect(dbState.updates[0].set.localMutationHistoryId).toBe("20");
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
    it("defers message-scoped read aggregates without per-message labels", async () => {
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
      expect(set.unreadCount).toBeUndefined();
      expect(set.isUnread).toBeUndefined();
      // The row has no per-message labels, so leave the aggregate untouched
      // until the next exact thread sync.
      expect(JSON.parse(set.labelIdsJson)).toContain("UNREAD");
    });

    it("does not mark a message-scoped read as a thread-wide read", async () => {
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
      expect(set.unreadCount).toBeUndefined();
      expect(set.isUnread).toBeUndefined();
      expect(JSON.parse(set.labelIdsJson)).toContain("UNREAD");
    });

    it("does not invent an unread aggregate for a message-scoped mark-unread", async () => {
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
      expect(set.unreadCount).toBeUndefined();
      expect(set.isUnread).toBeUndefined();
      expect(JSON.parse(set.labelIdsJson)).not.toContain("UNREAD");
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
      expect(dbState.updates[0].set.localMutationFields).toEqual(
        expect.any(Number),
      );
    });
  });
});

describe("Gmail push invalidations", () => {
  it("coalesces pushes into one normalized account generation", async () => {
    await recordInboxPushInvalidation("Owner@Example.com", "Acct@Example.com");
    await recordInboxPushInvalidation("owner@example.com", "acct@example.com");

    expect(dbState.inserts).toHaveLength(2);
    expect(dbState.inserts[0].table).toBe("mail_inbox_push_invalidations");
    expect(dbState.inserts[0].values).toMatchObject({
      id: "owner@example.com:acct@example.com",
      ownerEmail: "owner@example.com",
      accountEmail: "acct@example.com",
      generation: 1,
    });
    expect(dbState.inserts[1].values.id).toBe(dbState.inserts[0].values.id);
    expect(dbState.conflictUpdates).toHaveLength(2);
    expect(dbState.conflictUpdates[0].set.generation).toMatchObject({
      op: "sql",
    });
  });

  it("sums legacy markers as a number across the 9-to-10 boundary", async () => {
    dbState.pushInvalidations = [{ generation: 9 }, { generation: 1 }];

    const generation = await readInboxPushGeneration(
      "owner@example.com",
      "acct@example.com",
    );

    expect(generation).toBe(10);
  });
});

describe("sync write fences", () => {
  it("only applies a sync row when it is newer than a local update", async () => {
    await upsertInboxThreadRows([
      {
        ownerEmail: "owner@example.com",
        accountEmail: "acct1@example.com",
        threadId: "t1",
        inInbox: true,
        isUnread: true,
        isStarred: false,
        isImportant: false,
        isAutomated: false,
        latestDate: 1,
        latestMessageId: "m1",
        subject: "subject",
        snippet: "snippet",
        fromName: "Sender",
        fromEmail: "sender@example.com",
        to: [],
        labelIds: ["INBOX", "UNREAD"],
        messageIds: ["m1"],
        messageCount: 1,
        unreadCount: 1,
        hasAttachments: false,
        syncedAt: 100,
      },
    ]);

    expect(dbState.conflictUpdates[0].setWhere).toMatchObject({ op: "sql" });
    expect(dbState.conflictUpdates[0].setWhere.strings.join(" ")).toContain(
      "label_ids_json",
    );
    expect(dbState.conflictUpdates[0].setWhere.strings.join(" ")).toContain(
      "unread_count",
    );
  });

  it("drops the provider fence when a later mutation has no fence", async () => {
    dbState.threadRows = [
      {
        id: "owner@example.com:acct1@example.com:t1",
        labelIdsJson: JSON.stringify(["INBOX"]),
        localMutationHistoryId: "20",
        localMutationFields: 1,
      },
    ];

    await applyLocalLabelDelta(
      "owner@example.com",
      "acct1@example.com",
      ["t1"],
      { remove: ["INBOX"] },
    );

    expect(dbState.updates[0].set.localMutationHistoryId).toBeNull();
  });

  it("does not let full-sync cleanup mark a locally updated row stale", async () => {
    await markThreadsOutOfInboxBeforeSync(
      "owner@example.com",
      "acct1@example.com",
      100,
    );

    expect(dbState.updates[0].cond.args).toHaveLength(5);
  });

  it("fences incremental deletes to the start of the Gmail read", async () => {
    await deleteInboxThreadRow(
      "owner@example.com",
      "acct1@example.com",
      "t1",
      100,
    );

    expect(dbState.deletes[0].args).toHaveLength(2);
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

describe("withSyncClaim", () => {
  it("runs inbox writes under a lock on the matching claim", async () => {
    dbState.syncAccounts = [syncAccountRow({ syncClaimId: "claim-1" })];
    const write = vi.fn(async () => undefined);

    await withSyncClaim(
      "owner@example.com",
      "acct1@example.com",
      "claim-1",
      write,
    );

    expect(dbState.transactions).toBe(1);
    expect(dbState.lockModes).toEqual(["update"]);
    expect(write).toHaveBeenCalledOnce();
  });

  it("skips inbox writes after a push or newer worker clears the claim", async () => {
    dbState.syncAccounts = [syncAccountRow({ syncClaimId: "claim-2" })];
    const write = vi.fn(async () => undefined);

    await expect(
      withSyncClaim("owner@example.com", "acct1@example.com", "claim-1", write),
    ).rejects.toThrow(SyncClaimLostError);
    expect(write).not.toHaveBeenCalled();
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
