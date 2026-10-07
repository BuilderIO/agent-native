import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatEvent } from "../agent/types.js";
import type { Resource } from "../resources/store.js";
import {
  automationDeliveryNote,
  deliveryNoteForEvents,
  inspectAutomationRecovery,
} from "./automation-recovery.js";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  history: vi.fn(),
  reap: vi.fn(),
  get: vi.fn(),
  ref: vi.fn(),
  count: vi.fn(),
  events: vi.fn(),
}));
vi.mock("./run-history.js", () => ({
  listAutomationRuns: mocks.list,
  getAutomationRun: mocks.history,
}));
vi.mock("../agent/run-store.js", () => ({
  reapIfStale: mocks.reap,
  getRunById: mocks.get,
  getRunTurnRef: mocks.ref,
  countRunsForTurn: mocks.count,
  getCurrentTurnEventsForThread: mocks.events,
  STALE_RUN_RECOVERY_MAX_SUCCESSORS_PER_TURN: 3,
}));
vi.mock("../agent/run-manager.js", () => ({
  resolveBackgroundRunHardTimeoutMs: () => 600_000,
}));

const now = new Date("2026-10-05T17:30:00Z");
const startedAt = now.getTime() - 120_000;
const resource = {
  owner: "owner@example.com",
  path: "jobs/digest.md",
} as Resource;
const meta = {
  enabled: true,
  schedule: "*/2 * * * *",
  lastStatus: "running",
  lastHistoryId: "history-1",
  lastRun: new Date(startedAt).toISOString(),
};
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
const sent: AgentChatEvent[] = [
  {
    type: "tool_start",
    tool: "send-test-email",
    input: { to: "ops@example.com" },
  },
  {
    type: "tool_done",
    tool: "send-test-email",
    result: "sent",
    completedSideEffect: true,
  },
];

describe("automation worker recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([history]);
    mocks.history.mockResolvedValue(history);
    mocks.reap.mockResolvedValue(true);
    mocks.get.mockResolvedValue({
      id: "job-1",
      status: "errored",
      errorCode: "stale_run",
    });
    mocks.ref.mockResolvedValue({ threadId: "thread-1", turnId: "job-1" });
    mocks.count.mockResolvedValue(1);
    mocks.events.mockResolvedValue(sent);
  });

  it("recovers an unstarted successor released after scheduler lease loss", async () => {
    mocks.get.mockResolvedValue({
      id: "job-1",
      status: "errored",
      errorCode: "automation_scheduler_lease_lost",
    });
    expect(await inspectAutomationRecovery(resource, meta, now)).toMatchObject({
      state: "resume",
      resume: {
        historyId: history.id,
        threadId: history.threadId,
        turnId: "job-1",
      },
    });
  });

  it("recovers a dead worker at two minutes without waiting for the job's ten-minute timeout", async () => {
    expect(await inspectAutomationRecovery(resource, meta, now)).toEqual({
      state: "resume",
      resume: {
        historyId: "history-1",
        previousRunId: "job-1",
        threadId: "thread-1",
        turnId: "job-1",
        hardDeadlineAt: startedAt + 600_000,
      },
    });
    expect(mocks.reap).toHaveBeenCalledWith("job-1");
  });

  it("reports completed response delivery as unknown without replaying the turn", async () => {
    mocks.get.mockResolvedValue({ id: "job-1", status: "completed" });
    const result = await inspectAutomationRecovery(
      resource,
      { ...meta, deliveryDestination: "test-destination" },
      now,
    );
    expect(result).toMatchObject({
      state: "settle",
      status: "error",
      errorCode: "background_automation_delivery_unknown",
    });
    expect(result?.state === "settle" && result.error).toContain(
      "response delivery is unknown",
    );
    expect(result?.state === "settle" && result.error).toContain(
      "send-test-email",
    );
    expect(result?.state === "settle" && result.error).not.toContain(
      "Worker stopped",
    );
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("leaves a worker with a live heartbeat alone", async () => {
    mocks.reap.mockResolvedValue(false);
    mocks.get.mockResolvedValue({ id: "job-1", status: "running" });
    expect(await inspectAutomationRecovery(resource, meta, now)).toEqual({
      state: "active",
    });
  });

  it("settles a completed turn or history without rerunning it after a crash in finalization", async () => {
    mocks.get.mockResolvedValue({ id: "job-1", status: "completed" });
    expect(await inspectAutomationRecovery(resource, meta, now)).toMatchObject({
      state: "settle",
      status: "success",
    });
    mocks.history.mockResolvedValue({
      ...history,
      status: "success",
      finishedAt: now.getTime() - 1000,
    });
    mocks.reap.mockClear();
    expect(await inspectAutomationRecovery(resource, meta, now)).toMatchObject({
      state: "settle",
      status: "success",
    });
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  it("does not confuse a newer queued Run now with the stopped worker", async () => {
    mocks.list.mockResolvedValue([
      {
        ...history,
        id: "queued",
        startedAt: now.getTime() - 1000,
        runId: null,
        threadId: null,
      },
      history,
    ]);
    expect(await inspectAutomationRecovery(resource, meta, now)).toMatchObject({
      state: "resume",
      resume: { historyId: "history-1" },
    });
    expect(mocks.reap).toHaveBeenCalledWith("job-1");
  });

  it("uses the same history owner as a shared job running as its creator", async () => {
    expect(
      await inspectAutomationRecovery(
        { ...resource, owner: "__shared__" },
        {
          ...meta,
          lastHistoryId: undefined,
          createdBy: "creator@example.com",
          runAs: "creator",
        },
        now,
      ),
    ).toMatchObject({ state: "settle" });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ owners: ["creator@example.com"] }),
    );
  });

  it("does not recover history belonging to a previous firing", async () => {
    mocks.list.mockResolvedValue([{ ...history, startedAt: startedAt - 1 }]);
    expect(
      await inspectAutomationRecovery(
        resource,
        { ...meta, lastHistoryId: undefined },
        now,
      ),
    ).toBeNull();
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  it("uses the exact firing even when Run now was queued before lastRun", async () => {
    mocks.history.mockResolvedValue({
      ...history,
      startedAt: startedAt - 30 * 60_000,
    });
    mocks.list.mockResolvedValue([
      {
        ...history,
        id: "newer-worker",
        runId: "other-worker",
        startedAt: now.getTime(),
      },
    ]);
    expect(await inspectAutomationRecovery(resource, meta, now)).toMatchObject({
      state: "resume",
      resume: { historyId: history.id, previousRunId: history.runId },
    });
    expect(mocks.history).toHaveBeenCalledWith(history.id);
    expect(mocks.reap).toHaveBeenCalledWith(history.runId);
  });

  it("rejects a firing history in another app before inspecting its worker", async () => {
    mocks.history.mockResolvedValue({ ...history, appId: "another-app" });
    await expect(
      inspectAutomationRecovery(resource, meta, now, "scheduler-app"),
    ).rejects.toThrow();
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  it("scopes the bounded legacy history lookup to the scheduler app", async () => {
    await inspectAutomationRecovery(
      resource,
      { ...meta, lastHistoryId: undefined },
      now,
      "scheduler-app",
    );
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "scheduler-app", limit: 50 }),
    );
  });

  it("fails closed on ambiguous legacy firing histories", async () => {
    mocks.list.mockResolvedValue([
      history,
      {
        ...history,
        id: "other-firing",
        runId: "other-worker",
        startedAt: startedAt + 1,
      },
    ]);
    await expect(
      inspectAutomationRecovery(
        resource,
        { ...meta, lastHistoryId: undefined },
        now,
      ),
    ).rejects.toThrow();
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  it("bounds crash retries and preserves confirmed deliveries in the terminal error", async () => {
    mocks.count.mockResolvedValue(4);
    const result = await inspectAutomationRecovery(resource, meta, now);
    expect(result).toMatchObject({
      state: "settle",
      history,
      errorCode: "stale_run",
    });
    expect(result?.state === "settle" && result.error).toContain(
      "send-test-email",
    );
    expect(result?.state === "settle" && result.error).not.toContain(
      "No delivery was confirmed",
    );
  });

  it("does not reset the original ten-minute budget on restart", async () => {
    expect(
      await inspectAutomationRecovery(
        resource,
        meta,
        new Date(startedAt + 600_000),
      ),
    ).toMatchObject({ state: "settle" });
  });

  it("keeps confirmed steps inside the persisted terminal error budget", async () => {
    mocks.count.mockResolvedValue(4);
    mocks.get.mockResolvedValue({
      id: "job-1",
      status: "errored",
      errorCode: "stale_run",
      errorDetail: "Long interruption detail ".repeat(40),
    });
    const result = await inspectAutomationRecovery(resource, meta, now);
    expect(result?.state === "settle" && result.error?.slice(0, 500)).toContain(
      "send-test-email",
    );
  });

  it("fails closed when the durable worker record or journal is unreadable", async () => {
    mocks.get.mockResolvedValue(null);
    await expect(
      inspectAutomationRecovery(resource, meta, now),
    ).rejects.toThrow("no durable run record");
    mocks.get.mockResolvedValue({
      id: "job-1",
      status: "errored",
      errorCode: "http_502",
    });
    mocks.events.mockRejectedValue(new Error("database unavailable"));
    await expect(
      inspectAutomationRecovery(resource, meta, now),
    ).rejects.toThrow("database unavailable");
  });

  it("distinguishes confirmed writes, unknown outcomes, failed calls and unreadable evidence", () => {
    expect(automationDeliveryNote("Worker stopped", sent)).toContain(
      "Completed steps confirmed",
    );
    expect(deliveryNoteForEvents([sent[0]!])).toContain("unknown");
    expect(
      deliveryNoteForEvents([{ ...sent[1]!, isError: true } as AgentChatEvent]),
    ).toContain("unknown");
    expect(deliveryNoteForEvents(null)).toContain("could not be read");
    expect(deliveryNoteForEvents(sent, "zh-TW")).toContain("send-test-email");
    expect(deliveryNoteForEvents(sent, "zh-TW")).not.toContain(
      "Completed steps",
    );
  });
});
