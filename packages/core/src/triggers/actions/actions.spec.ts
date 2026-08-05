import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  defineAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  listAccessibleAutomationDefinitions: vi.fn(),
  refreshEventSubscriptions: vi.fn(),
  updateAutomation: vi.fn(),
}));

vi.mock("../../automations/service.js", () => ({
  defineAutomation: mocks.defineAutomation,
  deleteAutomation: mocks.deleteAutomation,
  listAccessibleAutomationDefinitions:
    mocks.listAccessibleAutomationDefinitions,
  updateAutomation: mocks.updateAutomation,
}));
vi.mock("../dispatcher.js", () => ({
  refreshEventSubscriptions: mocks.refreshEventSubscriptions,
}));

import listAutomations from "./list-automations.js";
import manageAutomation from "./manage-automation.js";

const ctx = {
  caller: "frontend" as const,
  userEmail: "alice@example.com",
  orgId: "org-1",
};
const resource = {
  id: "resource-1",
  owner: "alice@example.com",
  path: "jobs/digest.md",
  content: "content",
};
const definition = {
  resource,
  resourceId: resource.id,
  name: "digest",
  scope: "personal",
  classification: { kind: "job" },
  meta: {
    schedule: "0 9 * * *",
    enabled: true,
    triggerType: "schedule",
    createdBy: "alice@example.com",
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
    organizationId: "org-1",
    grantCount: 1,
    grants: [{ email: "viewer@example.com", role: "view" }],
  },
  creator: { email: "alice@example.com", label: "Alice" },
};

describe("direct automation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAccessibleAutomationDefinitions.mockResolvedValue([definition]);
    mocks.defineAutomation.mockResolvedValue(definition);
    mocks.updateAutomation.mockResolvedValue(definition);
    mocks.deleteAutomation.mockResolvedValue(undefined);
  });

  it("keeps UI actions frontend-only", () => {
    expect(listAutomations.http).toEqual({ method: "GET" });
    expect(listAutomations.agentTool).toBe(false);
    expect(manageAutomation.agentTool).toBe(false);
  });

  it("returns explicit and legacy resources through one stable-id access list", async () => {
    const result = await listAutomations.run({}, ctx);
    expect(result).toEqual([
      expect.objectContaining({
        id: "resource-1",
        resourceId: "resource-1",
        classification: "recurring-job",
        effectiveRole: "owner",
        capabilities: definition.capabilities,
        sharing: definition.sharing,
      }),
    ]);
  });

  it("preserves the optional scope compatibility filter", async () => {
    await expect(
      listAutomations.run({ scope: "organization" }, ctx),
    ).resolves.toEqual([]);
  });

  it("creates with complete sharing and external acknowledgement", async () => {
    const sharing = {
      kind: "specific" as const,
      organizationId: "org-1",
      grants: [{ email: "outside@example.com", role: "collaborate" as const }],
    };
    await manageAutomation.run(
      {
        operation: "create",
        name: "digest",
        scope: "organization",
        triggerType: "manual",
        body: "Build it.",
        sharing,
        acknowledgeExternalCollaborators: true,
      },
      ctx,
    );
    expect(mocks.defineAutomation).toHaveBeenCalledWith(
      { userEmail: "alice@example.com", orgId: "org-1" },
      expect.objectContaining({
        sharing,
        acknowledgeExternalCollaborators: true,
      }),
    );
  });

  it("updates and deletes by resource id while keeping name/scope compatibility", async () => {
    await manageAutomation.run(
      { operation: "update", resourceId: "resource-1", enabled: false },
      ctx,
    );
    expect(mocks.updateAutomation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resourceId: "resource-1", enabled: false }),
    );

    await manageAutomation.run(
      { operation: "delete", name: "digest", scope: "personal" },
      ctx,
    );
    expect(mocks.deleteAutomation).toHaveBeenCalledWith(expect.anything(), {
      name: "digest",
      scope: "personal",
    });
  });

  it("rejects public sharing in the action schema", async () => {
    await expect(
      manageAutomation.run(
        {
          operation: "create",
          name: "digest",
          scope: "personal",
          triggerType: "manual",
          body: "Build it.",
          sharing: { kind: "public" } as never,
        },
        ctx,
      ),
    ).rejects.toThrow();
    expect(mocks.defineAutomation).not.toHaveBeenCalled();
  });
});
