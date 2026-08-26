import { beforeEach, describe, expect, it, vi } from "vitest";

const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const listAutomationRunsMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: listAutomationDefinitionsMock,
  listAutomationRuns: listAutomationRunsMock,
}));

vi.mock("../server/factory-graph/store.js", () => ({
  DEFAULT_FACTORY_ID: "default",
  readFactoryDefinition: readFactoryDefinitionMock,
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
  readFactoryDefinitionMock.mockResolvedValue({ id: "support-triage" });
  listAutomationRunsMock.mockResolvedValue([]);
});

describe("list-factory-automations", () => {
  it("lets workspace members update Factory-domain jobs", async () => {
    listAutomationDefinitionsMock.mockResolvedValue([
      {
        name: "factories/support-triage/factory-slack-feedback",
        body: "Observe Slack.",
        canUpdate: false,
        resource: {
          id: "resource-1",
          owner: "__organization__:org-1",
          path: "jobs/factories/support-triage/factory-slack-feedback.md",
          content:
            "---\ndomain: factory\nfactoryId: support-triage\n---\nObserve Slack.\n",
          updatedAt: 1,
        },
        meta: {
          domain: "factory",
          model: "claude-sonnet",
          schedule: "*/5 * * * *",
          enabled: true,
          triggerType: "schedule",
          event: null,
          timezone: null,
          condition: null,
          createdBy: "alice@example.com",
        },
      },
    ]);

    const { default: action } = await import("./list-factory-automations.js");
    const result = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "teammate@example.com" },
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "resource-1",
        canUpdate: true,
        createdBy: "alice@example.com",
      }),
    ]);
  });
});
