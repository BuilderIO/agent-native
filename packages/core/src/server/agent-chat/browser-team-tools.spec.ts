import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEngine } from "../../agent/engine/types.js";
import {
  actionsToEngineTools,
  runAgentLoop,
} from "../../agent/production-agent.js";
import { runWithRequestContext } from "../request-context.js";
import {
  createBuilderBrowserTool,
  createTeamTools,
} from "./browser-team-tools.js";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getBuilderCredentialAuthFailure: vi.fn(),
  getBuilderBrowserConnectUrlForOwner: vi.fn(),
  getAgentTeamRunDispatchState: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  resolveBuilderBranchProjectId: vi.fn(),
  resolveBuilderCredentials: vi.fn(),
}));

vi.mock("../../sharing/access.js", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../builder-browser.js", () => ({
  getBuilderBrowserConnectUrlForOwner:
    mocks.getBuilderBrowserConnectUrlForOwner,
  resolveBuilderBranchProjectId: mocks.resolveBuilderBranchProjectId,
}));

vi.mock("../credential-provider.js", () => ({
  getBuilderCredentialAuthFailure: mocks.getBuilderCredentialAuthFailure,
  resolveBuilderCredentials: mocks.resolveBuilderCredentials,
}));

vi.mock("../agent-teams.js", () => ({
  getTask: mocks.getTask,
  listTasks: mocks.listTasks,
}));

vi.mock("../agent-teams-run-queue.js", () => ({
  getAgentTeamRunDispatchState: mocks.getAgentTeamRunDispatchState,
}));

const extension = {
  id: "ext-1",
  name: "Revenue cohorts",
  description: "A custom cohort visualization",
  content:
    '<section x-data="{ note: `keep ``` complete` }">Revenue cohorts</section>',
  updatedAt: "2026-07-29T12:00:00.000Z",
  archivedAt: null,
};

describe("createBuilderBrowserTool extension promotion", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.getBuilderCredentialAuthFailure.mockReset();
    mocks.getBuilderBrowserConnectUrlForOwner.mockReset();
    mocks.resolveBuilderBranchProjectId.mockReset();
    mocks.resolveBuilderCredentials.mockReset();

    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: extension,
    });
    mocks.getBuilderCredentialAuthFailure.mockResolvedValue(null);
    mocks.getBuilderBrowserConnectUrlForOwner.mockReturnValue(
      "https://builder.example.test/connect",
    );
    mocks.resolveBuilderBranchProjectId.mockResolvedValue("project-1");
    mocks.resolveBuilderCredentials.mockResolvedValue({
      privateKey: "private-test-key",
      publicKey: "public-test-key",
      orgName: "Test org",
    });
  });

  async function runConnectBuilder(args: Record<string, unknown>) {
    const entry = createBuilderBrowserTool({
      getOrigin: () => "https://app.example.test",
      getOwner: () => "owner@example.test",
    })["connect-builder"];
    return JSON.parse(await entry.run(args));
  }

  it("loads the authoritative SQL artifact with editor access", async () => {
    const result = await runConnectBuilder({
      prompt: "Promote this custom block to app code.",
      extensionId: "ext-1",
      content: "<p>client-supplied content must be ignored</p>",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "extension",
      "ext-1",
      "editor",
    );
    expect(result.prompt).toContain(extension.content);
    expect(result.prompt).not.toContain("client-supplied content");
    expect(result.prompt).toContain(
      "Do not modify, archive, delete, or replace it",
    );
    expect(result.promotion).toEqual({
      extensionId: "ext-1",
      contentLength: extension.content.length,
      contentSha256: createHash("sha256")
        .update(extension.content)
        .digest("hex"),
    });
    expect(result.prompt).toContain(
      `End of complete server-verified artifact ext-1 (sha256: ${result.promotion.contentSha256}).`,
    );
  });

  it("fails instead of handing off an artifact without editor access", async () => {
    mocks.assertAccess.mockRejectedValue(
      new Error("Requires editor role on extension ext-1 (have viewer)"),
    );

    await expect(
      runConnectBuilder({
        prompt: "Promote this custom block to app code.",
        extensionId: "ext-1",
      }),
    ).rejects.toThrow("Requires editor role");
  });

  it("fails loudly instead of truncating oversized extension content", async () => {
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: {
        ...extension,
        content: "x".repeat(200_001),
      },
    });

    await expect(
      runConnectBuilder({
        prompt: "Promote this custom block to app code.",
        extensionId: "ext-1",
      }),
    ).rejects.toThrow(
      "promotion supports at most 200,000 characters. No extension content was sent.",
    );
  });

  it("keeps private extension source out of the waitlist fallback prompt", async () => {
    mocks.resolveBuilderBranchProjectId.mockResolvedValue(null);

    const result = await runConnectBuilder({
      prompt: "Promote this custom block to app code.",
      extensionId: "ext-1",
    });

    expect(result.builderEnabled).toBe(false);
    expect(result.prompt).toBe("Promote this custom block to app code.");
    expect(result.prompt).not.toContain(extension.content);
    expect(result.promotion).toEqual({
      extensionId: "ext-1",
      contentLength: extension.content.length,
    });
  });
});

describe("connect-builder source-change handoff", () => {
  beforeEach(() => {
    mocks.getBuilderCredentialAuthFailure.mockResolvedValue(null);
    mocks.getBuilderBrowserConnectUrlForOwner.mockReturnValue(
      "https://builder.example.test/connect",
    );
    mocks.resolveBuilderBranchProjectId.mockResolvedValue("project-1");
    mocks.resolveBuilderCredentials.mockResolvedValue({
      privateKey: "private-test-key",
      publicKey: "public-test-key",
      orgName: "Test org",
    });
  });

  async function runConnectBuilder(prompt: string) {
    const entry = createBuilderBrowserTool({
      getOrigin: () => "https://app.example.test",
      getOwner: () => "owner@example.test",
    })["connect-builder"];
    return JSON.parse(await entry.run({ prompt }));
  }

  it("renders a project-backed card with the user's source-change prompt", async () => {
    const prompt = "Fix the app's broken handoff.";

    await expect(runConnectBuilder(prompt)).resolves.toMatchObject({
      kind: "connect-builder-card",
      builderEnabled: true,
      prompt,
    });
  });

  it("keeps the card honest when the credential store reports a failure", async () => {
    mocks.getBuilderCredentialAuthFailure.mockResolvedValue(
      "credential-store-unavailable",
    );

    await expect(
      runConnectBuilder("Fix the app's broken handoff."),
    ).resolves.toMatchObject({
      kind: "connect-builder-card",
      configured: false,
      builderEnabled: true,
    });
  });
});

describe("createTeamTools Plan-mode effects", () => {
  it("allows task observation but blocks delegation and messages", () => {
    const entry = createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as any,
      getModel: () => "test-model",
      getParentThreadId: () => "thread-1",
      getSend: () => null,
    })["agent-teams"];
    const effect = entry.planMode?.effect;
    expect(typeof effect).toBe("function");
    if (typeof effect !== "function") throw new Error("Missing classifier");

    expect(effect({ action: "status" })).toBe("read");
    expect(effect({ action: "read-result" })).toBe("read");
    expect(effect({ action: "list" })).toBe("read");
    expect(effect({ action: "spawn" })).toBe("write");
    expect(effect({ action: "send" })).toBe("write");
  });
});

describe("createTeamTools bounded task reads", () => {
  const task = {
    taskId: "task-1",
    threadId: "child-1",
    parentThreadId: "parent-1",
    status: "running",
    description: "Review email",
    summary: "",
    preview: "Inspecting",
  };
  function teamTool() {
    return createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as AgentEngine,
      getModel: () => "test-model",
      getParentThreadId: () => "parent-1",
      getSend: () => null,
    })["agent-teams"];
  }
  beforeEach(() => {
    mocks.getTask.mockReset().mockResolvedValue(task);
    mocks.getAgentTeamRunDispatchState.mockReset().mockResolvedValue(null);
  });
  afterEach(() => {
    mocks.getTask.mockReset();
    mocks.getAgentTeamRunDispatchState.mockReset();
  });

  it("waits for a terminal result and keeps every read in the caller's scope", async () => {
    mocks.getTask.mockResolvedValueOnce(task).mockResolvedValue({
      ...task,
      status: "completed",
      summary: "Reviewed unchanged hash; no issues.",
    });
    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () =>
        teamTool().run({
          action: "read-result",
          taskId: "task-1",
          waitMs: 1000,
        }),
    );
    expect(JSON.parse(result)).toMatchObject({
      status: "completed",
      summary: "Reviewed unchanged hash; no issues.",
    });
    expect(mocks.getTask.mock.calls).toEqual([
      ["task-1", { ownerEmail: "owner@example.test", orgId: "org-1" }],
      ["task-1", { ownerEmail: "owner@example.test", orgId: "org-1" }],
    ]);
  });

  it("returns an honest queued snapshot when the wait expires", async () => {
    mocks.getAgentTeamRunDispatchState.mockResolvedValue({ status: "queued" });
    const result = JSON.parse(
      await teamTool().run({
        action: "read-result",
        taskId: "task-1",
        waitMs: 20,
      }),
    );
    expect(result).toMatchObject({ status: "queued", taskId: "task-1" });
    expect(result).not.toHaveProperty("summary");
    expect(mocks.getTask.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not wait or expose queue state for a foreign or missing task", async () => {
    mocks.getTask.mockResolvedValue(undefined);
    expect(
      JSON.parse(
        await teamTool().run({
          action: "status",
          taskId: "foreign",
          waitMs: 20000,
        }),
      ),
    ).toEqual({ error: "Task not found" });
    expect(mocks.getTask).toHaveBeenCalledTimes(1);
    expect(mocks.getAgentTeamRunDispatchState).not.toHaveBeenCalled();
  });

  it("preserves an explicit personal scope instead of falling back to the ambient organization", async () => {
    mocks.getTask.mockResolvedValue(undefined);
    await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () =>
        teamTool().run(
          { action: "status", taskId: "task-1" },
          { caller: "agent", orgId: null },
        ),
    );
    expect(mocks.getTask).toHaveBeenCalledWith("task-1", {
      ownerEmail: "owner@example.test",
      orgId: null,
    });
  });

  it("aborts an active wait without another task read", async () => {
    const controller = new AbortController();
    const waiting = teamTool().run(
      { action: "status", taskId: "task-1", waitMs: 1000 },
      { caller: "agent", signal: controller.signal },
    );
    const outcome = waiting.then(
      () => null,
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await outcome).toBeInstanceOf(Error);
    expect(mocks.getTask).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 20001, 1.5, "1000"])(
    "rejects invalid wait bounds (%s)",
    async (waitMs) => {
      await expect(
        teamTool().run({ action: "status", taskId: "task-1", waitMs }),
      ).rejects.toThrow("waitMs");
      expect(mocks.getTask).not.toHaveBeenCalled();
    },
  );

  it("observes changed task status across identical bounded waits in one agent turn", async () => {
    let calls = 0;
    mocks.getTask.mockImplementation(async () =>
      calls < 10 ? task : { ...task, status: "completed", summary: "Clear" },
    );
    const entry = teamTool();
    const observed: string[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      async *stream(opts) {
        const last = opts.messages[opts.messages.length - 1];
        for (const part of last?.content ?? [])
          if (part.type === "tool-result") observed.push(part.content);
        if (++calls <= 10) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: `status-${calls}`,
                name: "agent-teams",
                input: { action: "status", taskId: "task-1", waitMs: 1 },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
        } else {
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "Review complete." }],
          };
          yield { type: "stop", reason: "end_turn" };
        }
      },
    };
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "Observe task state",
      tools: actionsToEngineTools({ "agent-teams": entry }),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Wait until the task completes" }],
        },
      ],
      actions: { "agent-teams": entry },
      send: () => {},
      signal: new AbortController().signal,
    });
    expect(mocks.getTask.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(observed.map((content) => JSON.parse(content).status)).toEqual([
      ...Array(9).fill("running"),
      "completed",
    ]);
  });
});

describe("createTeamTools progress cards", () => {
  it("projects only task progress results from visible coordination actions", async () => {
    const entry = createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as any,
      getModel: () => "test-model",
      getParentThreadId: () => "thread-1",
      getSend: () => null,
    })["agent-teams"];
    const result = JSON.stringify([
      {
        taskId: "task-1",
        threadId: "thread-1",
        description: "Compare signups",
        status: "completed",
      },
      {
        taskId: "task-2",
        threadId: "thread-2",
        name: "Find launch feedback",
        description: "Review recent launch feedback",
        status: "running",
        currentStep: "Reading recent mail",
      },
      {
        taskId: "task-3",
        threadId: "thread-3",
        description: "Draft Monday update",
        status: "queued",
      },
    ]);
    const chatUI = entry.chatUI;

    expect(chatUI?.renderer).toBe("core.agent-team-progress");
    expect(chatUI?.when?.({ action: "list" }, result)).toBe(true);
    expect(chatUI?.when?.({ action: "spawn" }, result)).toBe(false);
    expect(chatUI?.when?.({ action: "send" }, result)).toBe(false);
    expect(chatUI?.when?.({ action: "read-result" }, result)).toBe(false);
    expect(chatUI?.when?.({ action: "list" }, "No background tasks.")).toBe(
      false,
    );
    expect(chatUI?.projectResult?.({ action: "list" }, result)).toEqual({
      tasks: [
        {
          taskId: "task-1",
          threadId: "thread-1",
          title: "Compare signups",
          status: "completed",
        },
        {
          taskId: "task-2",
          threadId: "thread-2",
          title: "Find launch feedback",
          detail: "Reading recent mail",
          status: "running",
        },
        {
          taskId: "task-3",
          threadId: "thread-3",
          title: "Draft Monday update",
          status: "queued",
        },
      ],
    });

    mocks.getTask.mockResolvedValue({
      taskId: "task-2",
      threadId: "thread-2",
      parentThreadId: "thread-1",
      name: "Find launch feedback",
      status: "completed",
      summary: "Full requested findings from the completed task.",
      preview: "Preview of the findings.",
    });
    const readResult = await entry.run({
      action: "read-result",
      taskId: "task-2",
    });

    expect(JSON.parse(readResult as string)).toMatchObject({
      summary: "Full requested findings from the completed task.",
    });
    expect(chatUI?.when?.({ action: "read-result" }, readResult)).toBe(false);
  });

  it("reconciles large lists and caps the card with an overflow count", async () => {
    mocks.listTasks.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        taskId: `task-${index + 1}`,
        threadId: `thread-${index + 1}`,
        name: `Task ${index + 1}`,
        description: `Task description ${index + 1}`,
        status: "running",
        currentStep: `Step ${index + 1}`,
        summary: "",
      })),
    );
    mocks.getAgentTeamRunDispatchState.mockImplementation(
      async (taskId: string) =>
        taskId === "task-3" || taskId === "task-5"
          ? { status: "queued" }
          : null,
    );

    const entry = createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as any,
      getModel: () => "test-model",
      getParentThreadId: () => "thread-parent",
      getSend: () => null,
    })["agent-teams"];
    const rawResult = await entry.run({ action: "list" });
    const tasks = JSON.parse(rawResult as string) as Array<{
      taskId: string;
      status: string;
    }>;
    const chatUI = entry.chatUI;

    expect(mocks.listTasks).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(5);
    expect(mocks.getAgentTeamRunDispatchState).toHaveBeenCalledTimes(3);
    expect(tasks.find((task) => task.taskId === "task-3")?.status).toBe(
      "queued",
    );
    expect(tasks.find((task) => task.taskId === "task-5")?.status).toBe(
      "running",
    );
    expect(chatUI?.when?.({ action: "list" }, rawResult)).toBe(true);
    expect(chatUI?.projectResult?.({ action: "list" }, rawResult)).toEqual({
      tasks: [
        {
          taskId: "task-1",
          threadId: "thread-1",
          title: "Task 1",
          detail: "Step 1",
          status: "running",
        },
        {
          taskId: "task-2",
          threadId: "thread-2",
          title: "Task 2",
          detail: "Step 2",
          status: "running",
        },
        {
          taskId: "task-3",
          threadId: "thread-3",
          title: "Task 3",
          detail: "Step 3 · … +2",
          status: "queued",
        },
      ],
    });
  });

  it("keeps the overflow count when the last visible task step is long", async () => {
    const entry = createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as any,
      getModel: () => "test-model",
      getParentThreadId: () => "thread-parent",
      getSend: () => null,
    })["agent-teams"];
    const result = JSON.stringify({
      tasks: Array.from({ length: 4 }, (_, index) => ({
        taskId: `task-${index + 1}`,
        threadId: `thread-${index + 1}`,
        title: `Task ${index + 1}`,
        currentStep: index === 2 ? "x".repeat(300) : `Step ${index + 1}`,
        status: "running",
      })),
    });

    const projected = entry.chatUI?.projectResult?.({ action: "list" }, result);
    const tasks = (projected as { tasks: Array<{ detail?: string }> }).tasks;

    expect(tasks).toHaveLength(3);
    expect(tasks[2]?.detail).toHaveLength(240);
    expect(tasks[2]?.detail).toMatch(/… \+1$/);
  });

  it("fails the list when queue status is unreadable", async () => {
    mocks.listTasks.mockResolvedValue([
      {
        taskId: "task-1",
        threadId: "thread-1",
        name: "Task 1",
        description: "Task description",
        status: "running",
        currentStep: "Working",
        summary: "",
      },
    ]);
    mocks.getAgentTeamRunDispatchState.mockRejectedValue(
      new Error("Queue status unavailable"),
    );

    const entry = createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as any,
      getModel: () => "test-model",
      getParentThreadId: () => "thread-parent",
      getSend: () => null,
    })["agent-teams"];

    await expect(entry.run({ action: "list" })).rejects.toThrow(
      "Queue status unavailable",
    );
  });
});
