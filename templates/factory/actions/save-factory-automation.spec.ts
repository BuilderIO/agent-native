import { beforeEach, describe, expect, it, vi } from "vitest";

const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/jobs", () => ({
  isValidCron: () => true,
  nextOccurrence: () => new Date("2026-08-24T00:00:00.000Z"),
}));

vi.mock("@agent-native/core/resources", () => ({
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: listAutomationDefinitionsMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

const existingContent = `---
domain: factory
factoryId: support-triage
createdBy: alice@example.com
triggerType: schedule
schedule: "*/5 * * * *"
enabled: true
---
Observe Slack.
`;

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
  listAutomationDefinitionsMock.mockResolvedValue([
    {
      name: "factories/support-triage/factory-slack-feedback",
      canUpdate: false,
      resource: {
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content: existingContent,
        updatedAt: 1,
      },
      meta: {
        domain: "factory",
        triggerType: "schedule",
        timezone: "UTC",
      },
    },
  ]);
  resourceGetByPathMock.mockResolvedValue({
    id: "resource-1",
    owner: "__organization__:org-1",
    path: "jobs/factories/support-triage/factory-slack-feedback.md",
    content: existingContent,
    updatedAt: 1,
  });
  resourcePutIfCurrentMock.mockResolvedValue({ id: "resource-1" });
});

describe("save-factory-automation", () => {
  it("lets a teammate save a Factory job without core canUpdate", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        prompt: "Watch Slack more closely.",
        schedule: "*/10 * * * *",
        enabled: true,
      },
      { userEmail: "teammate@example.com" },
    );

    expect(result).toMatchObject({ ok: true, id: "resource-1" });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "__organization__:org-1",
        content: expect.stringContaining("createdBy: alice@example.com"),
      }),
    );
    expect(resourcePutIfCurrentMock.mock.calls[0]?.[0].content).not.toContain(
      "createdBy: teammate@example.com",
    );
  });
});
