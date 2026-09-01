import { beforeEach, describe, expect, it, vi } from "vitest";

const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const { assertFactoryConnectorReadyMock, VaultUnavailableError } = vi.hoisted(
  () => {
    class VaultUnavailableError extends Error {}
    return {
      assertFactoryConnectorReadyMock: vi.fn(),
      VaultUnavailableError,
    };
  },
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string): never => {
    const error = new Error(message) as Error & {
      actionContractError: true;
    };
    error.actionContractError = true;
    throw error;
  },
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

vi.mock("../server/connectors/credentials.js", () => ({
  assertFactoryConnectorReady: assertFactoryConnectorReadyMock,
  VaultUnavailableError,
}));

const existingContent = `---
domain: factory
factoryId: support-triage
createdBy: alice@example.com
triggerType: schedule
schedule: "*/5 * * * *"
enabled: true
slackChannelId: C123
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
  assertFactoryConnectorReadyMock.mockResolvedValue(undefined);
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
        scheduleMode: "interval",
        intervalMinutes: 10,
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
    expect(assertFactoryConnectorReadyMock).toHaveBeenCalled();
  });

  it("rejects Slack saves that clear the channel", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    await expect(
      action.run(
        {
          factoryId: "support-triage",
          automationId: "resource-1",
          name: "factories/support-triage/factory-slack-feedback",
          prompt: "Watch Slack more closely.",
          slackChannelId: "",
          enabled: true,
        },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toThrow("Configure a Slack channel before saving this job.");
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("lets a teammate disable a job when the connector is missing", async () => {
    assertFactoryConnectorReadyMock.mockRejectedValue(
      new Error(
        "Connect Slack in Dispatch or add a vault token before saving this job.",
      ),
    );
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        prompt: "Watch Slack more closely.",
        enabled: false,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, enabled: false });
    expect(assertFactoryConnectorReadyMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).toHaveBeenCalled();
  });

  it("surfaces a missing connector as an action failure when saving an enabled job", async () => {
    assertFactoryConnectorReadyMock.mockRejectedValue(
      new Error(
        "Connect Slack in Dispatch or add a vault token before saving this job.",
      ),
    );
    const { default: action } = await import("./save-factory-automation.js");
    await expect(
      action.run(
        {
          factoryId: "support-triage",
          automationId: "resource-1",
          name: "factories/support-triage/factory-slack-feedback",
          prompt: "Watch Slack more closely.",
          enabled: true,
        },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toMatchObject({
      message:
        "Connect Slack in Dispatch or add a vault token before saving this job.",
      actionContractError: true,
    });
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("surfaces a vault outage as an action failure when saving an enabled job", async () => {
    assertFactoryConnectorReadyMock.mockRejectedValue(
      new VaultUnavailableError("vault timeout"),
    );
    const { default: action } = await import("./save-factory-automation.js");
    await expect(
      action.run(
        {
          factoryId: "support-triage",
          automationId: "resource-1",
          name: "factories/support-triage/factory-slack-feedback",
          prompt: "Watch Slack more closely.",
          enabled: true,
        },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toMatchObject({
      message: "vault timeout",
      actionContractError: true,
    });
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });
});
