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
      run: { status: "errored", phase: "Scanning" },
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
});

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-code-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
