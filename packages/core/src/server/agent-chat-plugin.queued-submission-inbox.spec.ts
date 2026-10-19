import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sweepHarness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
  settingsEmitter: null as EventEmitter | null,
  closeHooks: [] as Array<() => void | Promise<void>>,
}));

const inboxHarness = vi.hoisted(() => ({
  admissions: [] as Array<Record<string, unknown>>,
  admit: null as ((body: Record<string, any>) => Promise<string>) | null,
  activeRun: null as Record<string, unknown> | null,
  safeAbort: null as (() => Promise<boolean>) | null,
}));

vi.mock("./framework-request-handler.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./framework-request-handler.js")>();
  return {
    ...actual,
    awaitBootstrap: () => Promise.resolve(),
    getH3App: (nitroApp: any) => nitroApp.h3App,
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
    listUnclaimedBackgroundRunRows: vi.fn(async () => []),
    reapAllStaleRuns: vi.fn(async () => ({
      scanned: 0,
      reaped: 0,
      failed: 0,
      truncated: false,
    })),
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
        const runId = await inboxHarness.admit?.(body);
        if (!runId) throw new Error("Test admission callback was not set");
        inboxHarness.admissions.push({ ...body });
        event.res.headers.set("X-Run-Id", runId);
      }
      return {};
    },
    getActiveRunForThreadAsync: vi.fn(async () => inboxHarness.activeRun),
    abortRunAtSafeBoundaryDurably: vi.fn(async () => {
      const aborted = await inboxHarness.safeAbort?.();
      if (aborted) inboxHarness.activeRun = null;
      return aborted ?? true;
    }),
    abortTurnDurably: vi.fn(async () => {}),
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

import {
  createThread,
  getQueuedSubmissionReceipt,
  markQueuedSubmissionSubmitted,
  mutateThreadQueuedMessages,
} from "../chat-threads/store.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { RECURRING_JOBS_SWEEP_PATH } from "../jobs/scheduler-dispatch.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";

describe("queued submission inbox recurring sweep", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "pglite:memory://");
    vi.stubEnv("CRON_SECRET", "sweep-test-secret");
    sweepHarness.initPromises.length = 0;
    sweepHarness.settingsEmitter = new EventEmitter();
    sweepHarness.closeHooks.length = 0;
    inboxHarness.admissions.length = 0;
    inboxHarness.admit = null;
    inboxHarness.activeRun = null;
    inboxHarness.safeAbort = null;
  });

  afterEach(async () => {
    await Promise.all(sweepHarness.closeHooks.map((close) => close()));
    sweepHarness.closeHooks.length = 0;
    await closeDbExec();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

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
  });

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
  });
});
