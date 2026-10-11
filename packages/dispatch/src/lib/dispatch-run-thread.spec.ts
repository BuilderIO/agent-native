import { describe, expect, it } from "vitest";

import { getDispatchRunThreadContext } from "./dispatch-run-thread.js";

describe("getDispatchRunThreadContext", () => {
  it("preserves the parent and task label for Agent Teams runs", () => {
    expect(
      getDispatchRunThreadContext("child-thread", {
        id: "run-1",
        owner: "owner@example.test",
        title: "Review Slides task",
        percent: null,
        status: "running",
        startedAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
        completedAt: null,
        metadata: {
          kind: "agent-team",
          parentThreadId: " parent-thread ",
          description: "Review the Slides task",
          name: "Slides review",
        },
      }),
    ).toEqual({
      parentThreadId: "parent-thread",
      description: "Review the Slides task",
      name: "Slides review",
    });
  });

  it("does not attach task context to standard or self-parented runs", () => {
    const run = {
      id: "run-1",
      owner: "owner@example.test",
      title: "Build deck",
      percent: null,
      status: "running" as const,
      startedAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
      completedAt: null,
      metadata: { kind: "agent-team", parentThreadId: "same-thread" },
    };

    expect(
      getDispatchRunThreadContext("child-thread", { ...run, metadata: {} }),
    ).toBeUndefined();
    expect(getDispatchRunThreadContext("same-thread", run)).toBeUndefined();
  });
});
