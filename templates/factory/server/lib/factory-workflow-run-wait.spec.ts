import { describe, expect, it, vi } from "vitest";

import type { RunDetail } from "../workflow-host/read-models/runs.js";
import {
  ALREADY_RUNNING_MESSAGE,
  waitForWorkflowRun,
  type SchedulerOutcome,
} from "./factory-workflow-run-wait.js";

function detail(
  status: "running" | "succeeded" | "failed",
  mode: "dry" | "live" = "dry",
): RunDetail {
  return {
    run: { id: "run-1", status, mode, graphVersion: 3 },
    steps: [
      { nodeId: "a", status: status === "failed" ? "failed" : "succeeded" },
    ],
    stepsTruncated: false,
  } as unknown as RunDetail;
}

/** A clock the fake sleep advances, so the wait is measured without waiting. */
function clock() {
  let at = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => at,
    sleep: async (ms: number) => {
      slept.push(ms);
      at += ms;
    },
  };
}

describe("waitForWorkflowRun", () => {
  it("polls until the run has been started and has ended", async () => {
    const time = clock();
    const reads = [null, detail("running"), detail("failed")];

    const result = await waitForWorkflowRun({
      readRun: async () => reads.shift() ?? null,
      readCleanVersion: async () => null,
      waitMs: 10_000,
      ...time,
    });

    expect(result).toMatchObject({ state: "finished" });
    expect(time.slept).toHaveLength(2);
  });

  it("never waits past its limit, and reports a run that is still going", async () => {
    const time = clock();

    const result = await waitForWorkflowRun({
      readRun: async () => detail("running"),
      readCleanVersion: async () => null,
      waitMs: 1_200,
      pollMs: 500,
      ...time,
    });

    expect(result).toMatchObject({ state: "still_running" });
    expect(time.slept).toEqual([500, 500, 200]);
  });

  it("does not call a clean dry run finished until its verdict is recorded", async () => {
    const time = clock();
    let checks = 0;

    const finished = await waitForWorkflowRun({
      readRun: async () => detail("succeeded"),
      readCleanVersion: async () => (++checks > 2 ? 3 : null),
      waitMs: 10_000,
      ...time,
    });
    expect(finished).toMatchObject({ state: "finished" });
    expect(time.slept).toHaveLength(2);

    const never = await waitForWorkflowRun({
      readRun: async () => detail("succeeded"),
      readCleanVersion: async () => null,
      waitMs: 1_000,
      ...clock(),
    });
    expect(never).toMatchObject({ state: "still_running" });
  });
});

describe("waitForWorkflowRun: a run the scheduler ended before the workflow started", () => {
  const ended = (
    status: SchedulerOutcome["status"],
    error: string | null,
    errorCode: string | null = null,
  ): SchedulerOutcome => ({ status, error, errorCode });

  it("answers `skipped` at once when the scheduler refused it because another run was going", async () => {
    const time = clock();
    const alreadyRunning = ended(
      "error",
      `${ALREADY_RUNNING_MESSAGE} No delivery was confirmed.`,
    );

    const result = await waitForWorkflowRun({
      readRun: async () => null,
      readCleanVersion: async () => null,
      readScheduler: async () => alreadyRunning,
      waitMs: 25_000,
      ...time,
    });

    expect(result).toEqual({ state: "skipped", reason: "already_running" });
    expect(time.slept).toEqual([]);
  });

  it("gives the scheduler's own code and message for any other run it ended without starting the workflow", async () => {
    const outcome = ended(
      "error",
      "Workflow is switched off.",
      "workflow_disabled",
    );

    const result = await waitForWorkflowRun({
      readRun: async () => null,
      readCleanVersion: async () => null,
      readScheduler: async () => outcome,
      waitMs: 25_000,
      ...clock(),
    });

    expect(result).toEqual({ state: "not_started", outcome });
  });

  it("keeps waiting while the scheduler's row is still running, and when it cannot be found", async () => {
    const time = clock();
    const rows = [ended("running", null), null, ended("running", null)];

    const result = await waitForWorkflowRun({
      readRun: async () => null,
      readCleanVersion: async () => null,
      readScheduler: async () => rows.shift() ?? null,
      waitMs: 1_200,
      pollMs: 500,
      ...time,
    });

    expect(result).toEqual({ state: "still_running", detail: null });
    expect(time.slept).toEqual([500, 500, 200]);
  });

  it("does not call a run skipped when the workflow's run appeared as the scheduler's row ended", async () => {
    const reads = [null, detail("failed")];

    const result = await waitForWorkflowRun({
      readRun: async () => reads.shift() ?? null,
      readCleanVersion: async () => null,
      readScheduler: async () => ended("success", null),
      waitMs: 10_000,
      ...clock(),
    });

    expect(result).toMatchObject({ state: "finished" });
  });

  it("stops asking the scheduler once the workflow's run exists", async () => {
    const readScheduler = vi.fn(async () => ended("running", null));
    const reads = [null, detail("running"), detail("failed")];

    await waitForWorkflowRun({
      readRun: async () => reads.shift() ?? null,
      readCleanVersion: async () => null,
      readScheduler,
      waitMs: 10_000,
      ...clock(),
    });

    expect(readScheduler).toHaveBeenCalledTimes(1);
  });
});
