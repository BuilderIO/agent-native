import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isProductionServerlessFunctionRuntime: vi.fn(),
  getDbExec: vi.fn(),
  oauthCandidateQuery: vi.fn(),
  ensureSyncAccountRow: vi.fn(),
  isInBackgroundFunctionRuntime: vi.fn(),
  registerEvent: vi.fn(),
  registerRecurringSweepHandler: vi.fn(),
  startIntervalJob: vi.fn(),
  getOAuthTokens: vi.fn(),
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
  markJobSendStarted: vi.fn(),
  markJobUncertain: vi.fn(),
  markExpiredScheduledSendsUncertain: vi.fn(),
  releaseJobProcessing: vi.fn(),
  resetJobProcessingForRetry: vi.fn(),
  resurfaceEmail: vi.fn(),
  sendScheduledEmail: vi.fn(),
  shouldResurfaceSnoozedThread: vi.fn(),
  getSnoozeThreadId: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core/db")>();
  return {
    ...actual,
    getDbExec: mocks.getDbExec,
    isProductionServerlessFunctionRuntime:
      mocks.isProductionServerlessFunctionRuntime,
  };
});
vi.mock("@agent-native/core/event-bus", () => ({
  registerEvent: mocks.registerEvent,
}));
vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: mocks.getOAuthTokens,
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
vi.mock("../lib/inbox-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/inbox-store.js")>();
  return { ...actual, ensureSyncAccountRow: mocks.ensureSyncAccountRow };
});
vi.mock("../lib/jobs.js", () => ({
  getDuePendingJobs: mocks.getDuePendingJobs,
  getSnoozeThreadId: mocks.getSnoozeThreadId,
  markJobCancelled: mocks.markJobCancelled,
  markJobDone: mocks.markJobDone,
  markJobProcessing: mocks.markJobProcessing,
  markJobSendStarted: mocks.markJobSendStarted,
  markJobUncertain: mocks.markJobUncertain,
  markExpiredScheduledSendsUncertain: mocks.markExpiredScheduledSendsUncertain,
  resurfaceEmail: mocks.resurfaceEmail,
  releaseJobProcessing: mocks.releaseJobProcessing,
  resetJobProcessingForRetry: mocks.resetJobProcessingForRetry,
  sendScheduledEmail: mocks.sendScheduledEmail,
  shouldResurfaceSnoozedThread: mocks.shouldResurfaceSnoozedThread,
}));

type SweepContext = { deadlineAt: number; signal?: AbortSignal };
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
    mocks.getDbExec.mockReturnValue({ execute: mocks.oauthCandidateQuery });
    mocks.oauthCandidateQuery.mockResolvedValue({ rows: [] });
    mocks.ensureSyncAccountRow.mockImplementation(
      async (ownerEmail: string, accountEmail: string) => ({
        id: `${ownerEmail}:${accountEmail}`,
      }),
    );
    mocks.isInBackgroundFunctionRuntime.mockReturnValue(false);
    mocks.registerRecurringSweepHandler.mockImplementation(((
      id: string,
      handler: (context: SweepContext) => Promise<void>,
    ) => {
      sweepHandlers.set(id, handler);
      return () => sweepHandlers.delete(id);
    }) as any);
    mocks.getOAuthTokens.mockResolvedValue({ access_token: "fake-token" });
    mocks.processMailAiFilterBackfills.mockResolvedValue(undefined);
    mocks.purgeExpiredMailAiFilterBackfills.mockResolvedValue(undefined);
    mocks.purgeExpiredMailAiFilterRuleUndoSnapshots.mockResolvedValue(
      undefined,
    );
    mocks.processAutomationsForAccount.mockResolvedValue({ errors: 0 });
    mocks.getDuePendingJobs.mockResolvedValue([]);
    mocks.markJobProcessing.mockResolvedValue(null);
    mocks.markJobDone.mockResolvedValue(true);
    mocks.markJobSendStarted.mockResolvedValue(true);
    mocks.markJobUncertain.mockResolvedValue(true);
    mocks.markExpiredScheduledSendsUncertain.mockResolvedValue(0);
    mocks.releaseJobProcessing.mockResolvedValue(true);
    mocks.resetJobProcessingForRetry.mockResolvedValue(true);
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
    vi.stubEnv("GMAIL_WATCH_TOPIC", "");
    mocks.purgeExpiredMailAiFilterRuleUndoSnapshots.mockRejectedValueOnce(
      new Error("undo cleanup failed"),
    );
    mocks.purgeExpiredMailAiFilterBackfills.mockRejectedValueOnce(
      new Error("backfill cleanup failed"),
    );
    mocks.getDuePendingJobs.mockRejectedValueOnce(
      new Error("scheduled jobs failed"),
    );
    mocks.getDb.mockImplementation(
      () =>
        ({
          select: () => ({
            from: () => ({
              orderBy: () => ({
                limit: async (limit: number) =>
                  [
                    {
                      id: "alice@example.com:mailbox@example.com",
                      ownerEmail: "alice@example.com",
                      accountEmail: "mailbox@example.com",
                    },
                  ].slice(0, limit),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: async () => [
                  { id: "alice@example.com:mailbox@example.com" },
                ],
              }),
            }),
          }),
        }) as any,
    );
    mocks.oauthCandidateQuery.mockResolvedValue({
      rows: [
        {
          sync_account_id: "alice@example.com:mailbox@example.com",
          owner_email: "alice@example.com",
          account_id: "mailbox@example.com",
          oauth_owner: "alice@example.com",
        },
      ],
    });
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });

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
    expect((error as Error & { errors: unknown[] }).errors).toHaveLength(3);
    expect(
      mocks.purgeExpiredMailAiFilterRuleUndoSnapshots,
    ).toHaveBeenCalledOnce();
    expect(mocks.purgeExpiredMailAiFilterBackfills).toHaveBeenCalledOnce();
    expect(mocks.getDuePendingJobs).toHaveBeenCalledOnce();
    expect(mocks.markExpiredScheduledSendsUncertain).toHaveBeenCalledWith(
      expect.any(Number),
    );
    expect(mocks.getDuePendingJobs).toHaveBeenCalledWith(
      expect.any(Number),
      20,
    );
    expect(mocks.processAutomationsForAccount).toHaveBeenCalledOnce();
  });

  it("renews each Gmail watch once per six-hour DB-backed window", async () => {
    const state: {
      lastRenewedAt: number | null;
      claimId: string | null;
      claimedAt: number | null;
    } = { lastRenewedAt: null, claimId: null, claimedAt: null };
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });
    mocks.startWatch.mockResolvedValue(true);
    mocks.oauthCandidateQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            sync_account_id: "account-row",
            owner_email: "alice@example.com",
            account_id: "account-1",
            oauth_owner: "alice@example.com",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            sync_account_id: "account-row",
            owner_email: "alice@example.com",
            account_id: "account-1",
            oauth_owner: "alice@example.com",
          },
        ],
      });
    mocks.getDb.mockImplementation(
      () =>
        ({
          select: () => ({
            from: () => ({
              orderBy: () => ({
                limit: async () => [
                  {
                    id: "account-row",
                    ownerEmail: "alice@example.com",
                    accountEmail: "account-1",
                  },
                ],
              }),
            }),
          }),
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

  it("aborts an in-flight Gmail watch renewal and releases its claim", async () => {
    const controller = new AbortController();
    const state: { claimId: string | null; claimedAt: number | null } = {
      claimId: null,
      claimedAt: null,
    };
    const account = {
      sync_account_id: "account-row",
      owner_email: "alice@example.com",
      account_id: "account-1",
      oauth_owner: "alice@example.com",
    };
    mocks.oauthCandidateQuery.mockImplementation(
      async ({ sql }: { sql: string }) => ({
        rows: sql.includes("last_watch_attempted_at") ? [account] : [],
      }),
    );
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });
    mocks.startWatch.mockImplementation(async (_token, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    mocks.getDb.mockImplementation(
      () =>
        ({
          update: () => ({
            set: (changes: Record<string, unknown>) => ({
              where: () => {
                if (changes.watchRenewClaimId === null) {
                  state.claimId = null;
                  state.claimedAt = null;
                }
                return {
                  returning: async () => {
                    if (typeof changes.lastWatchAttemptedAt === "number") {
                      return [{ id: "account-row" }];
                    }
                    if (typeof changes.watchRenewClaimId === "string") {
                      state.claimId = changes.watchRenewClaimId;
                      state.claimedAt = changes.watchRenewClaimedAt as number;
                      return [{ id: "account-row" }];
                    }
                    return [];
                  },
                };
              },
            }),
          }),
        }) as any,
    );

    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-background-jobs");
    const error = await handler!({
      deadlineAt: Date.now() + 60_000,
      signal: controller.signal,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AggregateError");
    expect((error as Error & { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ name: "AbortError" }),
    );
    expect(mocks.startWatch).toHaveBeenCalledWith(
      "fake-token",
      controller.signal,
    );
    expect(state).toEqual({ claimId: null, claimedAt: null });
  });

  it("reclaims a scheduled job after its processing lease expires", async () => {
    vi.stubEnv("GMAIL_WATCH_TOPIC", "");
    const expiredJob = {
      id: "expired-snooze",
      type: "snooze",
      ownerEmail: "alice@example.com",
      emailId: "message-1",
      threadId: "thread-1",
      accountEmail: "mailbox@example.com",
      payload: "{}",
      runAt: Date.now() - 1,
      status: "processing",
      processingClaimId: "terminated-invocation",
      processingLeaseUntil: Date.now() - 1,
      sendStartedAt: null,
      createdAt: Date.now() - 60_000,
    };
    mocks.getDuePendingJobs.mockResolvedValue([expiredJob]);
    mocks.markJobProcessing.mockResolvedValue("replacement-claim");
    mocks.shouldResurfaceSnoozedThread.mockResolvedValue(true);
    mocks.getSnoozeThreadId.mockReturnValue("thread-1");

    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-background-jobs");
    const deadlineAt = Date.now() + 60_000;

    await handler!({ deadlineAt });

    expect(mocks.getDuePendingJobs).toHaveBeenCalledOnce();
    expect(mocks.markJobProcessing).toHaveBeenCalledWith(
      "expired-snooze",
      expect.any(Number),
      deadlineAt + 30_000,
    );
    expect(mocks.resurfaceEmail).toHaveBeenCalledWith(
      "alice@example.com",
      "message-1",
      "thread-1",
      "mailbox@example.com",
      undefined,
    );
    expect(mocks.markJobDone).toHaveBeenCalledWith(
      "expired-snooze",
      "replacement-claim",
    );
  });

  it("does not release or retry a scheduled send after an ambiguous abort", async () => {
    vi.stubEnv("GMAIL_WATCH_TOPIC", "");
    const controller = new AbortController();
    mocks.getDuePendingJobs.mockResolvedValue([
      {
        id: "scheduled-send",
        type: "send_later",
        ownerEmail: "alice@example.com",
        accountEmail: "mailbox@example.com",
        payload: JSON.stringify({ to: "recipient@example.com" }),
        runAt: Date.now() - 1,
        status: "pending",
        createdAt: Date.now() - 60_000,
      },
    ]);
    mocks.markJobProcessing.mockResolvedValue("send-claim");
    mocks.sendScheduledEmail.mockImplementation(
      async (_payload, _account, _owner, options) => {
        await options.onDispatchStart();
        controller.abort();
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    );

    const plugin = await loadMailJobsPlugin();
    plugin();
    const handler = sweepHandlers.get("mail-background-jobs");
    const error = await handler!({
      deadlineAt: Date.now() + 60_000,
      signal: controller.signal,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AggregateError");
    expect(mocks.markJobSendStarted).toHaveBeenCalledWith(
      "scheduled-send",
      "send-claim",
    );
    expect(mocks.releaseJobProcessing).not.toHaveBeenCalled();
    expect(mocks.resetJobProcessingForRetry).not.toHaveBeenCalled();
    expect(mocks.markJobCancelled).not.toHaveBeenCalled();
    expect(mocks.markJobDone).not.toHaveBeenCalled();
    expect(mocks.markJobUncertain).toHaveBeenCalledWith(
      "scheduled-send",
      "send-claim",
    );
  });

  it("includes selected OAuth accounts that do not have a sync row yet", async () => {
    const candidate = {
      sync_account_id: null,
      owner_email: "alice@example.com",
      account_id: "mailbox@example.com",
      oauth_owner: "Alice@Example.com",
    };
    mocks.oauthCandidateQuery
      .mockResolvedValueOnce({ rows: [candidate] })
      .mockResolvedValueOnce({
        rows: [{ ...candidate, sync_account_id: "account-row" }],
      });
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });
    mocks.startWatch.mockResolvedValue(true);
    mocks.getDb.mockReturnValue({
      update: () => ({
        set: (changes: Record<string, unknown>) => ({
          where: () => ({
            returning: async () =>
              Object.keys(changes).some((key) =>
                [
                  "lastAutomationAttemptedAt",
                  "lastWatchAttemptedAt",
                  "watchRenewClaimId",
                  "lastWatchRenewedAt",
                ].includes(key),
              )
                ? [{ id: "account-row" }]
                : [],
          }),
        }),
      }),
    } as any);

    const plugin = await loadMailJobsPlugin();
    plugin();
    const signal = new AbortController().signal;
    await sweepHandlers.get("mail-background-jobs")!({
      deadlineAt: Date.now() + 60_000,
      signal,
    });

    expect(mocks.ensureSyncAccountRow).toHaveBeenCalledOnce();
    expect(mocks.ensureSyncAccountRow).toHaveBeenCalledWith(
      "alice@example.com",
      "mailbox@example.com",
    );
    expect(mocks.getOAuthTokens).toHaveBeenCalledTimes(2);
    expect(mocks.getOAuthTokens).toHaveBeenNthCalledWith(
      1,
      "google",
      "mailbox@example.com",
      "Alice@Example.com",
    );
    expect(mocks.getOAuthTokens).toHaveBeenNthCalledWith(
      2,
      "google",
      "mailbox@example.com",
      "Alice@Example.com",
    );
    expect(mocks.processAutomationsForAccount).toHaveBeenCalledOnce();
    expect(mocks.processAutomationsForAccount).toHaveBeenCalledWith(
      "alice@example.com",
      "mailbox@example.com",
      "fake-token",
      signal,
    );
    expect(mocks.getClientFromAccount).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountId: "mailbox@example.com",
        owner: "Alice@Example.com",
      }),
    );
    expect(mocks.getClientFromAccount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountId: "mailbox@example.com",
        owner: "Alice@Example.com",
      }),
    );
    expect(mocks.startWatch).toHaveBeenCalledOnce();
    for (const [query] of mocks.oauthCandidateQuery.mock.calls) {
      expect(query.sql).toContain("LEFT JOIN mail_sync_accounts");
      expect(query.sql).toContain("LIMIT ?");
      expect(query.sql).not.toContain("oauth_tokens.tokens");
      // Accounts whose credential Google rejected are not swept until reauthed.
      expect(query.sql).toContain(
        "COALESCE(mail_sync_accounts.status, 'idle') <> 'needs_reauth'",
      );
    }
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
      id: `owner${index}@example.com:account-${index}`,
      ownerEmail: `owner${index}@example.com`,
      accountEmail: `account-${index}`,
    }));
    mocks.getClientFromAccount.mockResolvedValue({ accessToken: "fake-token" });
    const candidateBatches = [
      accounts.slice(0, 5),
      [accounts[5]!, ...accounts.slice(0, 4)],
    ];
    mocks.oauthCandidateQuery.mockImplementation(
      async ({ args }: { args: unknown[] }) => ({
        rows: (candidateBatches.shift() ?? [])
          .slice(0, args[1] as number)
          .map((account) => ({
            sync_account_id: account.id,
            owner_email: account.ownerEmail,
            account_id: account.accountEmail,
            oauth_owner: account.ownerEmail,
          })),
      }),
    );
    mocks.getDb.mockImplementation(
      () =>
        ({
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
    expect(
      mocks.oauthCandidateQuery.mock.calls.map(([query]) => query.args[1]),
    ).toEqual([5, 5]);
    expect(mocks.getOAuthTokens).toHaveBeenCalledTimes(10);
  });

  it("keeps the opt-in in-process loops for local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(false);

    const plugin = await loadMailJobsPlugin();
    plugin();

    expect(mocks.startIntervalJob).toHaveBeenCalledTimes(2);
  });
});
