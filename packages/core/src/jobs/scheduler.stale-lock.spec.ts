import { beforeEach, describe, expect, it, vi } from "vitest";

import * as runStore from "../agent/run-store.js";
import { getThread } from "../chat-threads/store.js";
import {
  RUNTIME_PAUSE_AFTER,
  runtimeFailureNextRun,
} from "./automation-outcome.js";
import * as automationRunner from "./background-automation-runner.js";
import { parseJobResource } from "./frontmatter.js";
import * as runHistory from "./run-history.js";
import * as schedulerHealth from "./scheduler-health.js";
import { recordAutomationSchedulerHealth } from "./scheduler-health.js";
import { processRecurringJobs, runJobNow } from "./scheduler.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const runAgentLoopWrapperMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());

vi.mock("../agent/run-loop-with-resume.js", () => ({
  runAgentLoopDirectWithSoftTimeout: runAgentLoopWrapperMock,
}));

vi.mock("../resources/store.js", () => ({
  ensureTable: vi.fn(async () => {}),
  resourcePutIfCurrentInTransaction: async (input: unknown) => {
    const resource = await resourcePutIfCurrentMock(input);
    return resource ? { resource, notify: vi.fn() } : null;
  },
  organizationResourceOwner: (orgId: string) =>
    `__organization__:${encodeURIComponent(orgId)}`,
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceGet: vi.fn(),
}));

vi.mock("../resources/emitter.js", () => ({
  getResourcesEmitter: () => ({ on: vi.fn() }),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: vi.fn(async () => ({
    id: "thread-1",
    title: "Job",
    preview: "",
    threadData: "{}",
    messageCount: 0,
  })),
  updateThreadData: vi.fn(async () => {}),
  withThreadDataLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  appendAgentLoopContinuation: (
    messages: unknown[],
    _reason: string,
    options: { journalNote?: string },
  ) =>
    messages.push({
      role: "user",
      content: [{ type: "text", text: options.journalNote }],
    }),
  actionsToEngineTools: vi.fn(() => []),
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  resolveOwnerEngineApiKey: vi.fn(async () => ({
    apiKey: undefined,
    apiKeyEnvVar: undefined,
  })),
  runAgentLoop: runAgentLoopMock,
  filterInitialEngineTools: (tools: unknown[]) => tools,
}));

vi.mock("../agent/run-manager.js", () => ({
  resolveRunSoftTimeoutMs: vi.fn(() => 0),
  resolveBackgroundAutomationSoftTimeoutMs: vi.fn(() => 0),
  resolveBackgroundRunHardTimeoutMs: vi.fn(() => 10 * 60_000),
  startRun: startRunMock,
}));

vi.mock("../usage/store.js", () => ({
  recordUsage: recordUsageMock,
}));

vi.mock("./remote-execution.js", () => ({
  dispatchRemoteAutomation: vi.fn(),
  finishRemoteAutomationHistory: vi.fn(),
  getRemoteAutomationStatus: vi.fn(async () => ({ state: "not-remote" })),
}));

vi.mock("./scheduler-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scheduler-health.js")>();
  return { ...actual, recordAutomationSchedulerHealth: vi.fn(async () => {}) };
});

vi.mock("../integrations/adapters/index.js", () => ({
  getDefaultAdapter: () => ({
    formatAgentResponse: (text: string) => ({ text, platformContext: {} }),
    sendMessageToTarget: vi.fn(),
  }),
}));

vi.mock("../server/onboarding-html.js", () => ({
  getOnboardingHtml: vi.fn(),
  getResetPasswordHtml: vi.fn(),
}));

vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDbExec: () => actual.getScopedDbExec() ?? getDbExecMock(),
  };
});

const testEngine = {
  name: "test",
  defaultModel: "test-model",
  supportedModels: ["test-model"],
} as any;

function interruptedScheduledJob(runCount = 1) {
  const startedAt = Date.now() - 120_000;
  const lastRun = new Date(startedAt).toISOString();
  const resource = {
    id: "recoverable-resource",
    owner: "alice+jobs@agent-native.test",
    path: "jobs/recoverable.md",
    content: `---\nschedule: "*/2 * * * *"\nenabled: true\nlastStatus: running\nlastRun: ${lastRun}\nlastHistoryId: recoverable-history\n---\nSend an email, then open a ticket.`,
  };
  const history = {
    id: "recoverable-history",
    owner: resource.owner,
    appId: null,
    path: resource.path,
    runId: "killed-worker",
    threadId: "thread-1",
    startedAt,
    finishedAt: null as number | null,
    status: "running",
  };
  resourceListAllOwnersMock.mockResolvedValue([resource]);
  const spies = [
    vi.spyOn(runHistory, "getAutomationRun").mockResolvedValue(history as any),
    vi.spyOn(runStore, "reapIfStale").mockResolvedValue(true),
    vi.spyOn(runStore, "getRunById").mockResolvedValue({
      id: "killed-worker",
      status: "errored",
      errorCode: "stale_run",
    } as any),
    vi
      .spyOn(runStore, "getRunTurnRef")
      .mockResolvedValue({ threadId: "thread-1", turnId: "killed-worker" }),
    vi.spyOn(runStore, "countRunsForTurn").mockResolvedValue(runCount),
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([
      {
        type: "tool_done",
        id: "email-1",
        tool: "send-test-email",
        result: "Delivered",
        completedSideEffect: true,
      },
    ]),
    vi
      .spyOn(runStore, "getCurrentTurnRunEventsForThread")
      .mockResolvedValue([]),
    vi
      .spyOn(runStore, "tryClaimRunSlot")
      .mockImplementation(async (_threadId, _runId, _maxStaleMs, options) => {
        await options?.afterInsert?.({ execute: dbExecuteMock });
        return { claimed: true, activeRunId: null };
      }),
  ];
  return {
    resource,
    history,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

const recoveryDeps = {
  getActions: () => ({}),
  getSystemPrompt: async () => "system",
  engine: testEngine,
  model: "test-model",
};

describe("stale automation run-lock recovery across trigger types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }], rowsAffected: 1 });
    getDbExecMock.mockReturnValue({
      execute: dbExecuteMock,
      transaction: async (
        fn: (tx: { execute: typeof dbExecuteMock }) => Promise<unknown>,
      ) => fn({ execute: dbExecuteMock }),
    });
    resourcePutMock.mockResolvedValue(undefined);
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => {
        await resourcePutMock(input.owner, input.path, input.content);
        return { id: input.owner + input.path };
      },
    );
    resourceGetByPathMock.mockImplementation(
      async (owner: string, path: string) => {
        const latestListCall = resourceListAllOwnersMock.mock.results.at(-1);
        const listedResources = latestListCall?.value
          ? await latestListCall.value
          : [];
        const listed = listedResources.find(
          (resource: { owner: string; path: string }) =>
            resource.owner === owner && resource.path === path,
        );
        const written = resourcePutMock.mock.calls
          .filter((call) => call[0] === owner && call[1] === path)
          .at(-1);
        return written
          ? { id: listed?.id ?? "resource-1", owner, path, content: written[2] }
          : (listed ?? null);
      },
    );
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    runAgentLoopMock.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      model: "test-model",
    });
    runAgentLoopWrapperMock.mockImplementation((opts: unknown) =>
      runAgentLoopMock(opts),
    );
    startRunMock.mockImplementation(
      (
        runId: string,
        threadId: string,
        runFn: (
          send: (event: unknown) => void,
          signal: AbortSignal,
        ) => Promise<void>,
        onComplete?: (run: { status: string }) => void | Promise<void>,
      ) => {
        const abort = new AbortController();
        const activeRun = { runId, threadId, status: "running", abort };
        void Promise.resolve().then(async () => {
          try {
            await runFn(vi.fn(), abort.signal);
            activeRun.status = "completed";
          } catch {
            activeRun.status = "errored";
          }
          await onComplete?.(activeRun);
        });
        return activeRun;
      },
    );
    recordUsageMock.mockResolvedValue(undefined);
  });

  it.each(["lost", "unavailable"])(
    "does not dispatch after lease renewal is %s during a slow tick",
    async (problem) => {
      vi.useFakeTimers();
      let releaseList!: (resources: unknown[]) => void;
      let listed!: () => void;
      const listing = new Promise<void>((resolve) => {
        listed = resolve;
      });
      resourceListAllOwnersMock.mockImplementationOnce(() => {
        listed();
        return new Promise((resolve) => {
          releaseList = resolve;
        });
      });
      const renewal = vi.spyOn(
        schedulerHealth,
        "renewAutomationSchedulerLease",
      );
      if (problem === "lost") renewal.mockResolvedValue(false);
      else renewal.mockRejectedValue(new Error("lease database unavailable"));
      try {
        const tick = processRecurringJobs(recoveryDeps);
        await listing;
        await vi.advanceTimersByTimeAsync(60_000);
        releaseList([
          {
            id: "resource-due",
            owner: "owner@example.com",
            path: "jobs/due.md",
            content:
              '---\nschedule: "* * * * *"\nenabled: true\nnextRun: 2026-01-01T00:00:00Z\n---\nRun work.',
          },
        ]);
        await tick;
        expect(renewal).toHaveBeenCalled();
        expect(resourcePutMock).not.toHaveBeenCalled();
        expect(runAgentLoopMock).not.toHaveBeenCalled();
      } finally {
        renewal.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it("does not start tools if lease ownership is lost during worker setup", async () => {
    const fixture = interruptedScheduledJob();
    const renewal = vi
      .spyOn(schedulerHealth, "renewAutomationSchedulerLease")
      .mockResolvedValue(true);
    vi.mocked(getThread).mockResolvedValueOnce({
      id: "thread-1",
      threadData: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Original request" }],
            metadata: { custom: { submittedTurnId: "killed-worker" } },
          },
        ],
      }),
    } as any);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      await processRecurringJobs({
        ...recoveryDeps,
        getSystemPrompt: async () => {
          renewal.mockResolvedValue(false);
          return "system";
        },
      });
      expect(runAgentLoopMock).not.toHaveBeenCalled();
      expect(startRunMock).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
      expect(
        parseJobResource(resourcePutMock.mock.calls.at(-1)![2]).meta,
      ).toMatchObject({
        lastStatus: "running",
        lastHistoryId: fixture.history.id,
      });
    } finally {
      renewal.mockRestore();
      finish.mockRestore();
      fixture.restore();
    }
  });

  it.each(["success", "error"])(
    "retains resumed recovery when its %s history write fails",
    async (outcome) => {
      const fixture = interruptedScheduledJob();
      const finish = vi
        .spyOn(runHistory, "finishAutomationRun")
        .mockRejectedValueOnce(new Error("terminal history unavailable"))
        .mockResolvedValue(undefined);
      vi.mocked(getThread).mockResolvedValueOnce({
        id: "thread-1",
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Original request" }],
              metadata: { custom: { submittedTurnId: "killed-worker" } },
            },
          ],
        }),
      } as any);
      if (outcome === "error")
        runAgentLoopMock.mockRejectedValueOnce(new Error("provider failed"));
      try {
        await processRecurringJobs(recoveryDeps);
        expect(runAgentLoopMock).toHaveBeenCalledOnce();
        const pending = parseJobResource(
          resourcePutMock.mock.calls.at(-1)![2],
        ).meta;
        expect(pending).toMatchObject({
          lastStatus: "running",
          lastHistoryId: fixture.history.id,
        });
        fixture.history.runId = startRunMock.mock.calls[0]![0];
        vi.mocked(runStore.getRunById).mockResolvedValue({
          id: fixture.history.runId,
          status: outcome === "success" ? "completed" : "errored",
          errorCode: outcome === "error" ? "http_502" : null,
          errorDetail: outcome === "error" ? "provider failed" : null,
        } as any);
        await processRecurringJobs(recoveryDeps);
        expect(runAgentLoopMock).toHaveBeenCalledOnce();
        const settled = parseJobResource(
          resourcePutMock.mock.calls.at(-1)![2],
        ).meta;
        expect(settled.lastStatus).toBe(outcome);
        if (outcome === "error") {
          expect(settled.lastError).toContain("send-test-email");
          expect(settled.consecutiveFailures).toBe(1);
        }
      } finally {
        finish.mockRestore();
        fixture.restore();
      }
    },
  );

  it("persists a new local firing's exact history id before the worker starts", async () => {
    const resource = {
      id: "resource-due",
      owner: "owner@example.com",
      path: "jobs/due.md",
      content:
        '---\nschedule: "* * * * *"\nenabled: true\nnextRun: 2026-01-01T00:00:00Z\n---\nRun work.',
    };
    resourceListAllOwnersMock.mockResolvedValue([resource]);
    const start = vi
      .spyOn(runHistory, "startAutomationRun")
      .mockImplementation(async (_input, options) => {
        await options?.afterInsert?.(
          { execute: dbExecuteMock },
          "new-firing-id",
        );
        options?.afterCommit?.();
        return "new-firing-id";
      });
    const attach = vi
      .spyOn(runHistory, "attachAutomationRunThread")
      .mockImplementation(async (id) => {
        expect(
          parseJobResource(resourcePutMock.mock.calls.at(-1)![2]).meta,
        ).toMatchObject({ lastStatus: "running", lastHistoryId: id });
      });
    try {
      await processRecurringJobs(recoveryDeps);
      expect(start).toHaveBeenCalledOnce();
      expect(attach).toHaveBeenCalledWith(
        "new-firing-id",
        "thread-1",
        expect.any(String),
        { requirePersisted: true },
      );
      expect(runAgentLoopMock).toHaveBeenCalledOnce();
    } finally {
      start.mockRestore();
      attach.mockRestore();
    }
  });

  it("rolls back new admission when the scheduler lease is lost before its running marker", async () => {
    const resource = {
      id: "resource-lease-before-marker",
      owner: "owner@example.com",
      path: "jobs/due.md",
      content:
        '---\nschedule: "* * * * *"\nenabled: true\nnextRun: 2026-01-01T00:00:00Z\n---\nRun work.',
    };
    resourceListAllOwnersMock.mockResolvedValue([resource]);
    const renewal = vi
      .spyOn(schedulerHealth, "renewAutomationSchedulerLease")
      .mockResolvedValue(true);
    const start = vi
      .spyOn(runHistory, "startAutomationRun")
      .mockImplementation(async (_input, options) => {
        renewal.mockResolvedValue(false);
        await options?.afterInsert?.(
          { execute: dbExecuteMock },
          "unstarted-firing",
        );
        options?.afterCommit?.();
        return "unstarted-firing";
      });
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(start).toHaveBeenCalledOnce();
      expect(finish).not.toHaveBeenCalled();
      expect(resourcePutMock).not.toHaveBeenCalled();
      expect(startRunMock).not.toHaveBeenCalled();
    } finally {
      renewal.mockRestore();
      start.mockRestore();
      finish.mockRestore();
    }
  });

  it("resumes an interrupted manual firing without a cron schedule", async () => {
    const fixture = interruptedScheduledJob();
    fixture.resource.content = fixture.resource.content.replace(
      'schedule: "*/2 * * * *"\n',
      "lastRunManual: true\nlastRunAdvanceSchedule: false\n",
    );
    vi.mocked(getThread).mockResolvedValueOnce({
      id: "thread-1",
      threadData: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Original manual request" }],
            metadata: { custom: { submittedTurnId: "killed-worker" } },
          },
        ],
      }),
    } as any);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(runAgentLoopMock).toHaveBeenCalledOnce();
      expect(runAgentLoopMock.mock.calls[0]![0]).toMatchObject({
        threadId: "thread-1",
        turnId: "killed-worker",
      });
      const settled = parseJobResource(
        resourcePutMock.mock.calls.at(-1)![2],
      ).meta;
      expect(settled).toMatchObject({
        lastStatus: "success",
        lastRunManual: true,
        lastRunAdvanceSchedule: false,
      });
      expect(settled.schedule).toBe("");
      expect(settled.nextRun).toBeUndefined();
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("keeps a firing recoverable after losing the resume resource write", async () => {
    const fixture = interruptedScheduledJob();
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(finish).not.toHaveBeenCalled();
      expect(runAgentLoopMock).not.toHaveBeenCalled();
      vi.mocked(getThread).mockResolvedValueOnce({
        id: "thread-1",
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Original request" }],
              metadata: { custom: { submittedTurnId: "killed-worker" } },
            },
          ],
        }),
      } as any);
      await processRecurringJobs(recoveryDeps);
      expect(runAgentLoopMock).toHaveBeenCalledOnce();
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it.each(["missing worker", "mismatched turn", "failed history write"])(
    "dispatches unrelated jobs when recovery has a %s",
    async (problem) => {
      const fixture = interruptedScheduledJob(
        problem === "failed history write" ? 4 : 1,
      );
      const healthy = {
        id: "healthy-resource",
        owner: "owner@example.com",
        path: "jobs/healthy.md",
        content:
          '---\nschedule: "* * * * *"\nenabled: true\nnextRun: 2026-01-01T00:00:00Z\n---\nRun healthy work.',
      };
      resourceListAllOwnersMock.mockResolvedValue([fixture.resource, healthy]);
      const finish = vi
        .spyOn(runHistory, "finishAutomationRun")
        .mockResolvedValue(undefined);
      if (problem === "missing worker")
        vi.mocked(runStore.getRunById).mockResolvedValueOnce(null);
      if (problem === "mismatched turn")
        vi.mocked(runStore.getRunTurnRef).mockResolvedValueOnce({
          threadId: "wrong-thread",
          turnId: "killed-worker",
        });
      if (problem === "failed history write")
        finish.mockRejectedValueOnce(new Error("history unavailable"));
      try {
        await processRecurringJobs(recoveryDeps);
        expect(runAgentLoopMock).toHaveBeenCalledOnce();
        expect(
          resourcePutMock.mock.calls.every((call) => call[1] === healthy.path),
        ).toBe(true);
        expect(recordAutomationSchedulerHealth).toHaveBeenLastCalledWith(
          expect.objectContaining({ error: expect.any(String) }),
        );
        expect(parseJobResource(fixture.resource.content).meta.lastStatus).toBe(
          "running",
        );
      } finally {
        finish.mockRestore();
        fixture.restore();
      }
    },
  );

  it.each(["preflight", "dispatch"])(
    "retains recovery after temporary identity failure at %s",
    async (stage) => {
      const fixture = interruptedScheduledJob();
      const identity = vi.spyOn(
        automationRunner,
        "resolveBackgroundAutomationIdentity",
      );
      const valid = {
        ok: true as const,
        identity: { userEmail: fixture.resource.owner },
      };
      if (stage === "dispatch") identity.mockResolvedValueOnce(valid as any);
      identity.mockResolvedValueOnce({
        ok: false,
        code: "owner_unverifiable",
        reason: "Identity lookup unavailable",
      });
      const finish = vi
        .spyOn(runHistory, "finishAutomationRun")
        .mockResolvedValue(undefined);
      try {
        await processRecurringJobs(recoveryDeps);
        expect(resourcePutMock).not.toHaveBeenCalled();
        expect(finish).not.toHaveBeenCalled();
        expect(runAgentLoopMock).not.toHaveBeenCalled();
        expect(recordAutomationSchedulerHealth).toHaveBeenLastCalledWith(
          expect.objectContaining({
            error: expect.stringContaining("Identity lookup unavailable"),
          }),
        );
      } finally {
        identity.mockRestore();
        finish.mockRestore();
        fixture.restore();
      }
    },
  );

  it.each(["preflight", "dispatch"])(
    "settles rejected recovery with confirmed delivery at %s",
    async (stage) => {
      const fixture = interruptedScheduledJob();
      const identity = vi.spyOn(
        automationRunner,
        "resolveBackgroundAutomationIdentity",
      );
      if (stage === "dispatch")
        identity.mockResolvedValueOnce({
          ok: true,
          identity: { userEmail: fixture.resource.owner },
        } as any);
      identity.mockResolvedValueOnce({
        ok: false,
        code: "owner_missing",
        reason: "Owner removed",
      });
      const finish = vi
        .spyOn(runHistory, "finishAutomationRun")
        .mockResolvedValue(undefined);
      try {
        await processRecurringJobs(recoveryDeps);
        expect(runAgentLoopMock).not.toHaveBeenCalled();
        expect(finish).toHaveBeenCalledWith(
          fixture.history.id,
          "error",
          expect.stringContaining("send-test-email"),
          "owner_missing",
          { requirePersisted: true },
        );
        const meta = parseJobResource(
          resourcePutMock.mock.calls.at(-1)![2],
        ).meta;
        expect(meta).toMatchObject({
          lastStatus: "paused",
          pausedReason: "owner_missing",
          enabled: false,
        });
        expect(meta.lastError).toContain("send-test-email");
        expect(meta.lastError).not.toContain("No delivery was confirmed");
        expect(finish.mock.invocationCallOrder[0]).toBeLessThan(
          resourcePutMock.mock.invocationCallOrder[0]!,
        );
      } finally {
        identity.mockRestore();
        finish.mockRestore();
        fixture.restore();
      }
    },
  );

  it.each(["resume", "exhausted", "identity rejected"])(
    "preserves paused manual firing policy when %s",
    async (state) => {
      const fixture = interruptedScheduledJob(state === "exhausted" ? 4 : 1);
      const nextRun = "2026-10-09T00:00:00Z";
      fixture.resource.content = fixture.resource.content.replace(
        "enabled: true",
        "enabled: false\npausedReason: http_502\npausedAt: 2026-10-01T00:00:00Z\nconsecutiveFailures: 3\nlastErrorCode: http_502\nlastRunManual: true\nlastRunAdvanceSchedule: false\nnextRun: " +
          nextRun,
      );
      const finish = vi
        .spyOn(runHistory, "finishAutomationRun")
        .mockResolvedValue(undefined);
      const identity = vi.spyOn(
        automationRunner,
        "resolveBackgroundAutomationIdentity",
      );
      if (state === "identity rejected")
        identity.mockResolvedValueOnce({
          ok: false,
          code: "owner_missing",
          reason: "Owner removed",
        });
      if (state === "resume") {
        vi.mocked(getThread).mockResolvedValueOnce({
          id: "thread-1",
          threadData: JSON.stringify({
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "Original manual request" }],
                metadata: { custom: { submittedTurnId: "killed-worker" } },
              },
            ],
          }),
        } as any);
        runAgentLoopMock.mockRejectedValueOnce(
          new Error("Provider unavailable"),
        );
      }
      try {
        await processRecurringJobs(recoveryDeps);
        const meta = parseJobResource(
          resourcePutMock.mock.calls.at(-1)![2],
        ).meta;
        expect(meta).toMatchObject({
          lastStatus: "error",
          enabled: false,
          pausedReason: "http_502",
          consecutiveFailures: 3,
          nextRun,
        });
        if (state === "resume") {
          expect(runAgentLoopMock).toHaveBeenCalledOnce();
          expect(startRunMock.mock.calls[0]![0]).toMatch(/^manual-/);
        }
      } finally {
        identity.mockRestore();
        finish.mockRestore();
        fixture.restore();
      }
    },
  );

  it("persists manual firing policy before starting its worker", async () => {
    const resource = {
      id: "manual-resource",
      owner: "owner@example.com",
      path: "jobs/manual.md",
      content:
        '---\nschedule: "*/2 * * * *"\nenabled: true\n---\nRun manual work.',
    };
    resourceListAllOwnersMock.mockResolvedValue([resource]);
    const start = vi
      .spyOn(runHistory, "startAutomationRun")
      .mockImplementation(async (_input, options) => {
        await options?.afterInsert?.(
          { execute: dbExecuteMock },
          "manual-history",
        );
        options?.afterCommit?.();
        return "manual-history";
      });
    resourceGetByPathMock.mockResolvedValueOnce(resource);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      await runJobNow(resource.owner, "manual", recoveryDeps);
      expect(
        parseJobResource(resourcePutMock.mock.calls[0]![2]).meta,
      ).toMatchObject({
        lastStatus: "running",
        lastHistoryId: "manual-history",
        lastRunManual: true,
        lastRunAdvanceSchedule: false,
      });
    } finally {
      start.mockRestore();
      finish.mockRestore();
    }
  });

  it("retries rejected recovery settlement without losing the pause or delivery evidence", async () => {
    const fixture = interruptedScheduledJob();
    const identity = vi
      .spyOn(automationRunner, "resolveBackgroundAutomationIdentity")
      .mockResolvedValueOnce({
        ok: false,
        code: "owner_missing",
        reason: "Owner removed",
      });
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockImplementation(async (_id, status, error, errorCode) => {
        Object.assign(fixture.history, {
          status,
          error,
          errorCode,
          finishedAt: Date.now(),
        });
      });
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(resourcePutMock).not.toHaveBeenCalled();
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      expect(identity).toHaveBeenCalledOnce();
      expect(
        parseJobResource(resourcePutMock.mock.calls.at(-1)![2]).meta,
      ).toMatchObject({
        lastStatus: "paused",
        enabled: false,
        pausedReason: "owner_missing",
      });
      expect(resourcePutMock.mock.calls.at(-1)![2]).toContain(
        "send-test-email",
      );
    } finally {
      identity.mockRestore();
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("retries the original turn after temporary identity recovery while dispatching unrelated work", async () => {
    const fixture = interruptedScheduledJob();
    const healthy = {
      id: "healthy-resource",
      owner: "owner@example.com",
      path: "jobs/healthy.md",
      content:
        '---\nschedule: "* * * * *"\nenabled: true\nnextRun: 2026-01-01T00:00:00Z\n---\nRun healthy work.',
    };
    resourceListAllOwnersMock.mockResolvedValue([fixture.resource, healthy]);
    const identity = vi
      .spyOn(automationRunner, "resolveBackgroundAutomationIdentity")
      .mockResolvedValueOnce({
        ok: false,
        code: "owner_unverifiable",
        reason: "Identity lookup unavailable",
      });
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(runAgentLoopMock).toHaveBeenCalledOnce();
      expect(
        resourcePutMock.mock.calls.every((call) => call[1] === healthy.path),
      ).toBe(true);
      resourceListAllOwnersMock.mockResolvedValue([fixture.resource]);
      vi.mocked(getThread).mockResolvedValueOnce({
        id: "thread-1",
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Original request" }],
              metadata: { custom: { submittedTurnId: "killed-worker" } },
            },
          ],
        }),
      } as any);
      await processRecurringJobs(recoveryDeps);
      expect(runAgentLoopMock).toHaveBeenCalledTimes(2);
      expect(runAgentLoopMock.mock.calls.at(-1)![0]).toMatchObject({
        threadId: "thread-1",
        turnId: "killed-worker",
      });
    } finally {
      identity.mockRestore();
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("counts exhausted recovery as one failed firing and applies runtime backoff", async () => {
    const fixture = interruptedScheduledJob(4);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      const before = new Date();
      await processRecurringJobs(recoveryDeps);
      const meta = parseJobResource(resourcePutMock.mock.calls.at(-1)![2]).meta;
      expect(meta).toMatchObject({
        lastStatus: "error",
        lastErrorCode: "stale_run",
        consecutiveFailures: 1,
        lastFailedEventId: fixture.history.id,
      });
      expect(meta.lastError).toContain("send-test-email");
      expect(meta.lastError).not.toContain("No delivery was confirmed");
      expect(Date.parse(meta.nextRun!)).toBeGreaterThanOrEqual(
        runtimeFailureNextRun(before, before, 1).getTime(),
      );
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("pauses once after exhausted recovery even when settlement loses its first resource write", async () => {
    const fixture = interruptedScheduledJob(4);
    fixture.resource.content = fixture.resource.content.replace(
      "lastStatus: running",
      `lastStatus: running\nlastErrorCode: stale_run\nconsecutiveFailures: ${RUNTIME_PAUSE_AFTER - 1}`,
    );
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockImplementation(async (_id, status, error, errorCode) => {
        Object.assign(fixture.history, {
          finishedAt: Date.now(),
          status,
          error,
          errorCode,
        });
      });
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(resourcePutMock).not.toHaveBeenCalled();
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      const meta = parseJobResource(resourcePutMock.mock.calls.at(-1)![2]).meta;
      expect(meta).toMatchObject({
        lastStatus: "paused",
        enabled: false,
        consecutiveFailures: RUNTIME_PAUSE_AFTER,
        lastFailedEventId: fixture.history.id,
        pausedReason: "stale_run",
      });
      expect(meta.lastError).toContain("send-test-email");
      expect(meta.lastError).not.toContain("No delivery was confirmed");
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("does not apply a recovered failure to a newer firing read during settlement", async () => {
    const fixture = interruptedScheduledJob(4);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    resourceGetByPathMock.mockResolvedValueOnce({
      ...fixture.resource,
      content: fixture.resource.content.replace(
        new Date(fixture.history.startedAt).toISOString(),
        new Date().toISOString(),
      ),
    });
    try {
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      expect(resourcePutMock).not.toHaveBeenCalled();
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("retries terminal history persistence before clearing the resource recovery marker", async () => {
    const fixture = interruptedScheduledJob(4);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockRejectedValueOnce(new Error("history database unavailable"))
      .mockResolvedValue(undefined);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(resourcePutMock).not.toHaveBeenCalled();
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledTimes(2);
      expect(resourcePutMock).toHaveBeenCalledOnce();
      expect(resourcePutMock.mock.calls[0]![2]).toContain("send-test-email");
      expect(finish.mock.invocationCallOrder[1]).toBeLessThan(
        resourcePutMock.mock.invocationCallOrder[0]!,
      );
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("retains a queued firing when a dispatch claims it during terminal settlement", async () => {
    const fixture = interruptedScheduledJob();
    const expiredClaim =
      Date.now() - runHistory.automationRunClaimLeaseMs() - 1_000;
    Object.assign(fixture.history, {
      runId: null,
      threadId: null,
      dispatchPending: true,
      claimedAt: expiredClaim,
    });
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockImplementation(async (_id, _status, _error, _code, options) => {
        expect(options).toMatchObject({
          requirePersisted: true,
          expectedClaimedAt: expiredClaim,
        });
        Object.assign(fixture.history, { claimedAt: Date.now() });
        throw new runHistory.AutomationRunHistoryWriteError(fixture.history.id);
      });
    try {
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      expect(resourcePutMock).not.toHaveBeenCalled();
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      expect(resourcePutMock).not.toHaveBeenCalled();
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("reconciles the resource after history settles and its resource write loses the race", async () => {
    const fixture = interruptedScheduledJob(4);
    const finish = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockImplementation(async () => {
        fixture.history.finishedAt = Date.now();
        fixture.history.status = "error";
        Object.assign(fixture.history, {
          error:
            "Stopped. Completed steps confirmed by the run journal: send-test-email.",
        });
      });
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    try {
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      expect(resourcePutMock).not.toHaveBeenCalled();
      await processRecurringJobs(recoveryDeps);
      expect(finish).toHaveBeenCalledOnce();
      expect(resourcePutMock.mock.calls[0]![2]).toContain("send-test-email");
    } finally {
      finish.mockRestore();
      fixture.restore();
    }
  });

  it("resets a stuck event automation with no cron schedule, not just cron jobs", async () => {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stuckContent = [
      "---",
      'schedule: ""',
      "enabled: true",
      "createdBy: alice+jobs@agent-native.test",
      "triggerType: event",
      "event: order.created",
      "deliveryPlatform: slack",
      "deliveryDestination: C0123456",
      "lastStatus: running",
      "lastRun: " + stuckLastRun,
      "---",
      "",
      "Summarize the new order and post it to Slack.",
    ].join("\n");

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-stuck-event",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/slack-support.md",
        content: stuckContent,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(createThreadMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();

    expect(resourcePutMock).toHaveBeenCalledOnce();
    const putCall = resourcePutMock.mock.calls[0][1];
    expect(putCall).toBe("jobs/slack-support.md");
    const putContent = resourcePutMock.mock.calls[0][2];
    expect(putContent).toContain("lastStatus: error");
    expect(putContent).toContain("timed out or been recycled");

    const unlockedResource = {
      id: "resource-stuck-event",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/slack-support.md",
      updatedAt: "2026-08-04T00:00:00.000Z",
      content: putContent,
    };
    resourceGetByPathMock.mockResolvedValueOnce(unlockedResource);

    const result = await runJobNow(unlockedResource.owner, "slack-support", {
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(result.status).not.toBe("skipped");
    expect(runAgentLoopMock).toHaveBeenCalledOnce();
  });

  it("resumes a killed scheduled firing on its next tick with its completed email and original turn", async () => {
    const startedAt = Date.now() - 120_000;
    const lastRun = new Date(startedAt).toISOString();
    const resource = {
      id: "resource-killed",
      owner: "owner@agent-native.test",
      path: "jobs/digest.md",
      content: [
        "---",
        'schedule: "*/2 * * * *"',
        "enabled: true",
        "lastStatus: running",
        `lastRun: ${lastRun}`,
        "lastHistoryId: history-killed",
        "---",
        "Send the email, then open a ticket.",
      ].join("\n"),
    };
    resourceListAllOwnersMock.mockResolvedValueOnce([resource]);
    const emailEvents = [
      {
        type: "tool_start" as const,
        tool: "send-test-email",
        id: "email-1",
        input: { to: "ops@example.com" },
      },
      {
        type: "tool_done" as const,
        tool: "send-test-email",
        id: "email-1",
        result: "Email delivered",
        completedSideEffect: true,
      },
    ];
    const spies = [
      vi.spyOn(runHistory, "getAutomationRun").mockResolvedValue({
        id: "history-killed",
        owner: resource.owner,
        appId: null,
        path: resource.path,
        runId: "job-killed",
        threadId: "thread-1",
        startedAt,
        finishedAt: null,
      } as any),
      vi.spyOn(runStore, "reapIfStale").mockResolvedValue(true),
      vi.spyOn(runStore, "getRunById").mockResolvedValue({
        id: "job-killed",
        status: "errored",
        errorCode: "stale_run",
      } as any),
      vi
        .spyOn(runStore, "getRunTurnRef")
        .mockResolvedValue({ threadId: "thread-1", turnId: "job-killed" }),
      vi.spyOn(runStore, "countRunsForTurn").mockResolvedValue(1),
      vi.spyOn(runStore, "getCurrentTurnRunEventsForThread").mockResolvedValue(
        emailEvents.map((event, seq) => ({
          runId: "job-killed",
          seq,
          event,
        })),
      ),
      vi
        .spyOn(runStore, "tryClaimRunSlot")
        .mockResolvedValue({ claimed: true, activeRunId: null }),
    ];
    try {
      vi.mocked(getThread).mockResolvedValueOnce({
        id: "thread-1",
        title: "Job",
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Send the email, then open the original ticket.",
                },
              ],
              metadata: { custom: { submittedTurnId: "job-killed" } },
            },
          ],
        }),
      } as any);
      await processRecurringJobs({
        getActions: () => ({}),
        getSystemPrompt: async () => "system",
        engine: testEngine,
        model: "test-model",
      });
      expect(createThreadMock).not.toHaveBeenCalled();
      expect(runAgentLoopMock).toHaveBeenCalledOnce();
      const loop = runAgentLoopMock.mock.calls[0]![0];
      expect(loop).toMatchObject({
        threadId: "thread-1",
        turnId: "job-killed",
      });
      expect(JSON.stringify(loop.messages)).toContain("Email delivered");
      expect(JSON.stringify(loop.messages)).toContain("Already completed");
      expect(JSON.stringify(loop.messages)).toContain("send-test-email");
      expect(runStore.tryClaimRunSlot).toHaveBeenCalledWith(
        "thread-1",
        expect.any(String),
        undefined,
        expect.objectContaining({ turnId: "job-killed" }),
      );
      expect(resourcePutMock.mock.calls.at(-1)![2]).toContain(
        "lastStatus: success",
      );
      expect(resourcePutMock.mock.calls.at(-1)![2]).toContain(lastRun);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("does not write automation history when the stale-lock reset loses its CAS", async () => {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stuckContent = [
      "---",
      'schedule: ""',
      "enabled: true",
      "createdBy: alice+jobs@agent-native.test",
      "triggerType: event",
      "event: order.created",
      "lastStatus: running",
      "lastRun: " + stuckLastRun,
      "---",
      "",
      "Do the thing.",
    ].join("\n");

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-race",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/race.md",
        content: stuckContent,
      },
    ]);
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    const listAutomationRunsSpy = vi.spyOn(runHistory, "listAutomationRuns");
    const finishAutomationRunSpy = vi.spyOn(runHistory, "finishAutomationRun");

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(listAutomationRunsSpy).not.toHaveBeenCalled();
    expect(finishAutomationRunSpy).not.toHaveBeenCalled();
  });

  function staleHistoryJob() {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    return {
      id: "resource-stale-history",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/slack-support.md",
      content: [
        "---",
        'schedule: "* * * * *"',
        'nextRun: "1970-01-01T00:00:00.000Z"',
        "enabled: true",
        "createdBy: alice+jobs@agent-native.test",
        "lastStatus: running",
        "lastRun: " + stuckLastRun,
        "---",
        "",
        "Summarize the new order and post it to Slack.",
      ].join("\n"),
    };
  }

  function historyRow(
    id: string,
    startedAt: number,
    options: { claimedAt?: number | null; dispatchPending?: boolean } = {},
  ) {
    return {
      id,
      owner: "alice+jobs@agent-native.test",
      automation: "slack-support",
      path: "jobs/slack-support.md",
      scope: "personal",
      org_id: null,
      app_id: null,
      run_id: null,
      thread_id: null,
      status: "running",
      started_at: startedAt,
      finished_at: null,
      error: null,
      error_code: null,
      notification_email: null,
      dispatch_pending: options.dispatchPending === true ? 1 : 0,
      claimed_at: options.claimedAt ?? null,
    };
  }

  /** The terminal writes `finishAutomationRun` issues, keyed by run id. */
  function routeHistoryDb(
    rows: Array<Record<string, unknown>>,
    options: { failFirstFinish?: boolean } = {},
  ): Array<{
    id: string;
    status: string;
    errorCode: string | null;
  }> {
    const finishes: Array<{
      id: string;
      status: string;
      errorCode: string | null;
    }> = [];
    let finishAttempts = 0;
    dbExecuteMock.mockImplementation(
      async (query: { sql?: string; args?: unknown[] }) => {
        const sql = query.sql ?? "";
        if (sql.includes("SELECT * FROM automation_runs WHERE owner IN")) {
          const limit = Number(/LIMIT\s+(\d+)/i.exec(sql)?.[1] ?? rows.length);
          return { rows: rows.slice(0, limit), rowsAffected: 0 };
        }
        if (sql.includes("FROM automation_runs WHERE id = ?")) {
          const id = String(query.args?.[0] ?? "");
          return { rows: rows.filter((row) => row.id === id), rowsAffected: 0 };
        }
        if (
          sql.startsWith("UPDATE automation_runs") &&
          sql.includes("SET status = ?")
        ) {
          finishAttempts += 1;
          if (options.failFirstFinish && finishAttempts === 1) {
            throw new Error("history write failed");
          }
          const [status, , , errorCode, , , id] = query.args ?? [];
          finishes.push({
            id: String(id),
            status: String(status),
            errorCode: errorCode == null ? null : String(errorCode),
          });
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [{ "1": 1 }], rowsAffected: 1 };
      },
    );
    return finishes;
  }

  it("still records the stopped run itself when the stale-lock resets", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const finishes = routeHistoryDb([
      historyRow("run-stopped", Date.now() - 11 * 60 * 1000),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes).toEqual([
      {
        id: "run-stopped",
        status: "error",
        errorCode: "background_automation_interrupted",
      },
    ]);
  });

  it("settles the stopped run without touching a newer queued run", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const finishes = routeHistoryDb([
      historyRow("run-queued-now", Date.now() - 30_000, {
        dispatchPending: true,
      }),
      historyRow("run-stopped", Date.now() - 11 * 60 * 1000),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes).toEqual([
      {
        id: "run-stopped",
        status: "error",
        errorCode: "background_automation_interrupted",
      },
    ]);
    expect(resourcePutMock).toHaveBeenCalledOnce();
    expect(resourcePutMock.mock.calls[0][2]).toContain("lastStatus: error");
  });

  it("keeps a queued dispatch inside its claim lease and closes one past it", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const finishes = routeHistoryDb([
      // Started 20 minutes ago, so it lists as `interrupted`, but claimed a
      // minute ago: the stored claim, not the derived status, must protect it.
      historyRow("run-claimed-recently", Date.now() - 20 * 60 * 1000, {
        dispatchPending: true,
        claimedAt: Date.now() - 60_000,
      }),
      // Never claimed, older than the 15-minute claim lease: stuck queue entry.
      historyRow("run-queued-too-long", Date.now() - 16 * 60 * 1000, {
        dispatchPending: true,
      }),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes).toEqual([
      {
        id: "run-queued-too-long",
        status: "error",
        errorCode: "background_automation_interrupted",
      },
    ]);
  });

  it("settles every stopped run, not just the first batch", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const stoppedAt = Date.now() - 11 * 60 * 1000;
    const finishes = routeHistoryDb([
      historyRow("run-queued-now", Date.now() - 30_000, {
        dispatchPending: true,
      }),
      ...Array.from({ length: 21 }, (_, index) =>
        historyRow(`run-stopped-${index}`, stoppedAt),
      ),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes.map((finish) => finish.id)).toEqual(
      Array.from({ length: 21 }, (_, index) => `run-stopped-${index}`),
    );
  });

  it("keeps settling later runs when one history write fails", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const stoppedAt = Date.now() - 11 * 60 * 1000;
    const finishes = routeHistoryDb(
      [
        historyRow("run-stopped-1", stoppedAt),
        historyRow("run-stopped-2", stoppedAt),
      ],
      { failFirstFinish: true },
    );

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes.map((finish) => finish.id)).toEqual(["run-stopped-2"]);
  });
});
