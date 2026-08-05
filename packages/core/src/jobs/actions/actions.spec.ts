import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAutomationRuns: vi.fn(),
  listAccessibleAutomationDefinitions: vi.fn(),
  listAutomationRuns: vi.fn(),
  queueAutomationRunNow: vi.fn(),
  resolveAutomationAccess: vi.fn(),
  resourceDelete: vi.fn(),
  resourceGetByPath: vi.fn(),
  resourcePut: vi.fn(),
}));

vi.mock("../../automations/access.js", () => ({
  resolveAutomationAccess: mocks.resolveAutomationAccess,
}));
vi.mock("../../automations/service.js", () => ({
  listAccessibleAutomationDefinitions:
    mocks.listAccessibleAutomationDefinitions,
}));
vi.mock("../../resources/store.js", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceDelete: mocks.resourceDelete,
  resourceGetByPath: mocks.resourceGetByPath,
  resourcePut: mocks.resourcePut,
}));
vi.mock("../run-history.js", () => ({
  deleteAutomationRuns: mocks.deleteAutomationRuns,
  listAutomationRuns: mocks.listAutomationRuns,
}));
vi.mock("../run-now.js", () => ({
  queueAutomationRunNow: mocks.queueAutomationRunNow,
}));

import listAutomationRuns from "./list-automation-runs.js";
import listRecurringJobs from "./list-recurring-jobs.js";
import manageRecurringJob from "./manage-recurring-job.js";
import runAutomationNow from "./run-automation-now.js";

const ctx = { caller: "frontend" as const, userEmail: "alice@example.com" };
const content = `---
schedule: "0 9 * * *"
enabled: true
createdBy: owner@example.com
---

Summarize the inbox.`;
const resource = {
  id: "job-1",
  owner: "owner@example.com",
  path: "jobs/daily.md",
  content,
};

function access(role: "owner" | "collaborate" | "view") {
  return {
    resource,
    name: "daily",
    classification: { kind: "job" },
    meta: {
      schedule: "0 9 * * *",
      enabled: true,
      triggerType: "schedule",
      createdBy: "owner@example.com",
    },
    body: "Summarize the inbox.",
    scope: "personal",
    canUpdate: role !== "view",
    effectiveRole: role,
    capabilities: {
      canEdit: role !== "view",
      canOperate: role !== "view",
      canDelete: role === "owner",
      canManageSharing: role === "owner",
    },
  };
}

describe("recurring job actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAccessibleAutomationDefinitions.mockResolvedValue([
      access("collaborate"),
    ]);
    mocks.resolveAutomationAccess.mockResolvedValue(access("owner"));
    mocks.resourceGetByPath.mockResolvedValue(resource);
    mocks.resourcePut.mockResolvedValue(undefined);
    mocks.resourceDelete.mockResolvedValue(true);
    mocks.listAutomationRuns.mockResolvedValue([{ id: "run-1" }]);
    mocks.queueAutomationRunNow.mockResolvedValue({
      queued: true,
      runId: "run-1",
      automationRunId: "run-1",
    });
  });

  it("lists legacy jobs with stable ids and centralized capabilities", async () => {
    const result = await listRecurringJobs.run({}, ctx);
    expect(result).toEqual([
      expect.objectContaining({
        resourceId: "job-1",
        classification: "recurring-job",
        effectiveRole: "collaborate",
        capabilities: expect.objectContaining({
          canEdit: true,
          canDelete: false,
        }),
      }),
    ]);
  });

  it("enforces View, Collaborate, and Owner mutation rules", async () => {
    mocks.resolveAutomationAccess.mockResolvedValueOnce(access("view"));
    await expect(
      manageRecurringJob.run(
        { operation: "update", resourceId: "job-1", enabled: false },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    mocks.resolveAutomationAccess.mockResolvedValueOnce(access("collaborate"));
    await manageRecurringJob.run(
      { operation: "update", resourceId: "job-1", enabled: false },
      ctx,
    );
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "owner@example.com",
      "jobs/daily.md",
      expect.stringContaining("enabled: false"),
    );

    mocks.resolveAutomationAccess.mockResolvedValueOnce(access("collaborate"));
    await expect(
      manageRecurringJob.run({ operation: "delete", resourceId: "job-1" }, ctx),
    ).rejects.toMatchObject({ statusCode: 403 });

    mocks.resolveAutomationAccess.mockResolvedValueOnce(access("owner"));
    await manageRecurringJob.run(
      { operation: "delete", resourceId: "job-1" },
      ctx,
    );
    expect(mocks.resourceDelete).toHaveBeenCalledWith("job-1");
  });

  it("preserves name and scope compatibility", async () => {
    await manageRecurringJob.run(
      {
        operation: "update",
        name: "daily",
        scope: "personal",
        enabled: false,
      },
      ctx,
    );
    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "alice@example.com",
      "jobs/daily.md",
    );
    expect(mocks.resolveAutomationAccess).toHaveBeenCalledWith(
      { userEmail: "alice@example.com" },
      "job-1",
    );
  });

  it("allows View to read history but not run now", async () => {
    mocks.resolveAutomationAccess.mockResolvedValueOnce(access("view"));
    await expect(
      listAutomationRuns.run({ resourceId: "job-1" }, ctx),
    ).resolves.toEqual([{ id: "run-1" }]);
    expect(mocks.listAutomationRuns).toHaveBeenCalledWith({
      owners: ["owner@example.com"],
      automation: "daily",
      limit: undefined,
    });

    mocks.queueAutomationRunNow.mockRejectedValueOnce(
      Object.assign(new Error("Collaborate access is required"), {
        statusCode: 403,
      }),
    );
    await expect(
      runAutomationNow.run({ resourceId: "job-1" }, ctx),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("keeps all recurring-job actions frontend-only", () => {
    expect(listRecurringJobs.agentTool).toBe(false);
    expect(manageRecurringJob.agentTool).toBe(false);
    expect(listAutomationRuns.agentTool).toBe(false);
    expect(runAutomationNow.agentTool).toBe(false);
  });
});
