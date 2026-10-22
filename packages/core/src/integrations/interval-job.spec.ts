import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startIntervalJob } from "./interval-job.js";
import {
  retryStuckPendingTasks,
  startPendingTasksRetryJob,
  stopPendingTasksRetryJob,
} from "./pending-tasks-retry-job.js";
import {
  startRemotePushDeliveryJob,
  stopRemotePushDeliveryJob,
} from "./remote-push-delivery-job.js";
import {
  startRemoteCommandsRetryJob,
  stopRemoteCommandsRetryJob,
} from "./remote-retry-job.js";

const mocks = vi.hoisted(() => ({
  ensurePendingTasksTable: vi.fn(),
  execute: vi.fn(),
  dispatch: vi.fn(),
  retryRemoteCommands: vi.fn(),
  deliverRemotePush: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("./pending-tasks-store.js", () => ({
  ensurePendingTasksTable: mocks.ensurePendingTasksTable,
  MAX_PENDING_TASK_ATTEMPTS: 3,
  MAX_RECOVERABLE_PENDING_TASK_AGE_MS: 24 * 60 * 60 * 1000,
}));
vi.mock("./integration-campaigns-store.js", () => ({
  hasActiveIntegrationCampaign: vi.fn(async () => false),
}));
vi.mock("./integration-durable-dispatch.js", () => ({
  configuredIntegrationDurableDispatchScopes: vi.fn(() => null),
  dispatchPendingIntegrationTask: mocks.dispatch,
  isIntegrationDurableDispatchEnabledForTask: vi.fn(() => true),
}));
vi.mock("./remote-commands-store.js", () => ({
  retryStaleRemoteCommands: mocks.retryRemoteCommands,
}));
vi.mock("./remote-push-delivery.js", () => ({
  deliverPendingRemotePushNotifications: mocks.deliverRemotePush,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.execute.mockResolvedValue({ rows: [] });
  mocks.dispatch.mockResolvedValue("background-acknowledged");
});

afterEach(async () => {
  await Promise.all([
    stopPendingTasksRetryJob(),
    stopRemoteCommandsRetryJob(),
    stopRemotePushDeliveryJob(),
  ]);
  vi.useRealTimers();
});

describe("integration interval job", () => {
  it.each([true, false])(
    "skips a queued attempt when stopped before admission (leading=%s)",
    async (leading) => {
      const runOnce = vi.fn(async () => {});
      const job = startIntervalJob(runOnce, {
        intervalMs: 1000,
        leading,
      });
      if (!leading) vi.advanceTimersByTime(1000);

      await job.stop();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(runOnce).not.toHaveBeenCalled();
      await job.stop();
    },
  );

  it.each([false, true])(
    "drains an abort-ignoring callback without rearming (timed out=%s)",
    async (timedOut) => {
      const gate = deferred();
      const onError = vi.fn();
      let signal!: AbortSignal;
      const runOnce = vi.fn(async (input: AbortSignal) => {
        signal = input;
        await gate.promise;
      });
      const job = startIntervalJob(runOnce, {
        intervalMs: 1000,
        timeoutMs: 2000,
        onError,
      });
      try {
        await vi.advanceTimersByTimeAsync(0);
        if (timedOut) await vi.advanceTimersByTimeAsync(2000);

        let drained = false;
        const stopping = job.stop().then(() => {
          drained = true;
        });
        const stoppingAgain = job.stop();
        expect(signal.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(drained).toBe(false);
        expect(runOnce).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(timedOut ? 1 : 0);

        gate.resolve();
        await Promise.all([stopping, stoppingAgain]);
        expect(drained).toBe(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(runOnce).toHaveBeenCalledTimes(1);
      } finally {
        gate.resolve();
        await job.stop();
      }
    },
  );

  it.each([
    { timedOut: false, reportsErrors: false },
    { timedOut: false, reportsErrors: true },
    { timedOut: true, reportsErrors: true },
  ])(
    "rejects every drain for a late failure without duplicate reporting ($timedOut, $reportsErrors)",
    async ({ timedOut, reportsErrors }) => {
      const gate = deferred();
      const error = new Error("late attempt failed");
      const onError = vi.fn();
      const runOnce = vi.fn(() => gate.promise);
      const job = startIntervalJob(runOnce, {
        intervalMs: 1000,
        timeoutMs: 2000,
        onError: reportsErrors ? onError : undefined,
      });
      try {
        await vi.advanceTimersByTimeAsync(0);
        if (timedOut) await vi.advanceTimersByTimeAsync(2000);

        const stopping = Promise.allSettled([job.stop(), job.stop()]);
        gate.reject(error);
        expect(await stopping).toEqual([
          { status: "rejected", reason: error },
          { status: "rejected", reason: error },
        ]);
        await expect(job.stop()).rejects.toBe(error);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(runOnce).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(timedOut ? 1 : 0);
        expect(onError).not.toHaveBeenCalledWith(error);
      } finally {
        gate.resolve();
        await Promise.allSettled([job.stop()]);
      }
    },
  );

  it.each(["reason", "AbortError"])(
    "resolves the drain for normal stop cancellation (%s)",
    async (kind) => {
      const onError = vi.fn();
      const runOnce = vi.fn(
        (signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () =>
                reject(
                  kind === "reason"
                    ? signal.reason
                    : new DOMException("Aborted", "AbortError"),
                ),
              { once: true },
            );
          }),
      );
      const job = startIntervalJob(runOnce, { intervalMs: 1000, onError });
      try {
        await vi.advanceTimersByTimeAsync(0);
        await expect(job.stop()).resolves.toBeUndefined();
        await expect(job.stop()).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(runOnce).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
      } finally {
        await job.stop();
      }
    },
  );

  it("preserves delayed start, non-overlap, interval spacing, and error reporting", async () => {
    const gate = deferred();
    const error = new Error("attempt failed");
    const onError = vi.fn();
    const runOnce = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => gate.promise)
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const job = startIntervalJob(runOnce, {
      intervalMs: 1000,
      leading: false,
      onError,
    });
    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(runOnce).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(runOnce).toHaveBeenCalledTimes(1);
      gate.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(999);
      expect(runOnce).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(runOnce).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(runOnce).toHaveBeenCalledTimes(3);
    } finally {
      gate.resolve();
      await job.stop();
    }
  });
});

describe.each([
  {
    name: "pending tasks",
    start: startPendingTasksRetryJob,
    stop: stopPendingTasksRetryJob,
    run: mocks.ensurePendingTasksTable,
  },
  {
    name: "remote commands",
    start: startRemoteCommandsRetryJob,
    stop: stopRemoteCommandsRetryJob,
    run: mocks.retryRemoteCommands,
  },
  {
    name: "remote push",
    start: startRemotePushDeliveryJob,
    stop: stopRemotePushDeliveryJob,
    run: mocks.deliverRemotePush,
  },
])("$name shutdown", ({ start, stop, run }) => {
  it("cancels startup synchronously and allows a subsequent start", async () => {
    start();
    const stopping = stop();
    vi.advanceTimersByTime(10_000);
    await stopping;
    expect(run).not.toHaveBeenCalled();

    start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("prevents restart until admitted work has drained", async () => {
    const gate = deferred();
    run.mockImplementationOnce(() => gate.promise);
    start();
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(run).toHaveBeenCalledTimes(1);
      let drained = false;
      const stopping = stop().then(() => {
        drained = true;
      });
      const stoppingAgain = stop();
      start();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(drained).toBe(false);
      expect(run).toHaveBeenCalledTimes(1);

      gate.resolve();
      await Promise.all([stopping, stoppingAgain]);
      expect(drained).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(1);

      start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      gate.resolve();
      await stop();
    }
  });
});

it("releases a failed pending-task drain so a later explicit start can run", async () => {
  const gate = deferred();
  const error = new Error("pending-task initialization failed");
  mocks.ensurePendingTasksTable.mockReturnValueOnce(gate.promise);
  startPendingTasksRetryJob();
  await vi.advanceTimersByTimeAsync(10_000);
  const stopping = Promise.allSettled([
    stopPendingTasksRetryJob(),
    stopPendingTasksRetryJob(),
  ]);
  gate.reject(error);
  expect(await stopping).toEqual([
    { status: "rejected", reason: error },
    { status: "rejected", reason: error },
  ]);
  startPendingTasksRetryJob();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.ensurePendingTasksTable).toHaveBeenCalledTimes(2);
});

it("retains the pending-task webhook URL through drain, then clears it", async () => {
  const gate = deferred();
  mocks.ensurePendingTasksTable.mockImplementationOnce(() => gate.promise);
  mocks.execute.mockImplementation(async ({ sql }: { sql: string }) =>
    sql.includes("SELECT")
      ? {
          rows: [
            {
              id: "pending-task",
              platform: "slack",
              external_thread_id: "slack:test:channel:1",
              status: "pending",
              attempts: 1,
              updated_at: 10,
              dispatch_scope: null,
            },
          ],
        }
      : { rows: [], rowCount: 1 },
  );
  startPendingTasksRetryJob({ webhookBaseUrl: "https://app.test" });
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    const stopping = stopPendingTasksRetryJob();
    startPendingTasksRetryJob({ webhookBaseUrl: "https://replacement.test" });

    await retryStuckPendingTasks();
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: "https://app.test" }),
    );
    gate.resolve();
    await stopping;
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: "https://app.test" }),
    );

    await retryStuckPendingTasks();
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: undefined }),
    );
  } finally {
    gate.resolve();
    await stopPendingTasksRetryJob();
  }
});
