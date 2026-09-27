import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(mocks.getAgentTeamRunDispatchState).toHaveBeenCalledTimes(5);
    expect(tasks.find((task) => task.taskId === "task-3")?.status).toBe(
      "queued",
    );
    expect(tasks.find((task) => task.taskId === "task-5")?.status).toBe(
      "queued",
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
