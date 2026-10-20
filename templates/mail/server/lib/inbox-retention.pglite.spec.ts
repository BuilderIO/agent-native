import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.UTC(2026, 9, 20);
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

type Stores = typeof import("./inbox-store.js");
type Retention = typeof import("./inbox-retention.js");
type Exec = { execute: (q: { sql: string; args?: unknown[] }) => Promise<any> };

let stores: Stores;
let retention: Retention;
let exec: Exec;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  const [{ default: initializeMailDb }, core, storeModule, retentionModule] =
    await Promise.all([
      import("../plugins/db.js"),
      import("@agent-native/core/db"),
      import("./inbox-store.js"),
      import("./inbox-retention.js"),
    ]);
  await initializeMailDb({});
  exec = core.getDbExec() as unknown as Exec;
  await exec.execute({
    sql: `CREATE TABLE IF NOT EXISTS public.oauth_tokens (
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      owner TEXT,
      tokens TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      revision BIGINT NOT NULL,
      PRIMARY KEY (provider, account_id)
    )`,
  });
  stores = storeModule;
  retention = retentionModule;
});

afterEach(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
  Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessLocks",
  );
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessExitCleanupRegistered",
  );
  vi.unstubAllEnvs();
  vi.resetModules();
});

function thread(
  owner: string,
  account: string,
  threadId: string,
  latestDate: number,
  inInbox: boolean,
) {
  return {
    ownerEmail: owner,
    accountEmail: account,
    threadId,
    inInbox,
    isUnread: false,
    isStarred: false,
    isImportant: false,
    isAutomated: false,
    latestDate,
    latestMessageId: `${threadId}-m`,
    subject: "subject",
    snippet: "",
    fromName: "",
    fromEmail: "sender@example.com",
    to: [],
    labelIds: inInbox ? ["INBOX"] : [],
    messageIds: [`${threadId}-m`],
    messageCount: 1,
    unreadCount: 0,
    hasAttachments: false,
    syncedAt: latestDate,
  };
}

async function insertThreads(rows: ReturnType<typeof thread>[]) {
  for (let i = 0; i < rows.length; i += 400) {
    await stores.upsertInboxThreadRows(rows.slice(i, i + 400));
  }
}

async function countRows(owner: string, account: string, inInbox?: 0 | 1) {
  const { rows } = await exec.execute({
    sql: `SELECT count(*)::int AS n FROM mail_inbox_threads
      WHERE owner_email = $1 AND account_email = $2
      ${inInbox === undefined ? "" : "AND in_inbox = $3"}`,
    args: inInbox === undefined ? [owner, account] : [owner, account, inInbox],
  });
  return Number(rows[0].n);
}

async function setRowTimes(
  threadId: string,
  updatedAt: number,
  localMutationAt: number | null = null,
) {
  await exec.execute({
    sql: `UPDATE mail_inbox_threads SET updated_at = $1, local_mutation_at = $2 WHERE thread_id = $3`,
    args: [updatedAt, localMutationAt, threadId],
  });
}

describe("trimInboxThreadRows (PGlite)", () => {
  it("keeps the newest in-inbox rows and never counts archived rows", async () => {
    const owner = "owner@example.com";
    const account = "acct@example.com";
    const inbox = Array.from({ length: 2_050 }, (_, i) =>
      thread(owner, account, `in-${i}`, 1_000_000 + i, true),
    );
    // Archived rows are newer than every inbox row, so they would win a
    // latest_date-only cap and push inbox rows out.
    const archived = Array.from({ length: 30 }, (_, i) =>
      thread(owner, account, `arch-${i}`, 5_000_000 + i, false),
    );
    await insertThreads([...inbox, ...archived]);

    const deleted = await stores.trimInboxThreadRows(owner, account);

    expect(deleted).toBe(50);
    expect(await countRows(owner, account, 1)).toBe(2_000);
    expect(await countRows(owner, account, 0)).toBe(30);
    const { rows } = await exec.execute({
      sql: `SELECT min(latest_date)::bigint AS oldest FROM mail_inbox_threads
        WHERE owner_email = $1 AND account_email = $2 AND in_inbox = 1`,
      args: [owner, account],
    });
    expect(Number(rows[0].oldest)).toBe(1_000_050);
  });

  it("leaves another account's rows alone", async () => {
    const owner = "owner@example.com";
    await insertThreads([
      ...Array.from({ length: 5 }, (_, i) =>
        thread(owner, "a@example.com", `a-${i}`, 1_000 + i, true),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        thread(owner, "b@example.com", `b-${i}`, 1_000 + i, true),
      ),
    ]);

    await stores.trimInboxThreadRows(owner, "a@example.com", 2);

    expect(await countRows(owner, "a@example.com")).toBe(2);
    expect(await countRows(owner, "b@example.com")).toBe(5);
  });
});

describe("purgeArchivedInboxThreadRows (PGlite)", () => {
  it("deletes archived rows only once the grace window has passed", async () => {
    const owner = "owner@example.com";
    const account = "acct@example.com";
    await insertThreads([
      thread(owner, account, "expired", 1, false),
      thread(owner, account, "recent", 2, false),
      thread(owner, account, "fenced", 3, false),
      thread(owner, account, "inbox", 4, true),
    ]);
    await setRowTimes("expired", NOW - HOUR);
    await setRowTimes("recent", NOW - 5 * 60_000);
    await setRowTimes("fenced", NOW - HOUR, NOW - 60_000);
    await setRowTimes("inbox", NOW - DAY);

    const deleted = await stores.purgeArchivedInboxThreadRows(
      owner,
      account,
      NOW,
    );

    expect(deleted).toBe(1);
    expect(await countRows(owner, account, 0)).toBe(2);
    expect(await countRows(owner, account, 1)).toBe(1);
  });
});

describe("runInboxRetention (PGlite)", () => {
  async function seedAccount(
    owner: string,
    account: string,
    opts: {
      lastSyncedAt: number;
      claimedAt?: number;
      inboxRows?: number;
    },
  ) {
    await stores.ensureSyncAccountRow(owner, account);
    await stores.patchSyncAccount(owner, account, {
      historyId: "42",
      lastSyncedAt: opts.lastSyncedAt,
      status: "idle",
      ...(opts.claimedAt !== undefined
        ? { syncClaimId: "live-claim", syncClaimedAt: opts.claimedAt }
        : {}),
    });
    await insertThreads(
      Array.from({ length: opts.inboxRows ?? 3 }, (_, i) =>
        thread(owner, account, `${owner}-${i}`, NOW - i, true),
      ),
    );
  }

  it("clears inactive and disconnected accounts and keeps connected ones", async () => {
    const connected = "oauth-acct@example.com";
    await seedAccount("inactive@example.com", "inactive-acct@example.com", {
      lastSyncedAt: NOW - 40 * DAY,
    });
    await seedAccount("gone@example.com", "gone-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
    });
    await seedAccount("managed@example.com", "managed-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
    });
    await seedAccount("unverified@example.com", "unverified-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
    });
    await seedAccount("oauth@example.com", connected, {
      lastSyncedAt: NOW - HOUR,
    });
    await seedAccount("claimed@example.com", "claimed-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
      claimedAt: NOW - 1_000,
    });
    // An archived row older than the grace window on an inactive owner is
    // removed by the purge before the rule pass runs.
    await insertThreads([
      thread(
        "inactive@example.com",
        "inactive-acct@example.com",
        "old-arch",
        9,
        false,
      ),
    ]);
    await setRowTimes("old-arch", NOW - HOUR);

    await exec.execute({
      sql: `INSERT INTO public.oauth_tokens (provider, account_id, owner, tokens, updated_at, revision)
        VALUES ('google', $1, 'oauth@example.com', '{}', 1, 1)`,
      args: [connected],
    });

    const resolveConnectedAccounts = vi.fn(async (owner: string) => {
      if (owner === "managed@example.com") {
        return { accounts: ["managed-acct@example.com"], errors: [] };
      }
      if (owner === "unverified@example.com") {
        return {
          accounts: [],
          errors: [{ email: "x", error: "managed lookup failed" }],
        };
      }
      return { accounts: [], errors: [] };
    });

    const summary = await retention.runInboxRetention({
      now: NOW,
      resolveConnectedAccounts,
    });

    expect(summary).toMatchObject({
      pairs: 6,
      archivedRowsRemoved: 1,
      capRowsRemoved: 0,
      capOwners: 0,
      ruleRowsRemoved: 6,
      ruleOwners: 2,
      pairsReset: 2,
      pairsSkippedClaimed: 1,
      pairsSkippedUnverified: 1,
    });
    expect(
      await countRows("inactive@example.com", "inactive-acct@example.com"),
    ).toBe(0);
    expect(await countRows("gone@example.com", "gone-acct@example.com")).toBe(
      0,
    );
    expect(
      await countRows("managed@example.com", "managed-acct@example.com"),
    ).toBe(3);
    expect(
      await countRows("unverified@example.com", "unverified-acct@example.com"),
    ).toBe(3);
    expect(await countRows("oauth@example.com", connected)).toBe(3);
    expect(
      await countRows("claimed@example.com", "claimed-acct@example.com"),
    ).toBe(3);

    const { rows } = await exec.execute({
      sql: `SELECT history_id, status, full_sync_listed_count FROM mail_sync_accounts
        WHERE owner_email = $1`,
      args: ["inactive@example.com"],
    });
    expect(rows[0]).toMatchObject({
      history_id: null,
      status: "idle",
      full_sync_listed_count: 0,
    });
    // An owner whose only account has an OAuth grant is not a candidate, so
    // the resolver is never consulted for it.
    expect(resolveConnectedAccounts).not.toHaveBeenCalledWith(
      "oauth@example.com",
    );
  });
  const NO_GMAIL_SCOPE = JSON.stringify({
    scope: "openid https://www.googleapis.com/auth/userinfo.email",
  });
  const noConnections = async () => ({ accounts: [], errors: [] });

  async function addGoogleToken(
    owner: string,
    account: string,
    tokens: string,
  ) {
    await exec.execute({
      sql: `INSERT INTO public.oauth_tokens (provider, account_id, owner, tokens, updated_at, revision)
        VALUES ('google', $1, $2, $3, 1, 1)`,
      args: [account, owner, tokens],
    });
  }

  it("treats a Google grant without a Gmail scope as disconnected", async () => {
    await seedAccount("scoped@example.com", "scoped-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
    });
    await addGoogleToken(
      "scoped@example.com",
      "scoped-acct@example.com",
      NO_GMAIL_SCOPE,
    );
    await seedAccount("mail@example.com", "mail-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
    });
    await addGoogleToken(
      "mail@example.com",
      "mail-acct@example.com",
      JSON.stringify({
        scope: "openid https://www.googleapis.com/auth/gmail.modify",
      }),
    );

    const summary = await retention.runInboxRetention({
      now: NOW,
      resolveConnectedAccounts: noConnections,
    });

    expect(summary).toMatchObject({ pairsReset: 1, ruleRowsRemoved: 3 });
    expect(
      await countRows("scoped@example.com", "scoped-acct@example.com"),
    ).toBe(0);
    expect(await countRows("mail@example.com", "mail-acct@example.com")).toBe(
      3,
    );
  });

  it("fences out the old worker when it takes over a stale claim", async () => {
    await seedAccount("stale@example.com", "stale-acct@example.com", {
      lastSyncedAt: NOW - 40 * DAY,
      claimedAt: NOW - 10 * 60_000,
    });

    await stores.patchSyncAccount(
      "stale@example.com",
      "stale-acct@example.com",
      {
        archivePendingIds: ["t1", "t2"],
        hydratePendingIds: ["t3"],
      },
    );
    expect(
      (await stores.readSyncAccounts("stale@example.com"))[0].archivePendingIds,
    ).toEqual(["t1", "t2"]);

    const summary = await retention.runInboxRetention({
      now: NOW,
      resolveConnectedAccounts: noConnections,
    });

    expect(summary.pairsReset).toBe(1);
    expect(
      (await stores.readSyncAccounts("stale@example.com"))[0].archivePendingIds,
    ).toEqual([]);
    expect(
      (await stores.readSyncAccounts("stale@example.com"))[0].hydratePendingIds,
    ).toEqual([]);
    await expect(
      stores.withSyncClaim(
        "stale@example.com",
        "stale-acct@example.com",
        "live-claim",
        async () => "wrote",
      ),
    ).rejects.toThrow();
  });

  it("does not clear an inactive pair whose owner synced after the scan", async () => {
    await seedAccount("woke@example.com", "woke-acct@example.com", {
      lastSyncedAt: NOW - HOUR,
    });
    const scanned = {
      ownerEmail: "woke@example.com",
      accountEmail: "woke-acct@example.com",
      syncId: "woke@example.com:woke-acct@example.com",
      inactive: true,
      claimed: false,
    };

    expect(await retention.clearPair(scanned, NOW, true)).toBeNull();
    expect(await countRows("woke@example.com", "woke-acct@example.com")).toBe(
      3,
    );

    // The same pair cleared for a missing grant has no inactivity condition.
    expect(await retention.clearPair(scanned, NOW, false)).toBe(3);
  });
});
