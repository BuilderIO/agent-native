import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isProductionServerlessFunctionRuntime: vi.fn(),
  isInBackgroundFunctionRuntime: vi.fn(),
  registerEvent: vi.fn(),
  registerRecurringSweepHandler: vi.fn(),
  startIntervalJob: vi.fn(),
  listOAuthAccounts: vi.fn(),
  processMailAiFilterBackfills: vi.fn(),
  purgeExpiredMailAiFilterBackfills: vi.fn(),
  purgeExpiredMailAiFilterRuleUndoSnapshots: vi.fn(),
  processAutomationsForAccount: vi.fn(),
  getClientFromAccount: vi.fn(),
  startWatch: vi.fn(),
  getDuePendingJobs: vi.fn(),
  markJobCancelled: vi.fn(),
  markJobDone: vi.fn(),
  markJobProcessing: vi.fn(),
  resurfaceEmail: vi.fn(),
  sendScheduledEmail: vi.fn(),
  shouldResurfaceSnoozedThread: vi.fn(),
  getSnoozeThreadId: vi.fn(),
  ensureSyncAccountRow: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core/db")>();
  return {
    ...actual,
    isProductionServerlessFunctionRuntime:
      mocks.isProductionServerlessFunctionRuntime,
  };
});
vi.mock("@agent-native/core/event-bus", () => ({
  registerEvent: mocks.registerEvent,
}));
vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccounts: mocks.listOAuthAccounts,
}));
vi.mock("@agent-native/core/server", () => ({
  isInBackgroundFunctionRuntime: mocks.isInBackgroundFunctionRuntime,
  registerRecurringSweepHandler: mocks.registerRecurringSweepHandler,
  startIntervalJob: mocks.startIntervalJob,
}));
vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  return { ...actual, getDb: mocks.getDb };
});
vi.mock("../lib/ai-filter-backfill.js", () => ({
  processMailAiFilterBackfills: mocks.processMailAiFilterBackfills,
  purgeExpiredMailAiFilterBackfills: mocks.purgeExpiredMailAiFilterBackfills,
}));
vi.mock("../lib/ai-filter-rule-undo.js", () => ({
  purgeExpiredMailAiFilterRuleUndoSnapshots:
    mocks.purgeExpiredMailAiFilterRuleUndoSnapshots,
}));
vi.mock("../lib/automation-engine.js", () => ({
  processAutomationsForAccount: mocks.processAutomationsForAccount,
}));
vi.mock("../lib/google-auth.js", () => ({
  getClientFromAccount: mocks.getClientFromAccount,
  startWatch: mocks.startWatch,
}));
vi.mock("../lib/inbox-store.js", () => ({
  ensureSyncAccountRow: mocks.ensureSyncAccountRow,
}));
vi.mock("../lib/jobs.js", () => ({
  getDuePendingJobs: mocks.getDuePendingJobs,
  getSnoozeThreadId: mocks.getSnoozeThreadId,
  markJobCancelled: mocks.markJobCancelled,
  markJobDone: mocks.markJobDone,
  markJobProcessing: mocks.markJobProcessing,
  resurfaceEmail: mocks.resurfaceEmail,
  sendScheduledEmail: mocks.sendScheduledEmail,
  shouldResurfaceSnoozedThread: mocks.shouldResurfaceSnoozedThread,
}));

type SweepContext = { deadlineAt: number };
const sweepHandlers = new Map<
  string,
  (context: SweepContext) => Promise<void>
>();

async function loadMailJobsPlugin() {
  vi.resetModules();
  return (await import("./mail-jobs.js")).default;
}

describe("Mail background job scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sweepHandlers.clear();
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(true);
    mocks.isInBackgroundFunctionRuntime.mockReturnValue(false);
    mocks.registerRecurringSweepHandler.mockImplementation(((
      id: string,
      handler: (context: SweepContext) => Promise<void>,
    ) => {
      sweepHandlers.set(id, handler);
      return () => sweepHandlers.delete(id);
    }) as any);
    mocks.listOAuthAccounts.mockResolvedValue([]);
    mocks.processMailAiFilterBackfills.mockResolvedValue(undefined);
    mocks.purgeExpiredMailAiFilterBackfills.mockResolvedValue(undefined);
    mocks.purgeExpiredMailAiFilterRuleUndoSnapshots.mockResolvedValue(
      undefined,
    );
    mocks.processAutomationsForAccount.mockResolvedValue({ errors: 0 });
    mocks.getDuePendingJobs.mockResolvedValue([]);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUN_BACKGROUND_JOBS", "1");
    vi.stubEnv("GMAIL_WATCH_TOPIC", "projects/example/topics/mail");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the durable sweep instead of starting request-lambda intervals", async () => {
    const plugin = await loadMailJobsPlugin();
    plugin();

    expect(sweepHandlers.has("mail-ai-filter-backfills")).toBe(true);
    expect(sweepHandlers.has("mail-background-jobs")).toBe(true);
    expect(mocks.startIntervalJob).not.toHaveBeenCalled();
  });

  it("runs every durable step despite failures and reports one aggregate failure", async () => {
    mocks.purgeExpiredMailAiFilterRuleUndoSnapshots.mockRejectedValueOnce(
      new Error("undo cleanup failed"),
    );
    mocks.purgeExpiredMailAiFilterBackfills.mockRejectedValueOnce(
      new Error("backfill cleanup failed"),
    );
    mocks.getDuePendingJobs.mockRejectedValueOnce(
      new Error("scheduled jobs failed"),
    );
    mocks.listOAuthAccounts.mockRejectedValueOnce(
      new Error("automation account listing failed"),
    );
    mocks.listOAuthAccounts.mockRejectedValueOnce(
      new Error("watch account listing failed"),
    );

    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-background-jobs");
    expect(handler).toBeDefined();

    const error = await handler!({ deadlineAt: Date.now() + 60_000 }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AggregateError");
    expect((error as Error & { errors: unknown[] }).errors).toHaveLength(5);
    expect(
      mocks.purgeExpiredMailAiFilterRuleUndoSnapshots,
    ).toHaveBeenCalledOnce();
    expect(mocks.purgeExpiredMailAiFilterBackfills).toHaveBeenCalledOnce();
    expect(mocks.getDuePendingJobs).toHaveBeenCalledOnce();
    expect(mocks.getDuePendingJobs).toHaveBeenCalledWith(
      expect.any(Number),
      20,
    );
    expect(mocks.listOAuthAccounts).toHaveBeenCalledTimes(2);
  });

  it("renews each Gmail watch once per six-hour DB-backed window", async () => {
    const state: {
      lastRenewedAt: number | null;
      claimId: string | null;
      claimedAt: number | null;
    } = { lastRenewedAt: null, claimId: null, claimedAt: null };
    mocks.listOAuthAccounts.mockResolvedValue([
      { accountId: "account-1", owner: "alice@example.com" },
    ]);
    mocks.ensureSyncAccountRow.mockResolvedValue({ id: "account-row" });
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });
    mocks.startWatch.mockResolvedValue(true);
    mocks.getDb.mockImplementation(
      () =>
        ({
          update: () => ({
            set: (changes: Record<string, unknown>) => ({
              where: () => ({
                returning: async () => {
                  const now = Date.now();
                  if (
                    typeof changes.lastAutomationAttemptedAt === "number" ||
                    typeof changes.lastWatchAttemptedAt === "number"
                  ) {
                    return [{ id: "account-row" }];
                  }
                  if (typeof changes.watchRenewClaimId === "string") {
                    const due =
                      state.lastRenewedAt === null ||
                      state.lastRenewedAt <= now - 6 * 60 * 60_000;
                    const available =
                      state.claimId === null ||
                      state.claimedAt === null ||
                      state.claimedAt <= now - 10 * 60_000;
                    if (!due || !available) return [];
                    state.claimId = changes.watchRenewClaimId;
                    state.claimedAt = changes.watchRenewClaimedAt as number;
                    return [{ id: "account-row" }];
                  }
                  if (typeof changes.lastWatchRenewedAt === "number") {
                    if (state.claimId === null) return [];
                    state.lastRenewedAt = changes.lastWatchRenewedAt;
                    state.claimId = null;
                    state.claimedAt = null;
                    return [{ id: "account-row" }];
                  }
                  return [];
                },
              }),
            }),
          }),
        }) as any,
    );

    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-background-jobs");
    await handler!({ deadlineAt: Date.now() + 60_000 });
    await handler!({ deadlineAt: Date.now() + 60_000 });

    expect(mocks.startWatch).toHaveBeenCalledOnce();
    expect(state.lastRenewedAt).toBeTypeOf("number");
  });

  it("caps the durable AI-filter backfill at the shared deadline and 45 seconds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-ai-filter-backfills");

    await handler!({ deadlineAt: 100_000 });

    expect(mocks.processMailAiFilterBackfills).toHaveBeenCalledWith(
      undefined,
      undefined,
      46_000,
    );
  });

  it("rotates automation accounts by DB-backed attempt time across sweeps", async () => {
    vi.stubEnv("GMAIL_WATCH_TOPIC", "");
    const accounts = Array.from({ length: 6 }, (_, index) => ({
      accountId: `account-${index}`,
      owner: `owner${index}@example.com`,
      tokens: { access_token: "fake-token" },
    }));
    const attemptRows = [
      [],
      accounts.slice(0, 5).map((account) => ({
        id: `${account.owner}:${account.accountId}`,
        attemptedAt: 1,
      })),
    ];
    mocks.listOAuthAccounts.mockResolvedValue(accounts);
    mocks.ensureSyncAccountRow.mockImplementation(
      async (owner: string, accountId: string) => ({
        id: `${owner}:${accountId}`,
      }),
    );
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });
    mocks.getDb.mockImplementation(
      () =>
        ({
          select: () => ({
            from: () => ({
              where: async () => attemptRows.shift() ?? [],
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: async () => [{ id: "account-row" }],
              }),
            }),
          }),
        }) as any,
    );

    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-background-jobs");
    const deadlineAt = Date.now() + 60_000;
    await handler!({ deadlineAt });
    await handler!({ deadlineAt });

    expect(
      mocks.processAutomationsForAccount.mock.calls.map((call) => call[1]),
    ).toEqual([
      "account-0",
      "account-1",
      "account-2",
      "account-3",
      "account-4",
      "account-5",
      "account-0",
      "account-1",
      "account-2",
      "account-3",
    ]);
  });

  it("keeps the opt-in in-process loops for local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(false);

    const plugin = await loadMailJobsPlugin();
    plugin();

    expect(mocks.startIntervalJob).toHaveBeenCalledTimes(2);
  });
});
