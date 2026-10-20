import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceListContentMock = vi.hoisted(() => vi.fn());
const listAutomationRunsMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const recordFactoryGovernanceAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/resources", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceListContentByOwnersAndPrefixes: resourceListContentMock,
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

vi.mock("../server/triage/audit.js", () => ({
  recordFactoryGovernanceAudit: recordFactoryGovernanceAuditMock,
}));

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationRuns: listAutomationRunsMock,
}));

vi.mock("../server/lib/factory-definitions.js", () => ({
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
  resourceListContentMock.mockResolvedValue([]);
  recordFactoryGovernanceAuditMock.mockResolvedValue(undefined);
});

function factoryJobResource(content: string) {
  return {
    id: "resource-1",
    owner: "__organization__:org-1",
    path: "jobs/factories/support-triage/factory-slack-feedback.md",
    content,
    updatedAt: 1,
  };
}

describe("list-factory-automations", { timeout: 15_000 }, () => {
  it("lets workspace members update Factory-domain jobs", async () => {
    const resource = factoryJobResource(
      "---\ndomain: factory\nfactoryId: support-triage\nmodel: claude-sonnet\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\ncreatedBy: alice@example.com\n---\nObserve Slack.\n",
    );
    resourceListContentMock.mockResolvedValue([resource]);

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

  it("lists factory-folder jobs even when domain and triggerType are missing", async () => {
    const resource = factoryJobResource(
      "---\nenabled: true\nlastStatus: running\nlastRun: 2026-09-01T21:45:00.000Z\n---\nObserve Slack.\n",
    );
    resourceListContentMock.mockResolvedValue([resource]);

    const { default: action } = await import("./list-factory-automations.js");
    const result = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "teammate@example.com" },
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "resource-1",
        name: "factories/support-triage/factory-slack-feedback",
        enabled: true,
      }),
    ]);
    expect(resourceListContentMock).toHaveBeenCalledWith(
      ["__organization__:org-1"],
      ["jobs/factories/support-triage/"],
    );
  });

  it("leaves a workflow's job to the workflow list", async () => {
    const agentJob = factoryJobResource(
      "---\ndomain: factory\nfactoryId: support-triage\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\ncreatedBy: alice@example.com\n---\nObserve Slack.\n",
    );
    const workflowJob = {
      ...factoryJobResource(
        "---\ndomain: factory\nfactoryId: support-triage\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\ncreatedBy: alice@example.com\nrunner: workflow\n---\nPlaceholder.\n",
      ),
      id: "resource-2",
      path: "jobs/factories/support-triage/workflow-digest-1a2b3c4d.md",
    };
    resourceListContentMock.mockResolvedValue([agentJob, workflowJob]);

    const { default: action } = await import("./list-factory-automations.js");
    const result = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "teammate@example.com" },
    );

    expect(result).toEqual([expect.objectContaining({ id: "resource-1" })]);
  });

  it("pauses a seeded agent job that still calls a removed action, once, and lists it as paused", async () => {
    const stored = {
      ...factoryJobResource(
        "---\ndomain: factory\nfactoryId: support-triage\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\ncreatedBy: alice@example.com\n---\nCall get-slack-feedback-context, then dispatch-factory-item.\n",
      ),
      updatedAt: 7,
    };
    let current = stored;
    resourceListContentMock.mockImplementation(async () => [current]);
    resourceGetByPathMock.mockImplementation(async () => current);
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { content: string }) => {
        current = { ...current, content: input.content };
        return { id: current.id };
      },
    );

    const { default: action } = await import("./list-factory-automations.js");
    const first = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "teammate@example.com" },
    );
    const second = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "teammate@example.com" },
    );

    expect(first).toEqual([
      expect.objectContaining({
        id: "resource-1",
        enabled: false,
        pausedReason: "replaced_by_workflows",
      }),
    ]);
    expect(second).toEqual(
      first.map((job) =>
        expect.objectContaining({ id: job.id, enabled: false }),
      ),
    );
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(1);
    expect(recordFactoryGovernanceAuditMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a seeded-looking workflow job running", async () => {
    const workflowJob = factoryJobResource(
      "---\ndomain: factory\nfactoryId: support-triage\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\nrunner: workflow\n---\nCall dispatch-factory-item.\n",
    );
    resourceListContentMock.mockResolvedValue([workflowJob]);

    const { default: action } = await import("./list-factory-automations.js");
    await action.run(
      { factoryId: "support-triage" },
      { userEmail: "teammate@example.com" },
    );

    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });
});
