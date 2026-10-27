import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithoutExecutionFence } from "../../../packages/core/src/agent/execution-fence.js";
import { executeAgentToolCall } from "../../../packages/core/src/agent/production-agent.js";
import { withMigrationRuntime } from "../../../packages/core/src/db/migrations.js";
import { settingsStore } from "../../../packages/core/src/settings/store.js";

const findFactoryAutomationDefinitionMock = vi.hoisted(() => vi.fn());
const queueAutomationRunNowMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), {
      actionContractError: true,
      ...options,
    });
  },
}));

vi.mock("../../../packages/core/dist/jobs/run-now.js", () => ({
  queueAutomationRunNow: queueAutomationRunNowMock,
}));

vi.mock("../server/lib/factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findFactoryAutomationDefinitionMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

beforeAll(async () => {
  await import("./run-factory-automation.js");
  await withMigrationRuntime(() => settingsStore.ready());
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "teammate@example.com",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "teammate@example.com",
    orgId: "org-1",
  });
  queueAutomationRunNowMock.mockResolvedValue({ runId: "run-1" });
});

describe("run-factory-automation", () => {
  const input = { factoryId: "demo-factory", automationId: "resource-peer" };
  const definition = {
    name: "factories/demo-factory/peer-job",
    resource: {
      id: "resource-peer",
      path: "jobs/factories/demo-factory/peer-job.md",
    },
    meta: { enabled: true, createdBy: "peer@example.com" },
  };

  it.each(["mcp", "a2a"] as const)(
    "requires exact approval for tool over %s and queues the selected peer job once",
    async (networkProtocol) => {
      findFactoryAutomationDefinitionMock.mockResolvedValue(definition);
      const { default: action } = await import("./run-factory-automation.js");
      const call = (args = input, approvedToolCalls?: string[]) =>
        runWithoutExecutionFence(() =>
          executeAgentToolCall({
            // Exercise the invocation gate after action selection; discovery remains UI-only.
            actions: {
              "run-factory-automation": { ...action, agentTool: true },
            },
            name: "run-factory-automation",
            callId: "run-factory",
            input: args,
            caller: "tool",
            networkProtocol,
            ownerEmail: "teammate@example.com",
            approvedToolCalls,
            consumeApproval: async () => true,
          }),
        );
      const paused = await call();
      expect(paused.status).toBe("approval_required");
      expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
      if (paused.status !== "approval_required")
        throw new Error("Missing approval");
      expect(
        (
          await call({ ...input, automationId: "another-job" }, [
            paused.approvalKey,
          ])
        ).status,
      ).toBe("approval_required");
      expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
      expect((await call(input, [paused.approvalKey])).status).toBe(
        "completed",
      );
      expect(findFactoryAutomationDefinitionMock).toHaveBeenCalledOnce();
      expect(queueAutomationRunNowMock).toHaveBeenCalledExactlyOnceWith({
        userEmail: "teammate@example.com",
        orgId: "org-1",
        appId: "factory",
        resourceId: undefined,
        scope: "organization",
        path: definition.resource.path,
        requestHeaders: undefined,
      });
    },
  );

  it.each([
    { caller: "automation" as const },
    {
      caller: "tool" as const,
      automation: { name: "parent", path: "jobs/parent.md" },
    },
  ])("rejects automation chaining before queueing for %o", async (origin) => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(definition);
    const { default: action } = await import("./run-factory-automation.js");
    await expect(
      action.run(input, {
        userEmail: "teammate@example.com",
        ...origin,
      } as never),
    ).rejects.toThrow(/automation/i);
    expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
  });

  it.each(["frontend", "tool"] as const)(
    "allows an ordinary %s run",
    async (caller) => {
      findFactoryAutomationDefinitionMock.mockResolvedValue(definition);
      const { default: action } = await import("./run-factory-automation.js");
      if (typeof action.needsApproval !== "function")
        throw new Error("Missing approval gate");
      expect(await action.needsApproval(input, { caller } as never)).toBe(
        false,
      );
      await expect(
        action.run(input, { caller, userEmail: "teammate@example.com" }),
      ).resolves.toEqual({ runId: "run-1" });
      expect(queueAutomationRunNowMock).toHaveBeenCalledOnce();
    },
  );

  it("queues a factory-folder job that lost domain and triggerType", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/demo-factory/factory-slack-feedback",
      body: "Observe Slack.",
      resource: {
        id: "resource-slim",
        owner: "__organization__:org-1",
        path: "jobs/factories/demo-factory/factory-slack-feedback.md",
        content: "---\nenabled: true\n---\nObserve Slack.\n",
      },
      meta: { enabled: true },
    });

    const { default: action } = await import("./run-factory-automation.js");
    const result = await action.run(
      { factoryId: "demo-factory", automationId: "resource-slim" },
      { userEmail: "teammate@example.com" },
    );

    expect(result).toEqual({ runId: "run-1" });
    expect(queueAutomationRunNowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "jobs/factories/demo-factory/factory-slack-feedback.md",
        appId: "factory",
      }),
    );
  });

  it("will not run a workflow's job outside run-factory-workflow", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/demo-factory/workflow-digest-1a2b3c4d",
      body: "Placeholder.",
      resource: {
        id: "resource-wf",
        owner: "__organization__:org-1",
        path: "jobs/factories/demo-factory/workflow-digest-1a2b3c4d.md",
        content: "---\nenabled: false\nrunner: workflow\n---\nPlaceholder.\n",
      },
      meta: { enabled: false, runner: "workflow" },
    });

    const { default: action } = await import("./run-factory-automation.js");
    await expect(
      action.run(
        { factoryId: "demo-factory", automationId: "resource-wf" },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toMatchObject({
      errorCode: "use_run_factory_workflow",
      statusCode: 409,
    });
    expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
  });

  it("rejects an id that is not in the factory folder", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(null);
    const { default: action } = await import("./run-factory-automation.js");
    await expect(
      action.run(
        { factoryId: "demo-factory", automationId: "missing" },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toThrow("Factory automation not found.");
  });
});
