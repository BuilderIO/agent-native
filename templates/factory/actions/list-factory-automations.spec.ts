import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const listAutomationRunsMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/resources", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceList: resourceListMock,
  resourceGetByPath: resourceGetByPathMock,
}));

vi.mock("@agent-native/core/triggers", () => ({
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
  resourceListMock.mockResolvedValue([]);
  resourceGetByPathMock.mockResolvedValue(null);
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
    resourceListMock.mockResolvedValue([resource]);
    resourceGetByPathMock.mockResolvedValue(resource);

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
    resourceListMock.mockResolvedValue([resource]);
    resourceGetByPathMock.mockResolvedValue(resource);

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
    expect(resourceListMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/factories/support-triage/",
    );
  });
});
