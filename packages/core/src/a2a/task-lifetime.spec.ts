import { afterEach, describe, expect, it } from "vitest";

import {
  A2A_PROCESSING_LIFETIME_FAILURE_REASON,
  A2A_PROCESSING_STALE_FAILURE_REASON,
  A2A_QUEUED_LIFETIME_FAILURE_REASON,
  a2aProcessingLifetimeMaxMs,
  a2aQueuedLifetimeMaxMs,
  classifyStuckA2ATask,
} from "./task-lifetime.js";

const NOW = 1_700_000_000_000;

afterEach(() => {
  delete process.env.A2A_QUEUED_LIFETIME_MAX_MS;
  delete process.env.A2A_PROCESSING_LIFETIME_MAX_MS;
});

describe("classifyStuckA2ATask", () => {
  it("leaves a freshly queued task alone", () => {
    expect(
      classifyStuckA2ATask(
        {
          statusState: "working",
          createdAt: NOW - 2_000,
          updatedAt: NOW - 2_000,
        },
        NOW,
      ),
    ).toEqual({ kind: "healthy" });
  });

  it("asks for a dispatch refire once the queued task stops being touched", () => {
    expect(
      classifyStuckA2ATask(
        {
          statusState: "submitted",
          createdAt: NOW - 30_000,
          updatedAt: NOW - 30_000,
        },
        NOW,
      ),
    ).toEqual({ kind: "refire-queued" });
  });

  it("gives up on a queued task that never reached processing", () => {
    const verdict = classifyStuckA2ATask(
      {
        statusState: "working",
        createdAt: NOW - a2aQueuedLifetimeMaxMs() - 1,
        updatedAt: NOW - 1_000,
      },
      NOW,
    );
    expect(verdict.kind).toBe("fail-queued");
    if (verdict.kind !== "fail-queued") throw new Error("unreachable");
    expect(verdict.reason).toBe(A2A_QUEUED_LIFETIME_FAILURE_REASON);
    expect(verdict.createdAtCutoff).toBe(NOW - a2aQueuedLifetimeMaxMs());
  });

  it("fails a processing task whose heartbeat died", () => {
    const verdict = classifyStuckA2ATask(
      {
        statusState: "processing",
        createdAt: NOW - 6 * 60 * 1000,
        updatedAt: NOW - 6 * 60 * 1000,
      },
      NOW,
    );
    expect(verdict.kind).toBe("fail-processing");
    if (verdict.kind !== "fail-processing") throw new Error("unreachable");
    expect(verdict.reason).toBe(A2A_PROCESSING_STALE_FAILURE_REASON);
  });

  it("fails a still-heartbeating processing task that blew its lifetime", () => {
    const verdict = classifyStuckA2ATask(
      {
        statusState: "processing",
        createdAt: NOW - a2aProcessingLifetimeMaxMs() - 1,
        updatedAt: NOW - 1_000,
      },
      NOW,
    );
    expect(verdict.kind).toBe("fail-processing");
    if (verdict.kind !== "fail-processing") throw new Error("unreachable");
    expect(verdict.reason).toBe(A2A_PROCESSING_LIFETIME_FAILURE_REASON);
  });

  it("leaves a healthy long-running processing task alone", () => {
    expect(
      classifyStuckA2ATask(
        {
          statusState: "processing",
          createdAt: NOW - 10 * 60 * 1000,
          updatedAt: NOW - 5_000,
        },
        NOW,
      ),
    ).toEqual({ kind: "healthy" });
  });

  it("never classifies a terminal task as stuck", () => {
    for (const statusState of ["completed", "failed", "canceled"]) {
      expect(
        classifyStuckA2ATask({ statusState, createdAt: 0, updatedAt: 0 }, NOW),
      ).toEqual({ kind: "healthy" });
    }
  });

  it("honors the environment overrides for both ceilings", () => {
    process.env.A2A_QUEUED_LIFETIME_MAX_MS = "5000";
    process.env.A2A_PROCESSING_LIFETIME_MAX_MS = "7000";
    expect(a2aQueuedLifetimeMaxMs()).toBe(5_000);
    expect(a2aProcessingLifetimeMaxMs()).toBe(7_000);
  });
});
