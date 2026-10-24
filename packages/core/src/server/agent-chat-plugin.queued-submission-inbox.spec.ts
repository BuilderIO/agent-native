import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sweepHarness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
  settingsEmitter: null as EventEmitter | null,
  closeHooks: [] as Array<() => void | Promise<void>>,
  staleReapResult: {
    scanned: 0,
    reaped: 0,
    failed: 0,
    truncated: false,
  } as { scanned: number; reaped: number; failed: number; truncated: boolean },
  staleReapError: null as Error | null,
  runAccess: true,
}));

const inboxHarness = vi.hoisted(() => ({
  admissions: [] as Array<Record<string, unknown>>,
  admissionOwnerContexts: [] as Array<Record<string, unknown> | undefined>,
  admissionAttempts: [] as string[],
  admit: null as ((body: Record<string, any>) => Promise<string>) | null,
  admissionThrow: null as { messageId: string; error: unknown } | null,
  admissionFailure: null as {
    messageId: string;
    status: number;
    response: Record<string, unknown>;
  } | null,
  failReceiptRead: null as {
    threadId: string;
    messageId: string;
    call: number;
  } | null,
  activeRun: null as Record<string, unknown> | null,
  afterInterruptRunRecorded: null as (() => Promise<void>) | null,
  safeAbort: null as
    | ((runId: string, reason: string) => Promise<boolean>)
    | null,
  durableAbort: null as
    | ((runId: string, reason: string) => Promise<boolean>)
    | null,
  turnAbort: null as ((runId: string, reason: string) => Promise<void>) | null,
  receiptReads: [] as Array<[string, string]>,
  failActiveRunCheckThreadId: null as string | null,
}));

vi.mock("./framework-request-handler.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./framework-request-handler.js")>();
  return {
    ...actual,
    awaitBootstrap: () => Promise.resolve(),
    getH3App: (nitroApp: any) => ({
      use(path: string, handler: any) {
        nitroApp.h3App.all(
          path.endsWith("/runs") ? `${path}/**` : path,
          handler,
        );
      },
    }),
    markDefaultPluginProvided: vi.fn(),
    trackPluginInit: (_nitroApp: any, promise: Promise<void>) => {
      sweepHarness.initPromises.push(promise);
    },
  };
});

vi.mock("../settings/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/store.js")>();
  return {
    ...actual,
    deleteSetting: vi.fn(async () => false),
    getSetting: vi.fn(async () => null),
    getSettingsEmitter: () => sweepHarness.settingsEmitter,
    putSetting: vi.fn(async () => {}),
  };
});

vi.mock("../agent/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/run-store.js")>();
  return {
    ...actual,
    getRunById: vi.fn(async () => null),
    retryRunThreadProjection: vi.fn(async () => ({ state: "projected" })),
    listUnclaimedBackgroundRunRows: vi.fn(async () => []),
    reapAllStaleRuns: vi.fn(async () => {
      if (sweepHarness.staleReapError) throw sweepHarness.staleReapError;
      return sweepHarness.staleReapResult;
    }),
  };
});

vi.mock("../chat-threads/store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../chat-threads/store.js")>();
  return {
    ...actual,
    getQueuedSubmissionReceiptStatus: async (
      threadId: string,
      messageId: string,
    ) => {
      inboxHarness.receiptReads.push([threadId, messageId]);
      return actual.getQueuedSubmissionReceiptStatus(threadId, messageId);
    },
    getQueuedSubmissionReceipt: async (threadId: string, messageId: string) => {
      inboxHarness.receiptReads.push([threadId, messageId]);
      const readCount = inboxHarness.receiptReads.filter(
        ([readThreadId, readMessageId]) =>
          readThreadId === threadId && readMessageId === messageId,
      ).length;
      if (
        inboxHarness.failReceiptRead?.threadId === threadId &&
        inboxHarness.failReceiptRead.messageId === messageId &&
        inboxHarness.failReceiptRead.call === readCount
      ) {
        inboxHarness.failReceiptRead = null;
        throw new Error("Test receipt read failure");
      }
      return actual.getQueuedSubmissionReceipt(threadId, messageId);
    },
    recordQueuedSubmissionInterruptRun: async (
      input: Parameters<typeof actual.recordQueuedSubmissionInterruptRun>[0],
    ) => {
      const recorded = await actual.recordQueuedSubmissionInterruptRun(input);
      await inboxHarness.afterInterruptRunRecorded?.();
      return recorded;
    },
  };
});

vi.mock("../agent/run-ownership.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/run-ownership.js")>();
  return {
    ...actual,
    callerHasRunAccess: () => sweepHarness.runAccess,
    callerHasThreadAccess: () => true,
  };
});

vi.mock("./agent-run-context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-run-context.js")>();
  return {
    ...actual,
    resolveAgentRunOwnerContext: async () => ({
      owner: "user@example.com",
      anonymous: false,
    }),
    resolveAgentRunOrgId: async () => undefined,
  };
});

vi.mock("../agent/production-agent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/production-agent.js")>();
  return {
    ...actual,
    createProductionAgentHandler: () => async (event: any) => {
      const body = event.context?.__agentChatBackgroundBody;
      if (body) {
        const messageId = String(body.queuedMessageId ?? "");
        inboxHarness.admissionOwnerContexts.push(
          event.context?.__agentNativeOwnerContext as
            | Record<string, unknown>
            | undefined,
        );
        inboxHarness.admissionAttempts.push(messageId);
        const admissionThrow = inboxHarness.admissionThrow;
        if (admissionThrow?.messageId === messageId) {
          throw admissionThrow.error;
        }
        const admissionFailure = inboxHarness.admissionFailure;
        if (admissionFailure?.messageId === messageId) {
          event.res.status = admissionFailure.status;
          return admissionFailure.response;
        }
        const runId = await inboxHarness.admit?.(body);
        if (!runId) throw new Error("Test admission callback was not set");
        inboxHarness.admissions.push({ ...body });
        event.res.headers.set("X-Run-Id", runId);
      }
      return {};
    },
    getActiveRunForThreadAsync: vi.fn(async (threadId: string) => {
      if (inboxHarness.failActiveRunCheckThreadId === threadId) {
        inboxHarness.failActiveRunCheckThreadId = null;
        throw new Error("active run status unavailable after claiming head");
      }
      return inboxHarness.activeRun?.threadId === threadId
        ? inboxHarness.activeRun
        : null;
    }),
    abortRunAndTurnDurably: vi.fn(
      async (
        runId: string,
        reason: string,
        options?: { safeBoundary?: boolean },
      ) => {
        if (inboxHarness.durableAbort) {
          return inboxHarness.durableAbort(runId, reason);
        }
        if (options?.safeBoundary) {
          const aborted =
            (await inboxHarness.safeAbort?.(runId, reason)) ?? true;
          if (aborted) await inboxHarness.turnAbort?.(runId, reason);
          return aborted;
        }
        return actual.abortRunAndTurnDurably(runId, reason, options);
      },
    ),
    abortRunAtSafeBoundaryDurably: vi.fn(
      async (runId: string, reason: string) => {
        const aborted = await inboxHarness.safeAbort?.(runId, reason);
        if (aborted) inboxHarness.activeRun = null;
        return aborted ?? true;
      },
    ),
    abortTurnDurably: vi.fn(async (runId: string, reason: string) => {
      await inboxHarness.turnAbort?.(runId, reason);
    }),
  };
});

vi.mock("./agent-teams.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-teams.js")>();
  return {
    ...actual,
    reconcileStaleAgentTeamRuns: vi.fn(async () => ({
      scanned: 0,
      reconciled: 0,
      failed: 0,
      truncated: false,
    })),
  };
});

vi.mock("../jobs/sweep-hooks.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../jobs/sweep-hooks.js")>();
  return {
    ...actual,
    runRecurringSweepHandlers: vi.fn(async () => ({
      registered: 0,
      failed: [],
    })),
  };
});

vi.mock("../agent/chat-health-alert.js", () => ({
  checkChatHealthAndAlert: vi.fn(async () => ({ checked: 0, alerted: 0 })),
}));

vi.mock("../jobs/run-history.js", () => ({
  processPendingAutomationFailureAlerts: vi.fn(async () => ({
    scanned: 0,
    processed: 0,
    failed: 0,
  })),
}));

vi.mock("./unclaimed-background-runs.js", () => ({
  sweepUnclaimedBackgroundRuns: vi.fn(async () => ({
    scanned: 0,
    reclaimed: 0,
    failed: 0,
  })),
}));

vi.mock("../mcp-client/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mcp-client/index.js")>();
  return {
    ...actual,
    buildMergedConfig: vi.fn(async () => null),
    startMcpConfigRefresh: () => () => {},
  };
});

vi.mock("../jobs/scheduler.js", () => ({
  processRecurringJobs: vi.fn(async () => {}),
}));

vi.mock("../triggers/dispatcher.js", () => ({
  initTriggerDispatcher: vi.fn(async () => {}),
}));

vi.mock("../chat-threads/migrations.js", () => ({
  runChatThreadDataMigrations: vi.fn(async () => {}),
}));

vi.mock("./social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));

vi.mock("./hosted-harness-policy.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./hosted-harness-policy.js")>();
  return { ...actual, loadHostedHarnessConfig: async () => undefined };
});

vi.mock("./action-discovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./action-discovery.js")>();
  return { ...actual, mergeCoreSharingActions: async () => {} };
});

vi.mock("./agent-chat/script-entries.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/script-entries.js")>();
  return {
    ...actual,
    createAgentEngineScriptEntries: async () => ({}),
    createAgentLoopSettingsScriptEntries: async () => ({}),
  };
});

vi.mock("../a2a/server.js", () => ({ mountA2A: vi.fn() }));

vi.mock("./agent-chat/run-code-tools.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/run-code-tools.js")>();
  return { ...actual, loadRunCodeToolEntries: async () => ({}) };
});

vi.mock("../scripts/dev/index.js", () => ({
  createDevScriptRegistry: async () => ({}),
}));

import {
  AgentRunJournalUnreadableError,
  getRunById,
  retryRunThreadProjection,
} from "../agent/run-store.js";
import {
  createThread,
  getQueuedSubmissionReceipt,
  listQueuedSubmissionReceipts,
  markQueuedSubmissionSubmitted,
  mutateThreadQueuedMessages,
  retryQueuedSubmissionReceipt,
} from "../chat-threads/store.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { RECURRING_JOBS_SWEEP_PATH } from "../jobs/scheduler-dispatch.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";

async function createSweepHandler() {
  const h3App = createApp();
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
  })({
    h3App,
    hooks: {
      hook(name, callback) {
        if (name === "close") sweepHarness.closeHooks.push(callback);
      },
    },
  });
  const initPromise = sweepHarness.initPromises.at(-1);
  if (!initPromise) throw new Error("Sweep initialization was not registered");
  await initPromise;
  return () =>
    h3App.fetch(
      new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
        method: "GET",
        headers: { authorization: "Bearer sweep-test-secret" },
      }),
    );
}

async function mountAgentChatRoutes() {
  const h3App = createApp();
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
  })({
    h3App,
    hooks: {
      hook(name, callback) {
        if (name === "close") sweepHarness.closeHooks.push(callback);
      },
    },
  });
  const initPromise = sweepHarness.initPromises.at(-1);
  if (!initPromise)
    throw new Error("Agent chat initialization was not registered");
  await initPromise;
  return h3App;
}

describe("queued submission inbox recurring sweep", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AGENT_MODE", "production");
    vi.stubEnv("DATABASE_URL", "pglite:memory://");
    vi.stubEnv("CRON_SECRET", "sweep-test-secret");
    sweepHarness.initPromises.length = 0;
    sweepHarness.settingsEmitter = new EventEmitter();
    sweepHarness.closeHooks.length = 0;
    sweepHarness.staleReapResult = {
      scanned: 0,
      reaped: 0,
      failed: 0,
      truncated: false,
    };
    sweepHarness.staleReapError = null;
    sweepHarness.runAccess = true;
    inboxHarness.admissions.length = 0;
    inboxHarness.admissionOwnerContexts.length = 0;
    inboxHarness.admissionAttempts.length = 0;
    inboxHarness.admit = null;
    inboxHarness.admissionThrow = null;
    inboxHarness.admissionFailure = null;
    inboxHarness.failReceiptRead = null;
    inboxHarness.activeRun = null;
    inboxHarness.afterInterruptRunRecorded = null;
    inboxHarness.safeAbort = null;
    inboxHarness.durableAbort = null;
    inboxHarness.turnAbort = null;
    inboxHarness.receiptReads.length = 0;
    inboxHarness.failActiveRunCheckThreadId = null;
    vi.mocked(getRunById).mockReset();
    vi.mocked(getRunById).mockResolvedValue(null);
    vi.mocked(retryRunThreadProjection).mockReset();
    vi.mocked(retryRunThreadProjection).mockResolvedValue({
      state: "projected",
    });
  });

  afterEach(async () => {
    await Promise.all(sweepHarness.closeHooks.map((close) => close()));
    sweepHarness.closeHooks.length = 0;
    await closeDbExec();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    {
      label: "throws",
      result: { scanned: 0, reaped: 0, failed: 0, truncated: false },
      error: new Error("stale reaper unavailable"),
      expected: null,
    },
    {
      label: "reports failed rows",
      result: { scanned: 1, reaped: 0, failed: 1, truncated: false },
      error: null,
      expected: { scanned: 1, reaped: 0, failed: 1, truncated: false },
    },
    {
      label: "reaches its batch cap",
      result: { scanned: 201, reaped: 200, failed: 0, truncated: true },
      error: null,
      expected: { scanned: 201, reaped: 200, failed: 0, truncated: true },
    },
  ])(
    "reports an incomplete stale-run sweep when it $label",
    async ({ result, error, expected }) => {
      sweepHarness.staleReapResult = result;
      sweepHarness.staleReapError = error;
      const sweep = await createSweepHandler();
      const response = await sweep();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        staleRunsReaped: expected,
      });
    },
  );

  it("reads queued receipt status only after resolving thread access", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    await createThread("user@example.com", { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: { id: messageId, threadId, text: "Queued work" },
      },
      { actor: { email: "user@example.com", anonymous: false } },
    );

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: { hook: vi.fn() },
    });
    await sweepHarness.initPromises.at(-1);

    const receiptPath = (id: string) =>
      `http://example.test/_agent-native/agent-chat/threads/${encodeURIComponent(id)}/queue/${encodeURIComponent(messageId)}/receipt`;
    const response = await h3App.fetch(new Request(receiptPath(threadId)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "queued" });
    expect(inboxHarness.receiptReads).toEqual([[threadId, messageId]]);

    const inaccessibleThreadId = `thread-${randomUUID()}`;
    await createThread("another-user@example.com", {
      id: inaccessibleThreadId,
    });
    const inaccessibleResponse = await h3App.fetch(
      new Request(receiptPath(inaccessibleThreadId)),
    );
    expect(inaccessibleResponse.status).toBe(404);
    expect(inboxHarness.receiptReads).toEqual([[threadId, messageId]]);
  }, 20_000);

  it("cancels a promoted queue item using its submitted run receipt", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const submittedRunId = `submitted-${randomUUID()}`;
    const incumbentRunId = `incumbent-${randomUUID()}`;
    const actor = { email: "user@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: { id: messageId, threadId, text: "Stop this message" },
      },
      { actor },
    );
    const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
    if (!receipt) throw new Error("Queued receipt was not persisted");
    const db = getDbExec();
    if (!db.transaction) throw new Error("Test database has no transaction");
    await db.transaction((tx) =>
      markQueuedSubmissionSubmitted(tx, {
        threadId,
        messageId,
        runId: submittedRunId,
        actor,
        message: receipt.message,
      }),
    );
    inboxHarness.activeRun = {
      runId: incumbentRunId,
      threadId,
      turnId: "incumbent-turn",
      status: "running",
    };
    inboxHarness.durableAbort = vi.fn(async () => {
      throw new Error("durable stop persistence failed");
    });

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const cancel = () =>
      h3App.fetch(
        new Request(
          `http://example.test/_agent-native/agent-chat/threads/${encodeURIComponent(threadId)}/queued`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mutation: { type: "cancel", messageId },
            }),
          },
        ),
      );

    const failedStop = await cancel();
    expect(failedStop.status).toBe(500);
    expect(inboxHarness.durableAbort).toHaveBeenCalledWith(
      submittedRunId,
      "user",
    );
    await expect(
      getQueuedSubmissionReceipt(threadId, messageId),
    ).resolves.toMatchObject({ state: "submitted", submittedRunId });

    inboxHarness.durableAbort = vi.fn(async () => true);
    const retriedStop = await cancel();
    expect(retriedStop.status).toBe(200);
    expect(inboxHarness.durableAbort).toHaveBeenCalledWith(
      submittedRunId,
      "user",
    );
    expect(inboxHarness.durableAbort).not.toHaveBeenCalledWith(
      incumbentRunId,
      "user",
    );
    await expect(retriedStop.json()).resolves.not.toHaveProperty(
      "submittedRunId",
    );
  }, 20_000);

  it("keeps a queued receipt while a live promotion claim owns it", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const actor = { email: "user@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: { id: messageId, threadId, text: "Cancel before dispatch" },
      },
      { actor },
    );
    const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
    if (!receipt) throw new Error("Queued receipt disappeared before claim");
    await mutateThreadQueuedMessages(threadId, {
      type: "claimFromInbox",
      receipt,
      claimId: "live-promoter",
    });

    const busyCancellation = await mutateThreadQueuedMessages(threadId, {
      type: "cancel",
      messageId,
    });
    expect(busyCancellation?.promotionBusy).toBe(true);
    expect(busyCancellation?.receiptUpdated).toBeUndefined();
    expect(busyCancellation?.queuedMessages).toMatchObject([
      { id: messageId, promotionClaim: { id: "live-promoter" } },
    ]);
    await expect(
      getQueuedSubmissionReceipt(threadId, messageId),
    ).resolves.toMatchObject({ state: "queued" });

    await mutateThreadQueuedMessages(threadId, {
      type: "release",
      messageId,
      claimId: "live-promoter",
    });
    const cancelled = await mutateThreadQueuedMessages(threadId, {
      type: "cancel",
      messageId,
    });
    expect(cancelled?.receiptUpdated).toBe(true);
    expect(cancelled?.queuedMessages).toEqual([]);
    await expect(
      getQueuedSubmissionReceipt(threadId, messageId),
    ).resolves.toMatchObject({ state: "removed" });

    const db = getDbExec();
    if (!db.transaction) throw new Error("Test database has no transaction");
    await expect(
      db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId,
          messageId,
          runId: "cancelled-before-submit",
          actor,
          message: { id: messageId, threadId, text: "Cancel before dispatch" },
        }),
      ),
    ).rejects.toThrow("queued_message_id_terminal");
  }, 20_000);

  it("keeps a delayed receipt as a per-thread drain barrier", async () => {
    const threadId = `thread-${randomUUID()}`;
    const otherThreadId = `thread-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const now = Date.now();
    await createThread(actor.email, { id: threadId });
    await createThread(actor.email, { id: otherThreadId });
    for (const [receiptThreadId, message] of [
      [threadId, { id: "delayed-head", text: "Retry first" }],
      [threadId, { id: "later-receipt", text: "Do not overtake" }],
      [otherThreadId, { id: "other-thread", text: "Independent thread" }],
    ] as const) {
      await mutateThreadQueuedMessages(
        receiptThreadId,
        {
          type: "append",
          message: { ...message, threadId: receiptThreadId },
        },
        { actor },
      );
    }
    const retryAfter = now + 60_000;
    expect(
      await retryQueuedSubmissionReceipt(threadId, "delayed-head", retryAfter),
    ).toBe(true);

    await expect(
      listQueuedSubmissionReceipts({ now: retryAfter - 1 }),
    ).resolves.toMatchObject([{ messageId: "other-thread" }]);
    await expect(
      listQueuedSubmissionReceipts({ now: retryAfter }),
    ).resolves.toMatchObject([
      { messageId: "delayed-head" },
      { messageId: "later-receipt" },
      { messageId: "other-thread" },
    ]);
  }, 20_000);

  it("does not promote a later receipt from a thread deferred during the sweep", async () => {
    const threadId = `thread-${randomUUID()}`;
    const otherThreadId = `thread-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    await createThread(actor.email, { id: otherThreadId });
    for (const [receiptThreadId, message] of [
      [threadId, { id: "interrupt-head", interruptActiveRun: true }],
      [threadId, { id: "later-same-thread" }],
      [otherThreadId, { id: "independent-thread" }],
    ] as const) {
      await mutateThreadQueuedMessages(
        receiptThreadId,
        {
          type: "append",
          message: {
            ...message,
            threadId: receiptThreadId,
            text: message.id,
          },
        },
        { actor },
      );
    }
    inboxHarness.activeRun = {
      runId: "active-run-with-dispatched-tool",
      threadId,
      turnId: "active-turn",
      status: "running",
      inFlight: true,
      hasInFlightWork: true,
    };
    inboxHarness.safeAbort = vi.fn(async () => false);
    inboxHarness.admit = async (body) => {
      const receipt = await getQueuedSubmissionReceipt(
        String(body.threadId),
        String(body.agentKitMessageId),
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receipt.threadId,
          messageId: receipt.messageId,
          runId: `run-${receipt.messageId}`,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return `run-${receipt.messageId}`;
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const response = await h3App.fetch(
      new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
        method: "GET",
        headers: { authorization: "Bearer sweep-test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 3,
        claimed: 2,
        submitted: 1,
        deferred: 2,
        failed: 0,
      },
    });
    expect(
      inboxHarness.admissions.map((body) => body.agentKitMessageId),
    ).toEqual(["independent-thread"]);
    await expect(
      getQueuedSubmissionReceipt(threadId, "interrupt-head"),
    ).resolves.toMatchObject({ state: "queued" });
    await expect(
      getQueuedSubmissionReceipt(threadId, "later-same-thread"),
    ).resolves.toMatchObject({ state: "queued" });
    await expect(
      getQueuedSubmissionReceipt(otherThreadId, "independent-thread"),
    ).resolves.toMatchObject({ state: "submitted" });
  }, 20_000);

  it("blocks a permanent 5xx admission and advances the same-thread queue", async () => {
    const threadId = `thread-${randomUUID()}`;
    const permanentHeadId = "permanent-admission-head";
    const nextMessageId = "next-after-permanent-admission";
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    for (const messageId of [permanentHeadId, nextMessageId]) {
      await mutateThreadQueuedMessages(
        threadId,
        {
          type: "append",
          message: { id: messageId, threadId, text: messageId },
        },
        { actor },
      );
    }
    inboxHarness.admissionFailure = {
      messageId: permanentHeadId,
      status: 503,
      response: { code: "invalid_submission", retryable: false },
    };
    inboxHarness.admit = async (body) => {
      const receipt = await getQueuedSubmissionReceipt(
        String(body.threadId),
        String(body.agentKitMessageId),
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receipt.threadId,
          messageId: receipt.messageId,
          runId: `run-${receipt.messageId}`,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return `run-${receipt.messageId}`;
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const response = await h3App.fetch(
      new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
        method: "GET",
        headers: { authorization: "Bearer sweep-test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 2,
        blocked: 1,
        submitted: 1,
        deferred: 0,
        failed: 0,
      },
    });
    expect(inboxHarness.admissions.map((body) => body.queuedMessageId)).toEqual(
      [nextMessageId],
    );
    await expect(
      getQueuedSubmissionReceipt(threadId, permanentHeadId),
    ).resolves.toMatchObject({ state: "blocked" });
    await expect(
      getQueuedSubmissionReceipt(threadId, nextMessageId),
    ).resolves.toMatchObject({
      state: "submitted",
      submittedRunId: `run-${nextMessageId}`,
    });
  }, 20_000);

  it("keeps a run-slot-busy receipt claimable for the drain that runs when the slot frees", async () => {
    const threadId = `thread-${randomUUID()}`;
    const headMessageId = "run-slot-busy-head";
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: { id: headMessageId, threadId, text: headMessageId },
      },
      { actor },
    );
    // The thread's slot is still held by the run that is ending.
    inboxHarness.admissionFailure = {
      messageId: headMessageId,
      status: 409,
      response: {
        error: "Run already in progress for this thread",
        code: "run_slot_busy",
        retryable: true,
        activeRunId: null,
      },
    };
    inboxHarness.admit = async (body) => {
      const receipt = await getQueuedSubmissionReceipt(
        String(body.threadId),
        String(body.agentKitMessageId),
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receipt.threadId,
          messageId: receipt.messageId,
          runId: `run-${receipt.messageId}`,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return `run-${receipt.messageId}`;
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const runSweep = await createSweepHandler();

    try {
      await runSweep();
      expect(inboxHarness.admissionAttempts).toEqual([headMessageId]);
      await expect(
        getQueuedSubmissionReceipt(threadId, headMessageId),
      ).resolves.toMatchObject({ state: "queued" });

      // The blocking run ends and its completion drain runs straight away,
      // before any retry window could have elapsed.
      inboxHarness.admissionFailure = null;
      await runSweep();

      expect(
        inboxHarness.admissions.map((body) => body.agentKitMessageId),
      ).toEqual([headMessageId]);
      await expect(
        getQueuedSubmissionReceipt(threadId, headMessageId),
      ).resolves.toMatchObject({ state: "submitted" });
    } finally {
      consoleError.mockRestore();
    }
  }, 20_000);

  it("blocks a non-retryable thrown admission and advances the same-thread queue", async () => {
    const threadId = `thread-${randomUUID()}`;
    const headMessageId = "non-retryable-admission-head";
    const nextMessageId = "next-after-non-retryable-admission";
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await createThread(actor.email, { id: threadId });
    for (const messageId of [headMessageId, nextMessageId]) {
      await mutateThreadQueuedMessages(
        threadId,
        {
          type: "append",
          message: { id: messageId, threadId, text: messageId },
        },
        { actor },
      );
    }
    inboxHarness.admissionThrow = {
      messageId: headMessageId,
      error: Object.assign(new Error("invalid admission"), {
        retryable: false,
      }),
    };
    inboxHarness.admit = async (body) => {
      const receipt = await getQueuedSubmissionReceipt(
        String(body.threadId),
        String(body.agentKitMessageId),
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receipt.threadId,
          messageId: receipt.messageId,
          runId: `run-${receipt.messageId}`,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return `run-${receipt.messageId}`;
    };

    try {
      const sweep = await createSweepHandler();
      const response = await sweep();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        queuedSubmissionDrain: {
          scanned: 2,
          blocked: 1,
          submitted: 1,
          deferred: 0,
          failed: 0,
        },
      });
      expect(inboxHarness.admissionAttempts).toEqual([
        headMessageId,
        nextMessageId,
      ]);
      expect(
        inboxHarness.admissions.map((body) => body.queuedMessageId),
      ).toEqual([nextMessageId]);
      await expect(
        getQueuedSubmissionReceipt(threadId, headMessageId),
      ).resolves.toMatchObject({ state: "blocked", retryCount: 0 });
      await expect(
        getQueuedSubmissionReceipt(threadId, nextMessageId),
      ).resolves.toMatchObject({ state: "submitted" });
    } finally {
      consoleError.mockRestore();
    }
  }, 20_000);

  it("caps retries for a retryable thrown admission and advances the same-thread queue", async () => {
    const threadId = `thread-${randomUUID()}`;
    const headMessageId = "retryable-admission-head";
    const nextMessageId = "next-after-retryable-admission";
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await createThread(actor.email, { id: threadId });
    for (const messageId of [headMessageId, nextMessageId]) {
      await mutateThreadQueuedMessages(
        threadId,
        {
          type: "append",
          message: { id: messageId, threadId, text: messageId },
        },
        { actor },
      );
    }
    inboxHarness.admissionThrow = {
      messageId: headMessageId,
      error: Object.assign(new Error("temporary admission failure"), {
        retryable: true,
      }),
    };
    inboxHarness.admit = async (body) => {
      const receipt = await getQueuedSubmissionReceipt(
        String(body.threadId),
        String(body.agentKitMessageId),
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receipt.threadId,
          messageId: receipt.messageId,
          runId: `run-${receipt.messageId}`,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return `run-${receipt.messageId}`;
    };

    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const sweep = await createSweepHandler();
      let headReceipt = await getQueuedSubmissionReceipt(
        threadId,
        headMessageId,
      );
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await sweep();
        expect(response.status).toBe(200);
        headReceipt = await getQueuedSubmissionReceipt(threadId, headMessageId);
        if (headReceipt?.state === "blocked") break;
        now += 10_001;
      }

      expect(headReceipt).toMatchObject({ state: "blocked", retryCount: 5 });
      expect(
        inboxHarness.admissionAttempts.filter((id) => id === headMessageId),
      ).toHaveLength(6);
      expect(
        inboxHarness.admissions.map((body) => body.queuedMessageId),
      ).toEqual([nextMessageId]);
      await expect(
        getQueuedSubmissionReceipt(threadId, nextMessageId),
      ).resolves.toMatchObject({ state: "submitted" });
    } finally {
      clock.mockRestore();
      consoleError.mockRestore();
    }
  }, 20_000);

  it("counts and blocks retries after the promotion claim expires during admission", async () => {
    const threadId = `thread-${randomUUID()}`;
    const headMessageId = "expired-promotion-retry-head";
    const nextMessageId = "next-after-expired-promotion-retries";
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await createThread(actor.email, { id: threadId });
    for (const messageId of [headMessageId, nextMessageId]) {
      await mutateThreadQueuedMessages(
        threadId,
        {
          type: "append",
          message: { id: messageId, threadId, text: messageId },
        },
        { actor },
      );
    }
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    inboxHarness.admit = async (body) => {
      const messageId = String(body.agentKitMessageId);
      if (messageId === headMessageId) {
        now += 60_001;
        throw new Error("admission failed after promotion claim expired");
      }
      const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId,
          messageId,
          runId: `run-${messageId}`,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return `run-${messageId}`;
    };

    try {
      const sweep = await createSweepHandler();
      let headReceipt = await getQueuedSubmissionReceipt(
        threadId,
        headMessageId,
      );
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await sweep();
        expect(response.status).toBe(200);
        headReceipt = await getQueuedSubmissionReceipt(threadId, headMessageId);
        if (headReceipt?.state === "blocked") break;
        now += 10_001;
      }

      expect(headReceipt).toMatchObject({ state: "blocked", retryCount: 5 });
      expect((await sweep()).status).toBe(200);
      expect(
        inboxHarness.admissionAttempts.filter(
          (messageId) => messageId === headMessageId,
        ),
      ).toHaveLength(6);
      expect(
        inboxHarness.admissions.map((body) => body.queuedMessageId),
      ).toEqual([nextMessageId]);
      await expect(
        getQueuedSubmissionReceipt(threadId, nextMessageId),
      ).resolves.toMatchObject({ state: "submitted" });
    } finally {
      clock.mockRestore();
      consoleError.mockRestore();
    }
  }, 20_000);

  it.each([
    ["after admission throws", true, 2, "queued"],
    ["after admission returns", false, 3, "submitted"],
  ] as const)(
    "defers a thread when receipt verification fails %s",
    async (_caseName, throwAdmission, failedRead, headState) => {
      const threadId = `thread-${randomUUID()}`;
      const otherThreadId = `thread-${randomUUID()}`;
      const headMessageId = "receipt-verification-head";
      const laterMessageId = "later-after-receipt-verification";
      const independentMessageId = "independent-after-receipt-verification";
      const actor = { email: "inbox-owner@example.com", anonymous: false };
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await createThread(actor.email, { id: threadId });
      await createThread(actor.email, { id: otherThreadId });
      for (const [receiptThreadId, messageId] of [
        [threadId, headMessageId],
        [threadId, laterMessageId],
        [otherThreadId, independentMessageId],
      ] as const) {
        await mutateThreadQueuedMessages(
          receiptThreadId,
          {
            type: "append",
            message: {
              id: messageId,
              threadId: receiptThreadId,
              text: messageId,
            },
          },
          { actor },
        );
      }
      if (throwAdmission) {
        inboxHarness.admissionThrow = {
          messageId: headMessageId,
          error: new Error("admission failed"),
        };
      }
      inboxHarness.failReceiptRead = {
        threadId,
        messageId: headMessageId,
        call: failedRead,
      };
      inboxHarness.admit = async (body) => {
        const receipt = await getQueuedSubmissionReceipt(
          String(body.threadId),
          String(body.agentKitMessageId),
        );
        if (!receipt)
          throw new Error("Queued receipt disappeared before admit");
        const db = getDbExec();
        if (!db.transaction)
          throw new Error("Test database has no transaction");
        await db.transaction((tx) =>
          markQueuedSubmissionSubmitted(tx, {
            threadId: receipt.threadId,
            messageId: receipt.messageId,
            runId: `run-${receipt.messageId}`,
            actor: receipt.actor,
            message: receipt.message,
          }),
        );
        return `run-${receipt.messageId}`;
      };

      try {
        const sweep = await createSweepHandler();
        const response = await sweep();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
          queuedSubmissionDrain: {
            scanned: 3,
            claimed: 2,
            submitted: 1,
            deferred: 2,
            failed: 1,
          },
        });
        expect(inboxHarness.admissionAttempts).toEqual([
          headMessageId,
          independentMessageId,
        ]);
        expect(
          inboxHarness.admissions.some(
            (body) => body.queuedMessageId === laterMessageId,
          ),
        ).toBe(false);
        const headReceipt = await getQueuedSubmissionReceipt(
          threadId,
          headMessageId,
        );
        expect(headReceipt).toMatchObject({
          state: headState,
          retryCount: throwAdmission ? 1 : 0,
        });
        if (throwAdmission) {
          expect(headReceipt?.retryAfter).toEqual(expect.any(Number));
        }
        await expect(
          getQueuedSubmissionReceipt(threadId, laterMessageId),
        ).resolves.toMatchObject({ state: "queued" });
        await expect(
          getQueuedSubmissionReceipt(otherThreadId, independentMessageId),
        ).resolves.toMatchObject({ state: "submitted" });
      } finally {
        consoleError.mockRestore();
      }
    },
    20_000,
  );

  it("retries and defers a thread when the claimed receipt read fails", async () => {
    const threadId = `thread-${randomUUID()}`;
    const otherThreadId = `thread-${randomUUID()}`;
    const headMessageId = "claimed-receipt-read-head";
    const laterMessageId = "later-after-claimed-receipt-read";
    const independentMessageId = "independent-after-claimed-receipt-read";
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await createThread(actor.email, { id: threadId });
    await createThread(actor.email, { id: otherThreadId });
    for (const [receiptThreadId, messageId] of [
      [threadId, headMessageId],
      [threadId, laterMessageId],
      [otherThreadId, independentMessageId],
    ] as const) {
      await mutateThreadQueuedMessages(
        receiptThreadId,
        {
          type: "append",
          message: {
            id: messageId,
            threadId: receiptThreadId,
            text: messageId,
          },
        },
        { actor },
      );
    }
    inboxHarness.failReceiptRead = {
      threadId,
      messageId: headMessageId,
      call: 1,
    };
    inboxHarness.admit = async (body) => {
      const receiptThreadId = String(body.threadId);
      const messageId = String(body.agentKitMessageId);
      const receipt = await getQueuedSubmissionReceipt(
        receiptThreadId,
        messageId,
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const runId = `run-${messageId}`;
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receiptThreadId,
          messageId,
          runId,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return runId;
    };

    try {
      const sweep = await createSweepHandler();
      const response = await sweep();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        queuedSubmissionDrain: {
          scanned: 3,
          claimed: 2,
          submitted: 1,
          deferred: 2,
          failed: 1,
        },
      });
      expect(inboxHarness.admissionAttempts).toEqual([independentMessageId]);
      const headReceipt = await getQueuedSubmissionReceipt(
        threadId,
        headMessageId,
      );
      expect(headReceipt).toMatchObject({
        state: "queued",
        retryCount: 1,
        retryAfter: expect.any(Number),
      });
      expect(headReceipt?.retryAfter).toBeGreaterThan(Date.now());
      await expect(
        getQueuedSubmissionReceipt(threadId, laterMessageId),
      ).resolves.toMatchObject({ state: "queued" });
      await expect(
        getQueuedSubmissionReceipt(otherThreadId, independentMessageId),
      ).resolves.toMatchObject({ state: "submitted" });
    } finally {
      consoleError.mockRestore();
    }
  }, 20_000);

  it("defers a thread after a claimed receipt is retried and released", async () => {
    const threadId = `thread-${randomUUID()}`;
    const otherThreadId = `thread-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await createThread(actor.email, { id: threadId });
    await createThread(actor.email, { id: otherThreadId });
    for (const [receiptThreadId, message] of [
      [threadId, { id: "retry-head" }],
      [threadId, { id: "later-same-thread" }],
      [otherThreadId, { id: "independent-thread" }],
    ] as const) {
      await mutateThreadQueuedMessages(
        receiptThreadId,
        {
          type: "append",
          message: {
            ...message,
            threadId: receiptThreadId,
            text: message.id,
          },
        },
        { actor },
      );
    }
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    inboxHarness.failActiveRunCheckThreadId = threadId;
    inboxHarness.admit = async (body) => {
      const receiptThreadId = String(body.threadId);
      const messageId = String(body.agentKitMessageId);
      const receipt = await getQueuedSubmissionReceipt(
        receiptThreadId,
        messageId,
      );
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const runId = `run-${messageId}`;
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId: receiptThreadId,
          messageId,
          runId,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return runId;
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    try {
      const response = await h3App.fetch(
        new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
          method: "GET",
          headers: { authorization: "Bearer sweep-test-secret" },
        }),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        queuedSubmissionDrain: {
          scanned: 3,
          claimed: 2,
          submitted: 1,
          deferred: 2,
          failed: 1,
        },
      });
      expect(
        inboxHarness.admissions.map((body) => body.agentKitMessageId),
      ).toEqual(["independent-thread"]);
      await expect(
        getQueuedSubmissionReceipt(threadId, "retry-head"),
      ).resolves.toMatchObject({ state: "queued", retryCount: 1 });
      await expect(
        getQueuedSubmissionReceipt(threadId, "later-same-thread"),
      ).resolves.toMatchObject({ state: "queued" });
      await expect(
        getQueuedSubmissionReceipt(otherThreadId, "independent-thread"),
      ).resolves.toMatchObject({ state: "submitted" });

      let headReceipt = await getQueuedSubmissionReceipt(
        threadId,
        "retry-head",
      );
      for (let attempt = 0; attempt < 5; attempt += 1) {
        now += 10_001;
        inboxHarness.failActiveRunCheckThreadId = threadId;
        const retryResponse = await h3App.fetch(
          new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
            method: "GET",
            headers: { authorization: "Bearer sweep-test-secret" },
          }),
        );
        expect(retryResponse.status).toBe(500);
        headReceipt = await getQueuedSubmissionReceipt(threadId, "retry-head");
        if (headReceipt?.state === "blocked") break;
      }

      expect(headReceipt).toMatchObject({ state: "blocked", retryCount: 5 });
      expect(
        inboxHarness.admissions.map((body) => body.agentKitMessageId),
      ).toEqual(["independent-thread", "later-same-thread"]);
      await expect(
        getQueuedSubmissionReceipt(threadId, "later-same-thread"),
      ).resolves.toMatchObject({ state: "submitted" });
    } finally {
      clock.mockRestore();
      consoleError.mockRestore();
    }
  }, 20_000);

  it("admits a queued receipt once through the authenticated sweep", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const storedPayload = {
      attachments: [
        {
          type: "file",
          name: "report.pdf",
          mediaType: "application/pdf",
          url: "https://files.example.test/report.pdf",
        },
      ],
      requestAttachments: [
        {
          type: "image",
          name: "chart.png",
          contentType: "image/png",
          url: "https://files.example.test/chart.png",
        },
      ],
      references: [
        {
          type: "skill",
          path: "skills/research.md",
          name: "Research skill",
          source: "workspace",
          refId: "skill-research",
        },
      ],
      metadata: { engine: "openai", source: "queued-inbox" },
      options: {
        model: "gpt-4.1",
        reasoningEffort: "high",
        mode: "plan",
        metadata: { engine: "anthropic" },
      },
    };
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: {
          id: messageId,
          threadId,
          text: "Continue the report",
          ...storedPayload,
        },
      },
      { actor },
    );
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "queued" },
    );
    inboxHarness.admit = async (body) => {
      expect(body).toMatchObject({
        threadId,
        agentKitMessageId: messageId,
        queuedMessageId: messageId,
        message: "Continue the report",
        ...storedPayload,
      });
      expect(body.queuedMessageClaimId).toEqual(expect.any(String));
      const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const runId = `run-${messageId}`;
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId,
          messageId,
          runId,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return runId;
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    const initPromise = sweepHarness.initPromises.at(-1);
    expect(initPromise).toBeDefined();
    await initPromise;

    const sweep = () =>
      h3App.fetch(
        new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
          method: "GET",
          headers: { authorization: "Bearer sweep-test-secret" },
        }),
      );

    const firstResponse = await sweep();
    expect(firstResponse.status).toBe(200);
    const firstResult = await firstResponse.json();

    expect(firstResult).toMatchObject({
      queuedSubmissionDrain: {
        scanned: 1,
        claimed: 1,
        submitted: 1,
        failed: 0,
      },
    });
    expect(inboxHarness.admissions).toHaveLength(1);
    expect(inboxHarness.admissions[0]).toMatchObject({
      threadId,
      agentKitMessageId: messageId,
      queuedMessageId: messageId,
      message: "Continue the report",
      ...storedPayload,
    });
    expect(inboxHarness.admissionOwnerContexts[0]).toMatchObject({
      owner: actor.email,
      anonymous: false,
    });
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      {
        state: "submitted",
        submittedRunId: `run-${messageId}`,
      },
    );

    const duplicateResponse = await sweep();
    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 0,
        claimed: 0,
        submitted: 0,
        failed: 0,
      },
    });
    expect(inboxHarness.admissions).toHaveLength(1);
  }, 20_000);

  it("defers an interrupt request while the active run still owns dispatched work", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: {
          id: messageId,
          threadId,
          text: "Steer after the current action",
          interruptActiveRun: true,
        },
      },
      { actor },
    );
    inboxHarness.activeRun = {
      runId: "active-run-with-dispatched-tool",
      threadId,
      turnId: "active-turn",
      status: "running",
      inFlight: true,
      hasInFlightWork: true,
    };
    inboxHarness.safeAbort = vi.fn(async () => false);
    inboxHarness.admit = async () => {
      throw new Error("A dispatched tool must finish before promotion");
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const response = await h3App.fetch(
      new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
        method: "GET",
        headers: { authorization: "Bearer sweep-test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 1,
        claimed: 1,
        submitted: 0,
        deferred: 1,
        failed: 0,
      },
    });
    expect(inboxHarness.safeAbort).toHaveBeenCalledOnce();
    expect(inboxHarness.admissions).toHaveLength(0);
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "queued" },
    );
    const storedThread = await getDbExec().execute({
      sql: "SELECT thread_data FROM chat_threads WHERE id = ?",
      args: [threadId],
    });
    const threadData = JSON.parse(
      (storedThread.rows[0] as { thread_data: string }).thread_data,
    );
    expect(threadData.queuedMessages[0]).not.toHaveProperty("promotionClaim");
  }, 20_000);

  it("does not abort a queued run after its expired promotion claim is removed", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: {
          id: messageId,
          threadId,
          text: "Steer after the current action",
          interruptActiveRun: true,
        },
      },
      { actor },
    );
    inboxHarness.activeRun = {
      runId: "active-run-with-expired-promotion-claim",
      threadId,
      turnId: "active-turn",
      status: "running",
      inFlight: true,
      hasInFlightWork: true,
    };
    const safeAbort = vi.fn(async () => true);
    inboxHarness.safeAbort = safeAbort;
    inboxHarness.admit = async () => {
      throw new Error("The removed interruption must not be admitted");
    };
    inboxHarness.afterInterruptRunRecorded = async () => {
      now.mockReturnValue(70_001);
      const removed = await mutateThreadQueuedMessages(threadId, {
        type: "remove",
        messageId,
      });
      expect(removed?.promotionBusy).toBeUndefined();
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    try {
      const response = await h3App.fetch(
        new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
          method: "GET",
          headers: { authorization: "Bearer sweep-test-secret" },
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        queuedSubmissionDrain: {
          scanned: 1,
          claimed: 1,
          submitted: 0,
          deferred: 1,
          failed: 0,
        },
      });
      expect(safeAbort).not.toHaveBeenCalled();
      expect(inboxHarness.admissions).toHaveLength(0);
      await expect(
        getQueuedSubmissionReceipt(threadId, messageId),
      ).resolves.toMatchObject({ state: "removed" });
    } finally {
      now.mockRestore();
    }
  }, 20_000);

  it("replays a turn abort after the active run was stopped but marker persistence failed", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const activeRunId = `active-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    vi.mocked(getRunById).mockResolvedValue({
      id: activeRunId,
      threadId,
      status: "aborted",
      startedAt: 1,
      errorCode: null,
      errorDetail: null,
      terminalReason: null,
    });
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: {
          id: messageId,
          threadId,
          text: "Steer after the current action",
          interruptActiveRun: true,
        },
      },
      { actor },
    );
    inboxHarness.activeRun = {
      runId: activeRunId,
      threadId,
      turnId: "active-turn",
      status: "running",
      inFlight: true,
      hasInFlightWork: true,
    };
    const safeAbort = vi.fn(async () => true);
    inboxHarness.safeAbort = safeAbort;
    const turnAbort = vi.fn(async (runId: string, reason: string) => {
      expect(runId).toBe(activeRunId);
      expect(reason).toBe("user");
      if (turnAbort.mock.calls.length === 1) {
        throw new Error("turn marker store unavailable");
      }
      if (turnAbort.mock.calls.length === 2) {
        inboxHarness.activeRun = {
          runId: activeRunId,
          threadId,
          turnId: "active-turn",
          status: "aborted",
          inFlight: true,
          hasInFlightWork: true,
        };
      }
    });
    inboxHarness.turnAbort = turnAbort;
    inboxHarness.admit = async () => {
      const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const runId = `run-${messageId}`;
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId,
          messageId,
          runId,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return runId;
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const sweep = () =>
      h3App.fetch(
        new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
          method: "GET",
          headers: { authorization: "Bearer sweep-test-secret" },
        }),
      );

    const failedResponse = await sweep();
    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 1,
        claimed: 1,
        submitted: 0,
        failed: 1,
      },
    });
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "queued", interruptRunId: activeRunId },
    );
    expect(inboxHarness.admissions).toHaveLength(0);

    now.mockReturnValue(111_000);
    const idleResponse = await sweep();
    expect(idleResponse.status).toBe(200);
    await expect(idleResponse.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 1,
        claimed: 1,
        submitted: 0,
        failed: 0,
        deferred: 1,
      },
    });
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "queued", interruptRunId: activeRunId },
    );
    expect(inboxHarness.admissions).toHaveLength(0);

    now.mockReturnValue(122_000);
    const retryResponse = await sweep();
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 1,
        claimed: 1,
        submitted: 1,
        failed: 0,
      },
    });
    expect(safeAbort).toHaveBeenCalledTimes(3);
    expect(turnAbort).toHaveBeenCalledTimes(3);
    expect(inboxHarness.admissions).toHaveLength(1);
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "submitted", submittedRunId: `run-${messageId}` },
    );
    expect(
      await getQueuedSubmissionReceipt(threadId, messageId),
    ).not.toHaveProperty("interruptRunId");
    now.mockRestore();
  }, 20_000);

  it("retries a turn marker and stops a truncated continuation after restart", async () => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `queued-${randomUUID()}`;
    const activeRunId = `active-${randomUUID()}`;
    const actor = { email: "inbox-owner@example.com", anonymous: false };
    const now = vi.spyOn(Date, "now").mockReturnValue(200_000);
    vi.mocked(getRunById).mockResolvedValue({
      id: activeRunId,
      threadId,
      status: "truncated",
      startedAt: 1,
      errorCode: null,
      errorDetail: null,
      terminalReason: "auto_continue",
    });
    await createThread(actor.email, { id: threadId });
    await mutateThreadQueuedMessages(
      threadId,
      {
        type: "append",
        message: {
          id: messageId,
          threadId,
          text: "Steer after the current action",
          interruptActiveRun: true,
        },
      },
      { actor },
    );
    inboxHarness.activeRun = {
      runId: activeRunId,
      threadId,
      turnId: "active-turn",
      status: "running",
      inFlight: true,
      hasInFlightWork: true,
    };
    const safeAbort = vi.fn(async () => safeAbort.mock.calls.length === 1);
    inboxHarness.safeAbort = safeAbort;
    const successorRunId = `successor-${randomUUID()}`;
    const turnAbort = vi.fn(async (runId: string, reason: string) => {
      expect(runId).toBe(activeRunId);
      expect(reason).toBe("user");
      if (turnAbort.mock.calls.length === 1) {
        // A fresh isolate has no in-memory run to consult on the retry.
        inboxHarness.activeRun = null;
        throw new Error("turn marker store unavailable");
      }
      expect(inboxHarness.activeRun?.runId).toBe(successorRunId);
      inboxHarness.activeRun = null;
    });
    inboxHarness.turnAbort = turnAbort;
    inboxHarness.admit = async () => {
      const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
      if (!receipt) throw new Error("Queued receipt disappeared before admit");
      const runId = `run-${messageId}`;
      const db = getDbExec();
      if (!db.transaction) throw new Error("Test database has no transaction");
      await db.transaction((tx) =>
        markQueuedSubmissionSubmitted(tx, {
          threadId,
          messageId,
          runId,
          actor: receipt.actor,
          message: receipt.message,
        }),
      );
      return runId;
    };

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const sweep = () =>
      h3App.fetch(
        new Request(`http://example.test${RECURRING_JOBS_SWEEP_PATH}`, {
          method: "GET",
          headers: { authorization: "Bearer sweep-test-secret" },
        }),
      );

    const failedResponse = await sweep();
    expect(failedResponse.status).toBe(500);
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "queued", interruptRunId: activeRunId },
    );
    expect(inboxHarness.activeRun).toBeNull();

    inboxHarness.activeRun = {
      runId: successorRunId,
      threadId,
      turnId: "active-turn",
      status: "running",
      inFlight: true,
      hasInFlightWork: true,
    };
    now.mockReturnValue(211_000);
    const retryResponse = await sweep();
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      queuedSubmissionDrain: {
        scanned: 1,
        claimed: 1,
        submitted: 1,
        failed: 0,
      },
    });
    expect(safeAbort).toHaveBeenCalledTimes(2);
    expect(turnAbort).toHaveBeenCalledTimes(2);
    expect(getRunById).toHaveBeenCalledWith(activeRunId);
    expect(inboxHarness.admissions).toHaveLength(1);
    expect(await getQueuedSubmissionReceipt(threadId, messageId)).toMatchObject(
      { state: "submitted", submittedRunId: `run-${messageId}` },
    );
    now.mockRestore();
  }, 20_000);

  it("retries turn-marker persistence after a safe-boundary run abort committed", async () => {
    const runId = `run-${randomUUID()}`;
    vi.mocked(getRunById).mockResolvedValue({
      id: runId,
      threadId: `thread-${randomUUID()}`,
      status: "aborted",
      startedAt: 1,
      errorCode: null,
      errorDetail: null,
      terminalReason: "aborted:user",
    });
    inboxHarness.safeAbort = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    inboxHarness.turnAbort = vi
      .fn<(targetRunId: string, reason: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("turn marker store unavailable"));

    const h3App = createApp();
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools: "minimal",
      leanPrompt: true,
      mcp: { enabled: false },
    })({
      h3App,
      hooks: {
        hook(name, callback) {
          if (name === "close") sweepHarness.closeHooks.push(callback);
        },
      },
    });
    await sweepHarness.initPromises.at(-1);

    const abort = () =>
      h3App.fetch(
        new Request(
          `http://example.test/_agent-native/agent-chat/runs/${runId}/abort`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ safeBoundary: true, reason: "user" }),
          },
        ),
      );

    const first = await abort();
    expect(first.status).toBe(500);
    const retry = await abort();
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({ ok: true, aborted: false });
    expect(inboxHarness.turnAbort).toHaveBeenCalledTimes(2);
    expect(inboxHarness.turnAbort).toHaveBeenLastCalledWith(runId, "user");
  }, 20_000);
  describe("run thread projection recovery route", () => {
    const runId = "run-projection-quarantine";

    const retry = (app: ReturnType<typeof createApp>) =>
      app.fetch(
        new Request(
          `http://example.test/_agent-native/agent-chat/runs/${runId}/retry-projection`,
          { method: "POST" },
        ),
      );

    it("requires editor access without revealing an inaccessible run", async () => {
      const h3App = await mountAgentChatRoutes();
      sweepHarness.runAccess = false;

      const response = await retry(h3App);

      expect(response.status).toBe(404);
      expect(getRunById).not.toHaveBeenCalled();
      expect(retryRunThreadProjection).not.toHaveBeenCalled();
    }, 20_000);

    it("lets an editor retry a quarantined projection", async () => {
      const h3App = await mountAgentChatRoutes();
      vi.mocked(getRunById).mockResolvedValue({
        id: runId,
        threadId: "thread-projection-quarantine",
        status: "completed",
        startedAt: 1,
        errorCode: null,
        errorDetail: null,
        terminalReason: null,
        threadProjectionErrorCode: "tool_call_journal_unreadable",
      });

      const response = await retry(h3App);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        state: "projected",
      });
      expect(retryRunThreadProjection).toHaveBeenCalledWith(runId);
    }, 20_000);

    it("does not retry a projection without an operator quarantine", async () => {
      const h3App = await mountAgentChatRoutes();
      vi.mocked(getRunById).mockResolvedValue({
        id: runId,
        threadId: "thread-projection-quarantine",
        status: "completed",
        startedAt: 1,
        errorCode: null,
        errorDetail: null,
        terminalReason: null,
        threadProjectionErrorCode: null,
      });

      const response = await retry(h3App);

      expect(response.status).toBe(409);
      expect(retryRunThreadProjection).not.toHaveBeenCalled();
    }, 20_000);

    it("keeps unreadable source data quarantined after an explicit retry", async () => {
      const h3App = await mountAgentChatRoutes();
      vi.mocked(getRunById).mockResolvedValue({
        id: runId,
        threadId: "thread-projection-quarantine",
        status: "completed",
        startedAt: 1,
        errorCode: null,
        errorDetail: null,
        terminalReason: null,
        threadProjectionErrorCode: "tool_call_journal_unreadable",
      });
      vi.mocked(retryRunThreadProjection).mockRejectedValue(
        new AgentRunJournalUnreadableError(
          "thread-projection-quarantine",
          undefined,
          0,
          "invalid_thread_data",
        ),
      );

      const response = await retry(h3App);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        threadProjectionErrorCode: "tool_call_journal_unreadable",
      });
    }, 20_000);
  });
});
