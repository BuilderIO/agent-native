import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithoutExecutionFence } from "../../../packages/core/src/agent/execution-fence.js";
import { executeAgentToolCall } from "../../../packages/core/src/agent/production-agent.js";
import { withMigrationRuntime } from "../../../packages/core/src/db/migrations.js";
import { settingsStore } from "../../../packages/core/src/settings/store.js";

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

const insertValuesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const deleteReturningMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ id: "ver-deleted" }]),
);
const getDbMock = vi.hoisted(() => vi.fn());
const selectMaxMock = vi.hoisted(() => vi.fn());

vi.mock("../server/db/index.js", () => ({ getDb: getDbMock }));
vi.mock("@agent-native/core/db", () => ({
  isUniqueViolation: (error: { code?: string }) => error?.code === "23505",
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

beforeAll(async () => {
  await import("./save-factory-automation.js");
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
  insertValuesMock.mockResolvedValue(undefined);
  deleteReturningMock.mockResolvedValue([{ id: "ver-deleted" }]);
  selectMaxMock.mockResolvedValue([{ latest: null }]);
  getDbMock.mockReturnValue({
    insert: () => ({ values: insertValuesMock }),
    delete: () => ({ where: () => ({ returning: deleteReturningMock }) }),
    select: () => ({ from: () => ({ where: selectMaxMock }) }),
  });
});

describe("save-factory-automation", () => {
  const input = {
    factoryId: "support-triage",
    automationId: "resource-1",
    name: "factories/support-triage/factory-slack-feedback",
    prompt: "A revised prompt.",
    enabled: false,
  };

  it.each(
    [
      "displayName",
      "model",
      "slackChannelId",
      "slackChannelName",
      "repository",
      "sentryOrgSlug",
      "sentryProjectSlug",
      "sentryEnvironment",
      "timezone",
      "reasoningEffort",
    ].flatMap((field) =>
      ["\r", "\n", "\u0085", "\u2028", "\u2029"].map((separator) => ({
        field,
        separator,
      })),
    ),
  )(
    "requires single-line $field settings with separator $separator",
    async ({ field, separator }) => {
      const { default: action } = await import("./save-factory-automation.js");
      const value = `Selected${separator}continued`;
      const saving = action.run(
        { ...input, scheduleMode: "daily", timezone: "UTC", [field]: value },
        {
          caller: "tool",
          networkProtocol: "mcp",
          userEmail: "teammate@example.com",
        },
      );
      if (field === "reasoningEffort") {
        await expect(saving).rejects.toThrow("Invalid reasoning effort.");
      } else {
        await expect(saving).rejects.toMatchObject({
          actionContractError: true,
          statusCode: 400,
          errorCode: "invalid_request",
          message: expect.stringContaining(field),
        });
      }
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect(insertValuesMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      caller: "frontend" as const,
      lineEnding: "\n",
      marker: "mcpManaged: true\n mcpManaged : false",
    },
    {
      caller: "tool" as const,
      lineEnding: "\n",
      marker: " mcpManaged : false\nmcpManaged: true",
    },
    {
      caller: "frontend" as const,
      lineEnding: "\r\n",
      marker: "mcpManaged: true\n mcpManaged : false",
    },
    {
      caller: "tool" as const,
      networkProtocol: "a2a" as const,
      lineEnding: "\r\n",
      marker: " mcpManaged : false\nmcpManaged: true",
    },
  ])(
    "saves single reserved settings for $caller/$networkProtocol with line ending $lineEnding",
    async ({ lineEnding, marker, ...context }) => {
      const live = existingContent
        .replace(
          "domain: factory",
          `domain: factory\n${marker}\ncustomFactory: retained\nlastRun: older\n lastRun : latest`,
        )
        .replace(/\n/g, lineEnding);
      resourceGetByPathMock.mockResolvedValue({
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content: live,
        updatedAt: 42,
      });
      const { default: action } = await import("./save-factory-automation.js");
      await action.run(
        { ...input, model: "Selected" },
        { ...context, userEmail: "teammate@example.com" },
      );
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      const candidate = resourcePutIfCurrentMock.mock.calls[0][0];
      expect(parseJobResource(candidate.content).meta).toMatchObject({
        mcpManaged: true,
        lastRun: "latest",
        enabled: false,
      });
      const header = candidate.content.split(/\r?\n---/)[0];
      for (const key of [
        "mcpManaged",
        "lastRun",
        "enabled",
        "factoryId",
        "schedule",
      ]) {
        expect(
          header
            .split(/\r?\n/)
            .filter((line) => line.split(":")[0].trim() === key),
        ).toHaveLength(1);
      }
      expect(candidate.content).toContain("customFactory: retained");
      expect(parseJobResource(candidate.content).body).toContain(
        "A revised prompt.",
      );
      expect(candidate).toMatchObject({
        expectedContent: live,
        expectedUpdatedAt: 42,
      });
      expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(live);
    },
  );

  it.each(["mcp", "a2a"] as const)(
    "saves unmarked CRLF settings from %s",
    async (networkProtocol) => {
      const live = existingContent.replace(/\n/g, "\r\n");
      resourceGetByPathMock.mockResolvedValue({
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content: live,
        updatedAt: 42,
      });
      const { default: action } = await import("./save-factory-automation.js");
      await action.run(input, {
        caller: "tool",
        networkProtocol,
        userEmail: "teammate@example.com",
      });
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(
        parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content)
          .meta,
      ).toMatchObject({ mcpManaged: true, enabled: false });
    },
  );

  it.each(["Body only", "---\nenabled: false\nBody"])(
    "requires complete saved settings for %j",
    async (content) => {
      resourceGetByPathMock.mockResolvedValue({
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content,
        updatedAt: 42,
      });
      const { default: action } = await import("./save-factory-automation.js");
      await expect(
        action.run(input, {
          caller: "tool",
          networkProtocol: "mcp",
          userEmail: "teammate@example.com",
        }),
      ).rejects.toThrow();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect(insertValuesMock).not.toHaveBeenCalled();
    },
  );

  it.each(["mcp", "a2a"] as const)(
    "pauses tool over %s before save/history and stamps the exact approved candidate",
    async (networkProtocol) => {
      const { default: action } = await import("./save-factory-automation.js");
      const call = (args = input, approvedToolCalls?: string[]) =>
        runWithoutExecutionFence(() =>
          executeAgentToolCall({
            actions: { "save-factory-automation": action },
            name: "save-factory-automation",
            callId: "save-factory",
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
      expect(requireWorkspaceMemberMock).not.toHaveBeenCalled();
      expect(insertValuesMock).not.toHaveBeenCalled();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      if (paused.status !== "approval_required")
        throw new Error("Missing approval");
      expect(
        (
          await call({ ...input, prompt: "Changed after approval." }, [
            paused.approvalKey,
          ])
        ).status,
      ).toBe("approval_required");
      expect(insertValuesMock).not.toHaveBeenCalled();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      const completed = await call(input, [paused.approvalKey]);
      expect(completed.status).toBe("completed");
      expect(resourcePutIfCurrentMock).toHaveBeenCalledOnce();
      expect(insertValuesMock).toHaveBeenCalledOnce();
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      const saved = resourcePutIfCurrentMock.mock.calls[0][0];
      expect(parseJobResource(saved.content).meta.mcpManaged).toBe(true);
      expect(saved.expectedContent).toBe(existingContent);
      expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(
        existingContent,
      );
    },
  );

  it.each(["frontend", "tool"] as const)(
    "keeps an ordinary %s save unmarked",
    async (caller) => {
      const { default: action } = await import("./save-factory-automation.js");
      const result = await runWithoutExecutionFence(() =>
        executeAgentToolCall({
          actions: { "save-factory-automation": action },
          name: "save-factory-automation",
          callId: "ordinary-save",
          input,
          caller,
          ownerEmail: "teammate@example.com",
        }),
      );
      expect(result.status).toBe("completed");
      expect(resourcePutIfCurrentMock).toHaveBeenCalledOnce();
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(
        parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
          .mcpManaged,
      ).toBeUndefined();
    },
  );

  it.each(["mcp", "a2a"] as const)(
    "stamps outside %s saves at the content boundary",
    async (networkProtocol) => {
      const { default: action } = await import("./save-factory-automation.js");
      await action.run(input, {
        caller: "tool",
        networkProtocol,
        userEmail: "teammate@example.com",
      });
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(
        parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
          .mcpManaged,
      ).toBe(true);
    },
  );

  it("retains the historical outside marker when a trusted teammate edits the prompt", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "resource-1",
      owner: "__organization__:org-1",
      path: "jobs/factories/support-triage/factory-slack-feedback.md",
      content: existingContent.replace(
        "domain: factory",
        "domain: factory\nmcpManaged: true",
      ),
      updatedAt: 1,
    });
    const { default: action } = await import("./save-factory-automation.js");
    await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        prompt: "---\nmcpManaged: false\n---\nA trusted prompt edit.",
        enabled: false,
      },
      { caller: "frontend", userEmail: "teammate@example.com" },
    );
    const { parseJobResource } =
      await import("@agent-native/core/jobs/frontmatter");
    expect(
      parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
        .mcpManaged,
    ).toBe(true);
  });

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

  it("refuses to edit a workflow's job and points at save-factory-workflow", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/support-triage/workflow-digest-1a2b3c4d",
      resource: {
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/workflow-digest-1a2b3c4d.md",
        content: existingContent,
        updatedAt: 1,
      },
      meta: { domain: "factory", triggerType: "schedule", runner: "workflow" },
    });
    const { default: action } = await import("./save-factory-automation.js");

    await expect(
      action.run(
        {
          factoryId: "support-triage",
          automationId: "resource-1",
          name: "factories/support-triage/workflow-digest-1a2b3c4d",
          prompt: "Rewrite the job.",
          enabled: true,
        },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toThrow("save-factory-workflow");
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("does not force a findings channel onto a GitHub job when enabling it", async () => {
    const githubContent = `---
domain: factory
factoryId: support-triage
createdBy: alice@example.com
triggerType: schedule
schedule: "0 * * * *"
enabled: false
source: github
template: blank
repository: BuilderIO/agent-native
---
Review GitHub issues.
`;
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/support-triage/factory-github-issues",
      resource: {
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-github-issues.md",
        content: githubContent,
        updatedAt: 1,
      },
      meta: { domain: "factory", triggerType: "schedule", timezone: "UTC" },
    });
    resourceGetByPathMock.mockResolvedValue({
      id: "resource-1",
      owner: "__organization__:org-1",
      path: "jobs/factories/support-triage/factory-github-issues.md",
      content: githubContent,
      updatedAt: 1,
    });
    const { default: action } = await import("./save-factory-automation.js");

    await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-github-issues",
        prompt: "Review GitHub issues.",
        enabled: true,
      },
      { userEmail: "teammate@example.com" },
    );
    const saved = resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    expect(saved).not.toContain("slackChannelId:");
    expect(saved).not.toContain("qa-agent-native");
  });

  it("checks only the source's connection when enabling a GitHub job", async () => {
    const githubContent = `---
domain: factory
factoryId: support-triage
createdBy: alice@example.com
triggerType: schedule
schedule: "0 * * * *"
enabled: false
source: github
template: blank
repository: BuilderIO/agent-native
---
Review GitHub issues.
`;
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/support-triage/factory-github-issues",
      resource: {
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-github-issues.md",
        content: githubContent,
        updatedAt: 1,
      },
      meta: { domain: "factory", triggerType: "schedule", timezone: "UTC" },
    });
    resourceGetByPathMock.mockResolvedValue({
      id: "resource-1",
      owner: "__organization__:org-1",
      path: "jobs/factories/support-triage/factory-github-issues.md",
      content: githubContent,
      updatedAt: 1,
    });
    const { default: action } = await import("./save-factory-automation.js");

    await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-github-issues",
        prompt: "Review GitHub issues.",
        enabled: true,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(assertFactoryConnectorReadyMock).toHaveBeenCalledTimes(1);
    expect(assertFactoryConnectorReadyMock).toHaveBeenCalledWith(
      "github",
      "teammate@example.com",
      expect.objectContaining({ orgId: "org-1", verb: "saving" }),
    );
  });

  it("saves and clears reasoningEffort, and rejects an unrecognized value", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    const baseInput = {
      factoryId: "support-triage",
      automationId: "resource-1",
      name: "factories/support-triage/factory-slack-feedback",
      prompt: "Watch Slack more closely.",
      scheduleMode: "interval" as const,
      intervalMinutes: 10,
      enabled: true,
    };

    const result = await action.run(
      { ...baseInput, reasoningEffort: "high" },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, reasoningEffort: "high" });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("reasoningEffort: high"),
      }),
    );

    resourceGetByPathMock.mockResolvedValueOnce({
      id: "resource-1",
      owner: "__organization__:org-1",
      path: "jobs/factories/support-triage/factory-slack-feedback.md",
      content: `${existingContent.replace("---\nObserve Slack.", "reasoningEffort: high\n---\nObserve Slack.")}`,
      updatedAt: 1,
    });
    const cleared = await action.run(
      { ...baseInput, reasoningEffort: "" },
      { userEmail: "teammate@example.com" },
    );
    expect(cleared).toMatchObject({ ok: true, reasoningEffort: null });

    expect(
      action.schema.safeParse({ ...baseInput, reasoningEffort: "extreme" })
        .success,
    ).toBe(false);
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
        clearIdentityFields: true,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, enabled: false });
    const saved = resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    expect(saved).not.toContain("slackChannelId:");
    expect(saved).not.toContain("slackChannelName:");
  });

  it("does not bump the version when an already-unset optional field is resent as an empty string", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        prompt: "Observe Slack.",
        slackChannelId: "C123",
        slackChannelName: "",
        repository: "",
        sentryOrgSlug: "",
        sentryProjectSlug: "",
        sentryEnvironment: "",
        enabled: true,
      },
      { userEmail: "teammate@example.com" },
    );
    expect(result).toMatchObject({ ok: true, promptVersion: 0 });
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("rejects disabled saves that clear the channel without clearIdentityFields", async () => {
    const { default: action } = await import("./save-factory-automation.js");
    await expect(
      action.run(
        {
          factoryId: "support-triage",
          automationId: "resource-1",
          name: "factories/support-triage/factory-slack-feedback",
          prompt: "Watch Slack more closely.",
          slackChannelId: "",
          enabled: false,
        },
        { userEmail: "teammate@example.com" },
      ),
    ).rejects.toThrow(
      "Refusing to clear Slack channel without clearIdentityFields: true.",
    );
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
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

  it("writes github source for a PR governance copy that lost YAML source", async () => {
    const copyContent = `---
schedule: "*/5 * * * *"
enabled: false
template: pr-governance
repository: acme/widgets
---
Review pull requests.
`;
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factories/support-triage/factory-pr-governance-2",
      body: "Review pull requests.",
      resource: {
        id: "resource-copy",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-pr-governance-2.md",
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
      path: "jobs/factories/support-triage/factory-pr-governance-2.md",
      content: copyContent,
      updatedAt: 1,
    });
    const { default: action } = await import("./save-factory-automation.js");
    const result = await action.run(
      {
        factoryId: "support-triage",
        automationId: "resource-copy",
        name: "factories/support-triage/factory-pr-governance-2",
        prompt: "Review pull requests.",
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

  it("deletes the inserted predecessor snapshot when the live write is rejected", async () => {
    resourcePutIfCurrentMock.mockResolvedValue(null);
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
    ).rejects.toThrow("changed concurrently");

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(deleteReturningMock).toHaveBeenCalledTimes(1);
  });

  it("deletes the inserted predecessor snapshot when the live write throws", async () => {
    resourcePutIfCurrentMock.mockRejectedValue(new Error("db unavailable"));
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
    ).rejects.toThrow("db unavailable");

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(deleteReturningMock).toHaveBeenCalledTimes(1);
  });

  describe("version history", () => {
    const saveInput = {
      factoryId: "support-triage",
      automationId: "resource-1",
      name: "factories/support-triage/factory-slack-feedback",
      prompt: "Watch Slack more closely.",
      enabled: true,
    };

    it("stores the previous content past existing history when the file lost its promptVersion", async () => {
      selectMaxMock.mockResolvedValue([{ latest: 1 }]);
      const { default: action } = await import("./save-factory-automation.js");

      await action.run(saveInput, { userEmail: "teammate@example.com" });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2 }),
      );
      expect(resourcePutIfCurrentMock.mock.calls[0]?.[0].content).toContain(
        "promptVersion: 3",
      );
    });

    it("keeps the file's own numbering when it is in step with its history", async () => {
      selectMaxMock.mockResolvedValue([{ latest: 1 }]);
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content: existingContent.replace(
          "enabled: true",
          "enabled: true\npromptVersion: 2",
        ),
        updatedAt: 1,
      });
      const { default: action } = await import("./save-factory-automation.js");

      await action.run(saveInput, { userEmail: "teammate@example.com" });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2 }),
      );
      expect(resourcePutIfCurrentMock.mock.calls[0]?.[0].content).toContain(
        "promptVersion: 3",
      );
    });

    it("reports a concurrent history insert as a conflict, not a server error", async () => {
      insertValuesMock.mockRejectedValue(
        Object.assign(new Error("Failed query: insert into"), {
          cause: { code: "23505" },
        }),
      );
      const { default: action } = await import("./save-factory-automation.js");

      await expect(
        action.run(saveInput, { userEmail: "teammate@example.com" }),
      ).rejects.toThrow("saved at the same time");

      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    });
  });

  describe("trigger type", () => {
    const saveInput = {
      factoryId: "support-triage",
      automationId: "resource-1",
      name: "factories/support-triage/factory-slack-feedback",
      prompt: "Watch Slack more closely.",
      enabled: true,
    };

    const untagged = existingContent.replace("triggerType: schedule\n", "");
    const saveUntagged = async (live: string) => {
      findFactoryAutomationDefinitionMock.mockResolvedValue({
        name: saveInput.name,
        body: "Observe Slack.",
        resource: {
          id: "resource-1",
          owner: "__organization__:org-1",
          path: "jobs/factories/support-triage/factory-slack-feedback.md",
          content: live,
          updatedAt: 1,
        },
        meta: { domain: "factory", timezone: "UTC" },
      });
      resourceGetByPathMock.mockResolvedValue({
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-slack-feedback.md",
        content: live,
        updatedAt: 1,
      });
      const { default: action } = await import("./save-factory-automation.js");
      await action.run(saveInput, { userEmail: "teammate@example.com" });
      return resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    };

    it("stamps triggerType: schedule on a job file that has none, writing down the identity the legacy path assumed", async () => {
      const content = await saveUntagged(untagged);

      expect(content).toContain("triggerType: schedule");
      expect(content).toContain("createdBy: alice@example.com");
      expect(content).toContain("runAs: creator");
      expect(content).toContain("orgId: org-1");
    });

    it("saves a file without a creator but leaves it untagged, so it keeps its legacy run path", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const content = await saveUntagged(
        untagged.replace("createdBy: alice@example.com\n", ""),
      );

      expect(content).not.toContain("triggerType:");
      expect(content).not.toContain("createdBy:");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("stays untagged because it has no createdBy"),
      );
      warn.mockRestore();
    });

    it("leaves a file owned by another org untagged", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const content = await saveUntagged(
        untagged.replace("enabled: true", "enabled: true\norgId: org-2"),
      );

      expect(content).not.toContain("triggerType:");
      expect(content).toContain("orgId: org-2");
      warn.mockRestore();
    });

    it("writes the field once when the file already has it", async () => {
      const { default: action } = await import("./save-factory-automation.js");

      await action.run(saveInput, { userEmail: "teammate@example.com" });

      const content: string =
        resourcePutIfCurrentMock.mock.calls[0]?.[0].content;
      expect(content.match(/^triggerType:/gm)).toHaveLength(1);
    });
  });
});
