import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The first PGlite boot can exceed the default hook timeout when the whole
// suite runs in parallel.
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const mocks = vi.hoisted(() => {
  class GmailQuotaCooldownError extends Error {
    details = { retryAfterSeconds: 1 };
  }
  return {
    gmailGetProfile: vi.fn(),
    gmailGetLabel: vi.fn(),
    gmailListThreads: vi.fn(),
    gmailListHistory: vi.fn(),
    gmailListLabels: vi.fn(),
    gmailBatchGetThreads: vi.fn(),
    getClientForConnectedAccount: vi.fn(),
    getConnectedAccountsWithErrors: vi.fn(),
    GmailQuotaCooldownError,
  };
});

vi.mock("./google-api.js", () => ({
  gmailGetProfile: mocks.gmailGetProfile,
  gmailGetLabel: mocks.gmailGetLabel,
  gmailListThreads: mocks.gmailListThreads,
  gmailListHistory: mocks.gmailListHistory,
  gmailListLabels: mocks.gmailListLabels,
  gmailBatchGetThreads: mocks.gmailBatchGetThreads,
  GmailQuotaCooldownError: mocks.GmailQuotaCooldownError,
}));

vi.mock("./google-auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./google-auth.js")>();
  return {
    ...actual,
    getClientForConnectedAccount: mocks.getClientForConnectedAccount,
    getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
  };
});

type Exec = { execute: (q: { sql: string; args?: unknown[] }) => Promise<any> };

const OWNER = "owner@example.com";
const ACCOUNT = "acct@example.com";

let exec: Exec;
let stores: typeof import("./inbox-store.js");
let sync: typeof import("./inbox-sync.js");
let status: typeof import("./inbox-status.js");

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  const [{ default: initializeMailDb }, core, storeModule, syncModule, st] =
    await Promise.all([
      import("../plugins/db.js"),
      import("@agent-native/core/db"),
      import("./inbox-store.js"),
      import("./inbox-sync.js"),
      import("./inbox-status.js"),
    ]);
  await initializeMailDb({});
  exec = core.getDbExec() as unknown as Exec;
  stores = storeModule;
  sync = syncModule;
  status = st;
  vi.clearAllMocks();
  mocks.getClientForConnectedAccount.mockResolvedValue({
    accessToken: "tok",
    email: ACCOUNT,
  });
  mocks.getConnectedAccountsWithErrors.mockResolvedValue({
    accounts: [ACCOUNT],
    errors: [],
  });
  mocks.gmailGetProfile.mockResolvedValue({ historyId: "900" });
  mocks.gmailListThreads.mockResolvedValue({ threads: [] });
  mocks.gmailBatchGetThreads.mockResolvedValue([]);
  mocks.gmailListHistory.mockResolvedValue({ history: [], historyId: "900" });
  mocks.gmailListLabels.mockResolvedValue({
    labels: [{ id: "INBOX", name: "INBOX" }],
  });
  mocks.gmailGetLabel.mockResolvedValue({
    id: "INBOX",
    name: "INBOX",
    threadsTotal: 0,
    threadsUnread: 0,
  });
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

async function seed(columns: Record<string, string>, patch = {}) {
  await stores.ensureSyncAccountRow(OWNER, ACCOUNT);
  if (Object.keys(patch).length > 0) {
    await stores.patchSyncAccount(OWNER, ACCOUNT, patch);
  }
  const names = Object.keys(columns);
  await exec.execute({
    sql: `UPDATE mail_sync_accounts SET ${names
      .map((name, index) => `${name} = $${index + 1}`)
      .join(", ")} WHERE owner_email = $${names.length + 1}`,
    args: [...Object.values(columns), OWNER],
  });
}

async function row() {
  const [account] = await stores.readSyncAccounts(OWNER);
  return account;
}

// Whatever step ran, the damaged raw values are still on record and the
// account still reports corrupt_state, also after a second step.
async function expectEvidenceSurvives(expected: Record<string, string>) {
  const first = await row();
  expect(first.corrupt).toMatchObject(expected);
  expect(status.statusFromRow(first).degraded).toMatchObject({
    kind: "corrupt_state",
  });

  await sync.syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });
  const second = await row();
  expect(second.corrupt).toMatchObject(expected);
  expect(status.statusFromRow(second).degraded).toMatchObject({
    kind: "corrupt_state",
  });
}

describe("corrupt sync state survives every writer (PGlite)", () => {
  it("full sync keeps damaged labels and an empty-string pending list", async () => {
    await seed({ labels_json: "", archive_pending_ids_json: "   " });

    const result = await sync.syncInboxAccount(OWNER, ACCOUNT, {
      budgetMs: 5_000,
    });

    expect(result.degraded).toMatchObject({ kind: "corrupt_state" });
    expect((await row()).labels).not.toBeNull();
    await expectEvidenceSurvives({
      labels_json: "",
      archive_pending_ids_json: "   ",
    });
  });

  it("reconcile keeps a damaged reconcile queue", async () => {
    await seed(
      { full_sync_reconcile_pending_ids_json: "", labels_json: "[1," },
      {
        historyId: "100",
        archiveHistoryId: "100",
        fullSyncPhase: "reconcile" as const,
        fullSyncReconcilePageToken: "",
        fullSyncReconcilePasses: 1,
      },
    );

    await sync.syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });

    await expectEvidenceSurvives({
      full_sync_reconcile_pending_ids_json: "",
      labels_json: "[1,",
    });
  });

  it("incremental sync keeps damaged pending and degraded lists", async () => {
    await seed(
      { hydrate_pending_ids_json: "{", sync_degraded_json: "[]" },
      { historyId: "100", archiveHistoryId: "100" },
    );

    const result = await sync.syncInboxAccount(OWNER, ACCOUNT, {
      budgetMs: 5_000,
    });

    expect(result.degraded).toMatchObject({ kind: "corrupt_state" });
    await expectEvidenceSurvives({
      hydrate_pending_ids_json: "{",
      sync_degraded_json: "[]",
    });
  });

  it("an append to a damaged pending list keeps its raw value", async () => {
    await seed({ hydrate_pending_ids_json: " " });
    await stores.patchSyncAccount(OWNER, ACCOUNT, {
      syncClaimId: "claim-x",
      syncClaimedAt: Date.now(),
    });

    await stores.appendHydratePendingIds(OWNER, ACCOUNT, "claim-x", ["t1"]);

    const after = await row();
    expect(after.hydratePendingIds).toEqual(["t1"]);
    expect(after.corrupt).toMatchObject({ hydrate_pending_ids_json: " " });
  });

  it("only a resync clears the evidence", async () => {
    await seed({ labels_json: "nope" }, { historyId: "100" });
    await sync.syncInboxAccount(OWNER, ACCOUNT, { budgetMs: 5_000 });
    expect((await row()).corrupt).toHaveProperty("labels_json");

    await stores.resetSyncAccountProgress(OWNER, ACCOUNT);

    expect((await row()).corrupt).toEqual({});
  });
});

describe("a capped inbox is a lower bound (PGlite)", () => {
  it("persists the cap marker and reports it after a reload", async () => {
    await stores.ensureSyncAccountRow(OWNER, ACCOUNT);
    await stores.patchSyncAccount(OWNER, ACCOUNT, {
      historyId: null,
      fullSyncHistoryId: "900",
      fullSyncStartedAt: Date.now() - 1_000,
      fullSyncPageToken: "1990",
      fullSyncListedCount: 1_990,
    });
    mocks.gmailListThreads.mockResolvedValue({
      threads: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}` })),
      nextPageToken: "2000",
    });

    const result = await sync.syncInboxAccount(OWNER, ACCOUNT, {
      budgetMs: 5_000,
    });

    expect(result).toMatchObject({ state: "ready", reachedCap: true });
    const reloaded = await row();
    expect(reloaded.inboxCapped).toBe(true);
    expect(status.statusFromRow(reloaded)).toMatchObject({
      state: "ready",
      reachedCap: true,
    });
  });
});
