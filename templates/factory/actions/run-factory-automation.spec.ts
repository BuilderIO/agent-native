import { beforeEach, describe, expect, it, vi } from "vitest";

const findFactoryAutomationDefinitionMock = vi.hoisted(() => vi.fn());
const queueAutomationRunNowMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/triggers", () => ({
  queueAutomationRunNow: queueAutomationRunNowMock,
}));

vi.mock("../server/lib/factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findFactoryAutomationDefinitionMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

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
