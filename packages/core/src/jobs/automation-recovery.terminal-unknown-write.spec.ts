import { expect, it, vi } from "vitest";

import type { Resource } from "../resources/store.js";
import { inspectAutomationRecovery } from "./automation-recovery.js";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  reap: vi.fn(),
  get: vi.fn(),
  ref: vi.fn(),
  runEvents: vi.fn(),
}));

vi.mock("./run-history.js", () => ({
  getAutomationRun: mocks.history,
  listAutomationRuns: vi.fn(),
  automationRunClaimLeaseMs: () => 900_000,
}));
vi.mock("../agent/run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/run-store.js")>()),
  reapIfStale: mocks.reap,
  getRunById: mocks.get,
  getRunTurnRef: mocks.ref,
  getCurrentTurnRunEventsForThread: mocks.runEvents,
}));

it.each(["completed", "errored"])(
  "preserves an unknown write before a terminal error for a %s run",
  async (status) => {
    const now = new Date("2026-10-05T17:30:00Z");
    const startedAt = now.getTime() - 120_000;
    const resource = {
      owner: "owner@example.com",
      path: "jobs/digest.md",
    } as Resource;
    const history = {
      id: "history-1",
      owner: resource.owner,
      appId: null,
      runId: "job-1",
      threadId: "thread-1",
      path: resource.path,
      startedAt,
      status: "running",
      finishedAt: null,
    };
    const events = [
      {
        type: "tool_done",
        tool: "send-report",
        isError: true,
        outcomeUnknown: true,
        result: "PRIVATE_PROVIDER_RESPONSE",
      },
      { type: "error", error: "Gateway failed", errorCode: "http_502" },
    ];
    mocks.history.mockResolvedValue(history);
    mocks.reap.mockResolvedValue(true);
    mocks.get.mockResolvedValue({
      id: "job-1",
      status,
      errorCode: "http_502",
    });
    mocks.ref.mockResolvedValue({ threadId: "thread-1", turnId: "job-1" });
    mocks.runEvents.mockResolvedValue(
      events.map((event, seq) => ({ runId: "job-1", seq, event })),
    );

    const recovery = await inspectAutomationRecovery(
      resource,
      {
        enabled: true,
        schedule: "*/2 * * * *",
        lastStatus: "running",
        lastHistoryId: history.id,
        lastRun: new Date(startedAt).toISOString(),
      },
      now,
    );
    expect(recovery).toMatchObject({
      state: "settle",
      status: "error",
      errorCode: "write_tool_outcome_unknown",
      error: expect.stringContaining("An action may already have applied."),
    });
    if (recovery?.state !== "settle") throw new Error("Expected settlement");
    expect(recovery.error).not.toContain("PRIVATE_PROVIDER_RESPONSE");
  },
);
