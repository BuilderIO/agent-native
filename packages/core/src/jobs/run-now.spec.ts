import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fireInternalDispatch: vi.fn(),
  listUnclaimedAutomationRuns: vi.fn(),
  resolveAutomationAccess: vi.fn(),
  resourceGetByPath: vi.fn(),
  startAutomationRun: vi.fn(),
}));

vi.mock("../automations/access.js", () => ({
  resolveAutomationAccess: mocks.resolveAutomationAccess,
}));

vi.mock("../agent/durable-background.js", () => ({
  AGENT_CHAT_BACKGROUND_RUN_FIELD: "backgroundRun",
  dispatchPathTargetsNetlifyBackgroundFunction: () => false,
  resolveAgentChatProcessRunDispatchPath: () => "/dispatch",
}));

vi.mock("../db/client.js", () => ({
  isLocalDatabase: () => true,
}));

vi.mock("../resources/store.js", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceGetByPath: mocks.resourceGetByPath,
}));

vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: mocks.fireInternalDispatch,
}));

vi.mock("./run-history.js", () => ({
  listUnclaimedAutomationRuns: mocks.listUnclaimedAutomationRuns,
  startAutomationRun: mocks.startAutomationRun,
}));

import { queueAutomationRunNow } from "./run-now.js";

const content = `---
schedule: ""
enabled: true
triggerType: manual
createdBy: creator@example.com
orgId: org-1
runAs: creator
---

Run the report.`;

function access(role: "owner" | "collaborate" | "view") {
  return {
    resource: {
      id: "automation-1",
      owner: "__organization__:org-1",
      path: "jobs/report.md",
      content,
    },
    name: "report",
    owningOrganizationId: "org-1",
    capabilities: {
      canEdit: role !== "view",
      canOperate: role !== "view",
      canDelete: role === "owner",
      canManageSharing: role === "owner",
    },
  };
}

describe("queueAutomationRunNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listUnclaimedAutomationRuns.mockResolvedValue([]);
    mocks.startAutomationRun.mockResolvedValue("history-1");
    mocks.fireInternalDispatch.mockResolvedValue(undefined);
  });

  it("resolves stable resource ids and lets Collaborate queue a creator-bound run", async () => {
    mocks.resolveAutomationAccess.mockResolvedValue(access("collaborate"));

    await expect(
      queueAutomationRunNow({
        userEmail: "collaborator@example.com",
        resourceId: "automation-1",
      }),
    ).resolves.toEqual({
      queued: true,
      runId: "history-1",
      automationRunId: "history-1",
    });

    expect(mocks.resolveAutomationAccess).toHaveBeenCalledWith(
      { userEmail: "collaborator@example.com" },
      "automation-1",
    );
    expect(mocks.startAutomationRun).toHaveBeenCalledWith({
      owner: "__organization__:org-1",
      automation: "report",
      path: "jobs/report.md",
      scope: "organization",
      orgId: "org-1",
      dispatchPending: true,
    });
    expect(mocks.startAutomationRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ owner: "collaborator@example.com" }),
    );
  });

  it("denies View before creating run history", async () => {
    mocks.resolveAutomationAccess.mockResolvedValue(access("view"));

    await expect(
      queueAutomationRunNow({
        userEmail: "viewer@example.com",
        resourceId: "automation-1",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.startAutomationRun).not.toHaveBeenCalled();
  });

  it("preserves name and scope compatibility by resolving the resource before access", async () => {
    mocks.resourceGetByPath.mockResolvedValue({ id: "automation-1" });
    mocks.resolveAutomationAccess.mockResolvedValue(access("owner"));

    await queueAutomationRunNow({
      userEmail: "creator@example.com",
      orgId: "org-1",
      scope: "organization",
      name: "report",
    });

    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/report.md",
    );
    expect(mocks.resolveAutomationAccess).toHaveBeenCalledWith(
      { userEmail: "creator@example.com" },
      "automation-1",
    );
  });

  it("does not disclose inaccessible or missing resource ids", async () => {
    mocks.resolveAutomationAccess.mockResolvedValue(null);

    await expect(
      queueAutomationRunNow({
        userEmail: "viewer@example.com",
        resourceId: "secret-id",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.startAutomationRun).not.toHaveBeenCalled();
  });
});
