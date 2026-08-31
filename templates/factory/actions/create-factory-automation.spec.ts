import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const createFactoryAutomationMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: { statusCode?: number } = {}): never => {
    const error = new Error(message) as Error & {
      actionContractError: true;
      errorCode: string;
      statusCode: number;
    };
    error.name = "ActionContractError";
    error.actionContractError = true;
    error.errorCode = "action_failed";
    error.statusCode = options.statusCode ?? 400;
    throw error;
  },
}));

vi.mock("../server/factory-graph/store.js", () => ({
  readFactoryDefinition: readFactoryDefinitionMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

vi.mock("../server/plugins/factory-scheduler-job.js", () => ({
  createFactoryAutomation: createFactoryAutomationMock,
  factoryAutomationTemplatePrompt: () => "# Slack",
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  readFactoryDefinitionMock.mockResolvedValue({ id: "support-triage" });
  createFactoryAutomationMock.mockResolvedValue({
    id: "resource-1",
    name: "factory-slack-feedback",
    path: "jobs/factories/support-triage/factory-slack-feedback.md",
  });
});

describe("create-factory-automation", () => {
  it("rejects include mode with empty author ids", async () => {
    const { default: action } = await import("./create-factory-automation.js");
    await expect(
      action.run(
        {
          factoryId: "support-triage",
          displayName: "Slack feedback",
          source: "slack",
          slackChannelId: "C123",
          authorMode: "include",
          authorIds: [],
        },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/at least one author id/),
      actionContractError: true,
      statusCode: 400,
    });
  });

  it("rejects Slack jobs without a channel as a client error", async () => {
    const { default: action } = await import("./create-factory-automation.js");
    await expect(
      action.run(
        {
          factoryId: "support-triage",
          displayName: "Slack feedback",
          source: "slack",
        },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({
      message: "Configure a Slack channel before creating this job.",
      actionContractError: true,
      statusCode: 400,
    });
    expect(createFactoryAutomationMock).not.toHaveBeenCalled();
  });

  it("creates a Slack job with a work limit", async () => {
    const { default: action } = await import("./create-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        displayName: "Slack feedback",
        source: "slack",
        template: "slack-feedback",
        slackChannelId: "C123",
        workLimit: 3,
      },
      { userEmail: "owner@example.com" },
    );
    expect(result).toMatchObject({
      ok: true,
      id: "resource-1",
      workLimit: 3,
      inboxLimit: 25,
    });
    expect(createFactoryAutomationMock).toHaveBeenCalledWith(
      "owner@example.com",
      "org-1",
      "support-triage",
      expect.objectContaining({
        config: expect.objectContaining({
          source: "slack",
          workLimit: 3,
          slackChannelId: "C123",
        }),
      }),
    );
  });
});
