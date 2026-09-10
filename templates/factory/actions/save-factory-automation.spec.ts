import { beforeEach, describe, expect, it, vi } from "vitest";

const findFactoryAutomationDefinitionMock = vi.hoisted(() => vi.fn());
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

vi.mock("../server/lib/factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findFactoryAutomationDefinitionMock,
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
  findFactoryAutomationDefinitionMock.mockResolvedValue({
    name: "factories/support-triage/factory-slack-feedback",
    body: "Observe Slack.",
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
  });
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

  it("removes a Slack channel when a disabled save clears it", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        prompt: "Watch Slack more closely.",
        slackChannelId: "",
        slackChannelName: "",
        enabled: false,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, enabled: false });
    const saved = resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    expect(saved).not.toContain("slackChannelId:");
    expect(saved).not.toContain("slackChannelName:");
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

  it("saves a factory-folder job that lost domain and triggerType", async () => {
    const slimContent = `---
enabled: true
slackChannelId: C123
---
Observe Slack.
`;
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/support-triage/factory-slack-feedback",
      body: "Observe Slack.",
      resource: {
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content: slimContent,
        updatedAt: 1,
      },
      meta: {
        enabled: true,
      },
    });
    resourceGetByPathMock.mockResolvedValue({
      id: "resource-1",
      owner: "__organization__:org-1",
      path: "jobs/factories/support-triage/factory-slack-feedback.md",
      content: slimContent,
      updatedAt: 1,
    });
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        prompt: "Watch Slack more closely.",
        scheduleMode: "interval",
        intervalMinutes: 10,
        enabled: false,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, id: "resource-1" });
    const saved = resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    expect(saved).toContain("appId: factory");
    expect(saved).toContain("nextRun: 2026-08-24T00:00:00.000Z");
    expect(saved).not.toMatch(/^domain:/m);
  });

  it("rejects list-row null destinations and accepts omitted ones", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    const slackSave = {
      factoryId: "support-triage",
      automationId: "resource-1",
      name: "factories/support-triage/factory-slack-feedback",
      prompt: "Watch Slack more closely.",
      enabled: true,
      slackChannelId: "C123",
    };
    const asPosted = JSON.parse(
      JSON.stringify({
        ...slackSave,
        repository: null,
        sentryOrgSlug: null,
        sentryProjectSlug: null,
        sentryEnvironment: null,
      }),
    ) as Record<string, unknown>;
    expect(action.schema.safeParse(asPosted).success).toBe(false);

    const omitted = JSON.parse(
      JSON.stringify({
        ...slackSave,
        repository: undefined,
        sentryOrgSlug: undefined,
        sentryProjectSlug: undefined,
        sentryEnvironment: undefined,
      }),
    ) as Record<string, unknown>;
    expect(omitted).not.toHaveProperty("repository");
    expect(action.schema.safeParse(omitted).success).toBe(true);
  });

  it("writes github source for a PR babysit copy that lost YAML source", async () => {
    const copyContent = `---
schedule: "*/5 * * * *"
enabled: false
template: pr-babysit
repository: acme/widgets
---
Babysit pull requests.
`;
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/support-triage/factory-pr-babysit-2",
      body: "Babysit pull requests.",
      resource: {
        id: "resource-copy",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-pr-babysit-2.md",
        content: copyContent,
        updatedAt: 1,
      },
      meta: {
        triggerType: "schedule",
      },
    });
    resourceGetByPathMock.mockResolvedValue({
      id: "resource-copy",
      owner: "__organization__:org-1",
      path: "jobs/factories/support-triage/factory-pr-babysit-2.md",
      content: copyContent,
      updatedAt: 1,
    });
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-copy",
        name: "factories/support-triage/factory-pr-babysit-2",
        prompt: "Babysit pull requests.",
        repository: "acme/widgets",
        authorMode: "include",
        authorIds: ["138030887"],
        enabled: false,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, source: "github" });
    const saved = resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    expect(saved).toMatch(/^source: github$/m);
    expect(saved).not.toMatch(/^source: slack$/m);
    expect(saved).toContain("authorIds: 138030887");
  });
});
