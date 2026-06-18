import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const tmpRoots: string[] = [];

vi.mock("../application-state/script-helpers.js", () => ({
  readAppState: vi.fn(async (key: string) => appState.get(key) ?? null),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    appState.set(key, value);
  }),
  deleteAppState: vi.fn(async (key: string) => appState.delete(key)),
  listAppState: vi.fn(async (prefix: string) =>
    [...appState.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
  ),
}));

describe("agent teams message queue", () => {
  beforeEach(() => {
    appState.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
    for (const root of tmpRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends task messages instead of overwriting and reports queue depth", async () => {
    const { sendToTask } = await import("./agent-teams.js");
    appState.set("agent-task:task-1", {
      taskId: "task-1",
      threadId: "thread-1",
      description: "do work",
      status: "running",
      preview: "",
      summary: "",
      currentStep: "",
      createdAt: Date.now(),
    });

    const first = await sendToTask("task-1", "first update");
    const second = await sendToTask("task-1", "second update");

    expect(first).toMatchObject({ ok: true, queuedCount: 1 });
    expect(second).toMatchObject({ ok: true, queuedCount: 2 });
    expect(first.messageId).toMatch(/^msg-/);
    expect(second.messageId).toMatch(/^msg-/);
    expect(first.messageId).not.toBe(second.messageId);
    expect(
      [...appState.keys()].filter((key) =>
        key.startsWith("task-message:task-1:"),
      ),
    ).toHaveLength(2);
  }, 15_000);

  it("drains queued messages into the next tool result once", async () => {
    const { sendToTask, _agentTeamsQueueForTests } =
      await import("./agent-teams.js");
    appState.set("agent-task:task-1", {
      taskId: "task-1",
      threadId: "thread-1",
      description: "do work",
      status: "running",
      preview: "",
      summary: "",
      currentStep: "",
      createdAt: Date.now(),
    });
    await sendToTask("task-1", "change direction");

    const actions = _agentTeamsQueueForTests.createMessageAwareActions(
      "task-1",
      {
        "do-work": {
          tool: { description: "Do work", parameters: { type: "object" } },
          run: async () => "tool result",
        },
      },
    );

    await expect(actions["do-work"].run({})).resolves.toContain(
      "change direction",
    );
    await expect(actions["do-work"].run({})).resolves.toBe("tool result");
  });

  it("uses the final response guard to deliver queued messages before completion", async () => {
    const { sendToTask, _agentTeamsQueueForTests } =
      await import("./agent-teams.js");
    appState.set("agent-task:task-1", {
      taskId: "task-1",
      threadId: "thread-1",
      description: "do work",
      status: "running",
      preview: "",
      summary: "",
      currentStep: "",
      createdAt: Date.now(),
    });
    await sendToTask("task-1", "one last constraint");

    const guard =
      _agentTeamsQueueForTests.createTaskMessageFinalGuard("task-1");
    const result = await guard({
      messages: [],
      assistantContent: [],
      text: "done",
      toolCalls: [],
      toolResults: [],
      retryCount: 0,
    });

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("one last constraint"),
    });
    await expect(
      _agentTeamsQueueForTests.drainQueuedTaskMessages("task-1"),
    ).resolves.toEqual([]);
  });

  it("maps aborted and errored child runs to non-success task outcomes", async () => {
    const { _agentTeamsQueueForTests } = await import("./agent-teams.js");

    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "aborted", abortReason: "user" },
        "",
      ),
    ).toMatchObject({
      taskStatus: "errored",
      progressStatus: "cancelled",
      summary: "Task stopped.",
    });
    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "errored" },
        "partial failure detail",
      ),
    ).toMatchObject({
      taskStatus: "errored",
      progressStatus: "failed",
      summary: "partial failure detail",
    });
    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "completed" },
        "finished",
      ),
    ).toMatchObject({
      taskStatus: "completed",
      progressStatus: "succeeded",
      summary: "finished",
    });
  });

  it("preserves long sub-agent output up to 50 000 chars without truncation", async () => {
    const { _agentTeamsQueueForTests } = await import("./agent-teams.js");

    // A result shorter than the cap must round-trip verbatim.
    const short = "A".repeat(10_000);
    const shortResult = _agentTeamsQueueForTests.resolveTaskCompletion(
      { status: "completed" },
      short,
    );
    expect(shortResult.summary).toBe(short);
    expect(shortResult.summary.length).toBe(10_000);

    // A result exactly at the cap must round-trip verbatim.
    const atCap = "B".repeat(50_000);
    expect(
      _agentTeamsQueueForTests.resolveTaskCompletion(
        { status: "completed" },
        atCap,
      ).summary,
    ).toBe(atCap);

    // A result exceeding the cap gets the tail (last 50 000 chars).
    const overCap = "X".repeat(10_000) + "Y".repeat(50_000);
    const overResult = _agentTeamsQueueForTests.resolveTaskCompletion(
      { status: "completed" },
      overCap,
    );
    expect(overResult.summary.length).toBe(50_000);
    expect(overResult.summary).toBe("Y".repeat(50_000));
  });

  it("marks the summary with [hit-continuation-limit] when the absolute cap fires", async () => {
    const { _agentTeamsQueueForTests } = await import("./agent-teams.js");

    const result = _agentTeamsQueueForTests.resolveTaskCompletion(
      { status: "completed" },
      "partial output",
      { hitContinuationLimit: true },
    );
    expect(result.summary).toContain("[hit-continuation-limit]");
    expect(result.summary).toContain("partial output");
    expect(result.taskStatus).toBe("completed");
  });

  it("maps tasks into the shared background run vocabulary", async () => {
    const {
      getAgentTeamBackgroundRun,
      listAgentTeamBackgroundRuns,
      toAgentTaskBackgroundRun,
    } = await import("./agent-teams.js");
    const task = {
      taskId: "task-1",
      threadId: "thread-1",
      description: "Review the launch plan",
      status: "running" as const,
      preview: "Checking milestones",
      summary: "",
      currentStep: "Reading docs",
      createdAt: Date.parse("2026-05-16T10:00:00.000Z"),
    };
    appState.set("agent-task:task-1", task);

    expect(toAgentTaskBackgroundRun(task)).toMatchObject({
      schemaVersion: 1,
      id: "run-task-task-1",
      kind: "agent-team",
      source: "hosted-agent-team",
      sourceLabel: "Agent Teams",
      sourceRecord: {
        type: "agent-team-task",
        id: "task-1",
        threadId: "thread-1",
      },
      title: "Review the launch plan",
      subtitle: "Reading docs",
      status: "running",
      phase: "Reading docs",
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      goalId: "agent-team",
      needsInput: false,
      needsApproval: false,
      surfaceUrl: "agent-native://threads/thread-1",
      metadata: {
        taskId: "task-1",
        threadId: "thread-1",
        latestText: "Checking milestones",
      },
    });
    await expect(listAgentTeamBackgroundRuns()).resolves.toMatchObject([
      { id: "run-task-task-1", kind: "agent-team" },
    ]);
    await expect(
      getAgentTeamBackgroundRun("run-task-task-1"),
    ).resolves.toMatchObject({
      id: "run-task-task-1",
      sourceRecord: { id: "task-1" },
    });
    await expect(getAgentTeamBackgroundRun("missing")).resolves.toBeNull();
  });

  it("maps task run events into shared background transcript events", async () => {
    const { toAgentTaskBackgroundTranscriptEvent } =
      await import("./agent-teams.js");

    expect(
      toAgentTaskBackgroundTranscriptEvent("run-task-task-1", {
        seq: 7,
        event: { type: "text", text: "Reviewed the launch plan." },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      id: "run-task-task-1:7",
      runId: "run-task-task-1",
      kind: "note",
      source: "hosted-agent-team",
      sourceRecord: {
        type: "agent-team-run-event",
        id: "run-task-task-1:7",
        seq: 7,
      },
      message: "Reviewed the launch plan.",
      metadata: { seq: 7, sourceSeq: 7 },
    });

    expect(
      toAgentTaskBackgroundTranscriptEvent(
        "run-task-task-1",
        {
          seq: 2,
          event: { type: "text", text: "Continued in the next chunk." },
        },
        { seq: 12, sourceRunId: "run-task-task-1-c1" },
      ),
    ).toMatchObject({
      id: "run-task-task-1-c1:2",
      runId: "run-task-task-1",
      sourceRecord: {
        type: "agent-team-run-event",
        id: "run-task-task-1-c1:2",
        seq: 12,
      },
      metadata: {
        seq: 12,
        sourceSeq: 2,
        sourceRunId: "run-task-task-1-c1",
      },
    });

    expect(
      toAgentTaskBackgroundTranscriptEvent("run-task-task-1", {
        seq: 8,
        event: { type: "clear" },
      }),
    ).toBeNull();
  });

  it("sends background-run follow-ups through the existing task queue", async () => {
    const { sendToAgentTeamBackgroundRun } = await import("./agent-teams.js");
    appState.set("agent-task:task-1", {
      taskId: "task-1",
      threadId: "thread-1",
      description: "do work",
      status: "running",
      preview: "",
      summary: "",
      currentStep: "",
      createdAt: Date.now(),
    });

    const result = await sendToAgentTeamBackgroundRun(
      "run-task-task-1",
      "use the newer brief",
    );

    expect(result).toMatchObject({ ok: true, queuedCount: 1 });
    expect(
      [...appState.values()].some(
        (value) => value.message === "use the newer brief",
      ),
    ).toBe(true);
  });

  it("exposes Agent Teams through the shared background controller interface", async () => {
    const { createAgentTeamBackgroundAgentController } =
      await import("./agent-teams.js");
    appState.set("agent-task:task-1", {
      taskId: "task-1",
      threadId: "thread-1",
      description: "review docs",
      status: "running",
      preview: "reading",
      summary: "",
      currentStep: "Scanning",
      createdAt: Date.parse("2026-05-16T10:00:00.000Z"),
    });

    const controller = createAgentTeamBackgroundAgentController();

    await expect(
      Promise.resolve(controller.list({ goalId: "agent-team" })),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "run-task-task-1",
        kind: "agent-team",
        source: "hosted-agent-team",
      }),
    ]);
    await expect(
      controller.sendFollowUp({
        runId: "run-task-task-1",
        prompt: "use the updated brief",
      }),
    ).resolves.toMatchObject({
      ok: true,
      queued: true,
      run: { id: "run-task-task-1" },
    });
    await expect(
      controller.control({ runId: "run-task-task-1", command: "stop" }),
    ).resolves.toMatchObject({
      ok: true,
      run: { status: "errored", phase: "Task stopped." },
    });
  });

  it("preserves source labels when local Code and Agent Teams runs are mixed", async () => {
    const {
      createCodeAgentRunRecord,
      createCompositeBackgroundAgentController,
      createLocalCodeBackgroundAgentController,
    } = await import("../code-agents/index.js");
    const { createAgentTeamBackgroundAgentController } =
      await import("./agent-teams.js");
    useTempCodeAgentsHome();
    const localRun = createCodeAgentRunRecord({
      goalId: "task",
      title: "Fix auth tests",
      status: "paused",
      phase: "review",
      cwd: "/repo",
    });
    appState.set("agent-task:task-1", {
      taskId: "task-1",
      threadId: "thread-1",
      description: "Review the launch plan",
      status: "running",
      preview: "Checking milestones",
      summary: "",
      currentStep: "Reading docs",
      createdAt: Date.parse("2026-05-16T10:00:00.000Z"),
    });

    const controller = createCompositeBackgroundAgentController([
      createLocalCodeBackgroundAgentController(),
      createAgentTeamBackgroundAgentController(),
    ]);

    await expect(Promise.resolve(controller.list())).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: localRun.id,
          kind: "code",
          source: "local-code",
          sourceLabel: "Local Code",
        }),
        expect.objectContaining({
          id: "run-task-task-1",
          kind: "agent-team",
          source: "hosted-agent-team",
          sourceLabel: "Agent Teams",
        }),
      ]),
    );
    await expect(Promise.resolve(controller.get(localRun.id))).resolves.toEqual(
      expect.objectContaining({
        id: localRun.id,
        sourceLabel: "Local Code",
      }),
    );
    await expect(
      Promise.resolve(controller.get("run-task-task-1")),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-task-task-1",
        sourceLabel: "Agent Teams",
      }),
    );
  });
  // ── Completion loop injection ────────────────────────────────────────────

  it("appends a parent-completion injection when parentThreadId is set", async () => {
    const {
      drainParentCompletionInjections,
      formatParentCompletionInjections,
    } = await import("./agent-teams.js");

    // Pre-populate the app state with a completion injection (simulates what
    // finalizeAgentTeamRun writes internally via appendParentCompletionInjection).
    const injKey = "parent-completion:parent-thread-1:inj-test-001";
    appState.set(injKey, {
      id: "inj-test-001",
      taskId: "task-sub-1",
      taskName: "Research task",
      status: "completed",
      hitContinuationLimit: false,
      summaryExcerpt: "Found 10 results.",
      fullSummaryAvailable: false,
      timestamp: Date.now(),
    });

    const injections = await drainParentCompletionInjections("parent-thread-1");

    expect(injections).toHaveLength(1);
    expect(injections[0]).toMatchObject({
      taskId: "task-sub-1",
      taskName: "Research task",
      status: "completed",
      summaryExcerpt: "Found 10 results.",
    });
    // Consumed — second drain is empty
    await expect(
      drainParentCompletionInjections("parent-thread-1"),
    ).resolves.toEqual([]);

    const formatted = formatParentCompletionInjections(injections);
    expect(formatted).toContain("Research task");
    expect(formatted).toContain("Found 10 results.");
    expect(formatted).toContain("completed");
  });

  it("formats completion injections with a pointer for long summaries", async () => {
    const {
      drainParentCompletionInjections,
      formatParentCompletionInjections,
    } = await import("./agent-teams.js");

    const injKey = "parent-completion:parent-thread-2:inj-long-001";
    appState.set(injKey, {
      id: "inj-long-001",
      taskId: "task-big",
      taskName: "Big analysis",
      status: "completed",
      hitContinuationLimit: false,
      summaryExcerpt: "A".repeat(2000),
      fullSummaryAvailable: true,
      timestamp: Date.now(),
    });

    const injections = await drainParentCompletionInjections("parent-thread-2");
    const formatted = formatParentCompletionInjections(injections);

    expect(formatted).toContain("read-result");
    expect(formatted).toContain("task-big");
  });

  it("formats hit-continuation-limit completions with a descriptive label", async () => {
    const {
      drainParentCompletionInjections,
      formatParentCompletionInjections,
    } = await import("./agent-teams.js");

    const injKey = "parent-completion:parent-thread-3:inj-limit-001";
    appState.set(injKey, {
      id: "inj-limit-001",
      taskId: "task-limited",
      status: "completed",
      hitContinuationLimit: true,
      summaryExcerpt: "Partial work done.",
      fullSummaryAvailable: false,
      timestamp: Date.now(),
    });

    const injections = await drainParentCompletionInjections("parent-thread-3");
    const formatted = formatParentCompletionInjections(injections);

    expect(formatted).toContain("continuation limit");
  });

  it("drains multiple injections in timestamp order", async () => {
    const { drainParentCompletionInjections } =
      await import("./agent-teams.js");

    const now = Date.now();
    appState.set("parent-completion:parent-thread-4:inj-b", {
      id: "inj-b",
      taskId: "task-b",
      status: "completed",
      hitContinuationLimit: false,
      summaryExcerpt: "B done",
      fullSummaryAvailable: false,
      timestamp: now + 100,
    });
    appState.set("parent-completion:parent-thread-4:inj-a", {
      id: "inj-a",
      taskId: "task-a",
      status: "errored",
      hitContinuationLimit: false,
      summaryExcerpt: "A failed",
      fullSummaryAvailable: false,
      timestamp: now,
    });

    const injections = await drainParentCompletionInjections("parent-thread-4");
    expect(injections.map((i) => i.taskId)).toEqual(["task-a", "task-b"]);
  });
});

describe("getCurrentDelegationDepth", () => {
  it("returns 0 outside any delegation scope (top-level chat)", async () => {
    const { getCurrentDelegationDepth } = await import("./agent-teams.js");
    expect(getCurrentDelegationDepth()).toBe(0);
  });

  it("reflects the ambient depth set by runWithDelegationDepth", async () => {
    const { getCurrentDelegationDepth, _agentTeamsQueueForTests } =
      await import("./agent-teams.js");
    const { runWithDelegationDepth } = _agentTeamsQueueForTests;

    const seen: number[] = [];
    await runWithDelegationDepth(2, async () => {
      seen.push(getCurrentDelegationDepth());
      await runWithDelegationDepth(3, async () => {
        seen.push(getCurrentDelegationDepth());
      });
      seen.push(getCurrentDelegationDepth());
    });
    // Back outside the scope it is 0 again.
    seen.push(getCurrentDelegationDepth());

    expect(seen).toEqual([2, 3, 2, 0]);
  });
});

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-code-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
