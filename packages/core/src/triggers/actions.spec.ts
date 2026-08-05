import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  defineAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  listAccessibleAutomationDefinitions: vi.fn(),
  queueAutomationRunNow: vi.fn(),
  refreshEventSubscriptions: vi.fn(),
  updateAutomation: vi.fn(),
}));

vi.mock("../automations/service.js", () => ({
  defineAutomation: mocks.defineAutomation,
  deleteAutomation: mocks.deleteAutomation,
  listAccessibleAutomationDefinitions:
    mocks.listAccessibleAutomationDefinitions,
  updateAutomation: mocks.updateAutomation,
}));
vi.mock("../jobs/run-now.js", () => ({
  queueAutomationRunNow: mocks.queueAutomationRunNow,
}));
vi.mock("./dispatcher.js", () => ({
  refreshEventSubscriptions: mocks.refreshEventSubscriptions,
}));
vi.mock("../event-bus/index.js", () => ({
  listEvents: () => [],
  emit: vi.fn(),
}));
vi.mock("../server/request-context.js", () => ({
  getIntegrationRequestContext: () => undefined,
  getRequestOrgId: () => "org-1",
}));

import { createAutomationToolEntries } from "./actions.js";

const owner = "alice@example.com";
const definition = {
  resource: {
    id: "resource-1",
    owner,
    path: "jobs/digest.md",
    content: "content",
  },
  resourceId: "resource-1",
  name: "digest",
  scope: "personal",
  classification: {
    kind: "automation",
    triggerType: "manual",
    hasExplicitTriggerType: true,
  },
  meta: {
    schedule: "",
    enabled: true,
    triggerType: "manual",
    mode: "agentic",
    createdBy: owner,
    runAs: "creator",
  },
  body: "Build the digest.",
  canUpdate: true,
  effectiveRole: "owner",
  capabilities: {
    canEdit: true,
    canOperate: true,
    canDelete: true,
    canManageSharing: true,
  },
  sharing: {
    source: "explicit",
    visibility: "private",
    organizationId: null,
    grantCount: 1,
    grants: [{ email: "viewer@example.com", role: "view" }],
  },
  creator: { email: owner, label: "Alice" },
};

function tool() {
  return createAutomationToolEntries(() => owner)["manage-automations"];
}

describe("manage-automations tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAccessibleAutomationDefinitions.mockResolvedValue([definition]);
    mocks.defineAutomation.mockResolvedValue(definition);
    mocks.updateAutomation.mockResolvedValue(definition);
    mocks.deleteAutomation.mockResolvedValue(undefined);
    mocks.queueAutomationRunNow.mockResolvedValue({
      queued: true,
      runId: "run-1",
      automationRunId: "run-1",
    });
  });

  it("preserves plan-mode reads and confirmations for writes", () => {
    const effect = tool().planMode?.effect;
    if (typeof effect !== "function") throw new Error("Missing classifier");
    expect(effect({ action: "list" })).toBe("read");
    expect(effect({ action: "list-events" })).toBe("read");
    expect(effect({ action: "define" })).toBe("write");
    expect(effect({ action: "delete" })).toBe("write");
  });

  it("lists unified access, sharing, classification, and stable ids", async () => {
    const result = JSON.parse(await tool().run({ action: "list" }));
    expect(result).toEqual([
      expect.objectContaining({
        resourceId: "resource-1",
        classification: "automation",
        effectiveRole: "owner",
        capabilities: definition.capabilities,
        sharing: definition.sharing,
      }),
    ]);
    expect(mocks.listAccessibleAutomationDefinitions).toHaveBeenCalledWith({
      userEmail: owner,
      orgId: "org-1",
    });
  });

  it("forwards complete sharing and external acknowledgement on define/update", async () => {
    const sharing = {
      kind: "specific",
      organizationId: "org-1",
      grants: [{ email: "outside@example.com", role: "collaborate" }],
    };
    await tool().run({
      action: "define",
      name: "digest",
      trigger_type: "manual",
      body: "Build it.",
      sharing,
      acknowledge_external_collaborators: "true",
    });
    expect(mocks.defineAutomation).toHaveBeenCalledWith(
      { userEmail: owner, orgId: "org-1" },
      expect.objectContaining({
        sharing,
        acknowledgeExternalCollaborators: true,
      }),
    );

    await tool().run({
      action: "update",
      resource_id: "resource-1",
      sharing: { kind: "personal" },
    });
    expect(mocks.updateAutomation).toHaveBeenCalledWith(
      { userEmail: owner, orgId: "org-1" },
      expect.objectContaining({
        resourceId: "resource-1",
        sharing: { kind: "personal" },
      }),
    );
  });

  it("keeps name/scope compatibility while preferring resource ids", async () => {
    await tool().run({
      action: "update",
      name: "digest",
      scope: "personal",
      enabled: "false",
    });
    expect(mocks.updateAutomation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "digest", scope: "personal" }),
    );

    await tool().run({ action: "delete", resource_id: "resource-1" });
    expect(mocks.deleteAutomation).toHaveBeenCalledWith(expect.anything(), {
      resourceId: "resource-1",
    });
  });

  it("rejects public sharing and throws failures instead of returning Error strings", async () => {
    await expect(
      tool().run({
        action: "define",
        name: "public-digest",
        trigger_type: "manual",
        body: "Build it.",
        sharing: { kind: "public" },
      }),
    ).rejects.toThrow(/sharing kind/);
    await expect(
      tool().run({
        action: "define",
        name: "deterministic",
        trigger_type: "manual",
        body: "Build it.",
        mode: "deterministic",
      }),
    ).rejects.toThrow(/Deterministic mode was removed/);
  });

  it("queues resource-id runs and describes immutable creator execution", async () => {
    const entry = tool();
    expect(entry.tool.description).toContain("immutable creator");
    expect(entry.tool.parameters.properties.resource_id).toBeDefined();
    await entry.run({ action: "run-now", resource_id: "resource-1" });
    expect(mocks.queueAutomationRunNow).toHaveBeenCalledWith({
      userEmail: owner,
      orgId: "org-1",
      resourceId: "resource-1",
      scope: undefined,
      name: undefined,
    });
    await expect(
      entry.run(
        { action: "run-now", resource_id: "resource-1" },
        { caller: "automation" },
      ),
    ).rejects.toThrow(/cannot run another automation/);
  });
});
