import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());
const refreshEventSubscriptionsMock = vi.hoisted(() => vi.fn());

vi.mock("../../resources/store.js", () => ({
  resourceList: resourceListMock,
  resourceGetByPath: resourceGetByPathMock,
  resourcePut: resourcePutMock,
  resourceDelete: resourceDeleteMock,
}));

vi.mock("../dispatcher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dispatcher.js")>()),
  refreshEventSubscriptions: refreshEventSubscriptionsMock,
}));

import listAutomations from "./list-automations.js";
import manageAutomation from "./manage-automation.js";

const ctx = { caller: "frontend" as const, userEmail: "alice@example.com" };
const automationContent = `---
schedule: "0 9 * * *"
enabled: true
triggerType: schedule
mode: agentic
createdBy: alice@example.com
---

Send me a daily digest.
`;
const jobContent = `---
schedule: "0 9 * * *"
enabled: true
---

Run this as a recurring job.
`;

describe("automation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceListMock.mockResolvedValue([]);
    resourceGetByPathMock.mockResolvedValue(null);
    resourcePutMock.mockResolvedValue(undefined);
    resourceDeleteMock.mockResolvedValue(true);
    refreshEventSubscriptionsMock.mockResolvedValue(undefined);
  });

  it("exposes a frontend-only GET list and a frontend-only mutation", () => {
    expect(listAutomations.http).toEqual({ method: "GET" });
    expect(listAutomations.agentTool).toBe(false);
    expect(manageAutomation.agentTool).toBe(false);
  });

  it("lists personal automations but filters recurring jobs", async () => {
    resourceListMock.mockResolvedValue([
      { path: "jobs/digest.md" },
      { path: "jobs/recurring.md" },
    ]);
    resourceGetByPathMock.mockImplementation(
      async (_owner: string, path: string) =>
        path.endsWith("digest.md")
          ? {
              id: "automation-1",
              owner: "alice@example.com",
              path,
              content: automationContent,
            }
          : {
              id: "job-1",
              owner: "alice@example.com",
              path,
              content: jobContent,
            },
    );

    const automations = await listAutomations.run({ scope: "personal" }, ctx);

    expect(resourceListMock).toHaveBeenCalledWith("alice@example.com", "jobs/");
    expect(automations).toHaveLength(1);
    expect(automations[0]).toMatchObject({
      id: "automation-1",
      name: "digest",
      triggerType: "schedule",
      scheduleDescription: "Every day at 9 AM",
      scope: "personal",
    });
  });

  it("truthfully returns no organization automations", async () => {
    await expect(
      listAutomations.run(
        { scope: "organization" },
        { ...ctx, orgId: "org-1" },
      ),
    ).resolves.toEqual([]);
    expect(resourceListMock).not.toHaveBeenCalled();
  });

  it("does not expose a stale next run for a disabled automation", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/digest.md" }]);
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-paused",
      owner: "alice@example.com",
      path: "jobs/digest.md",
      content: automationContent
        .replace("enabled: true", "enabled: false")
        .replace("---\n\n", "nextRun: 2030-01-01T09:00:00.000Z\n---\n\n"),
    });

    const automations = await listAutomations.run({ scope: "personal" }, ctx);

    expect(automations).toHaveLength(1);
    expect(automations[0]?.enabled).toBe(false);
    expect(automations[0]?.nextRun).toBeNull();
  });

  it("updates and deletes only personal automations", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "alice@example.com",
      path: "jobs/digest.md",
      content: automationContent,
    });

    await manageAutomation.run(
      {
        operation: "update",
        name: "digest",
        scope: "personal",
        enabled: false,
      },
      ctx,
    );
    expect(resourcePutMock).toHaveBeenCalledWith(
      "alice@example.com",
      "jobs/digest.md",
      expect.stringContaining("enabled: false"),
    );

    await manageAutomation.run(
      { operation: "delete", name: "digest", scope: "personal" },
      ctx,
    );
    expect(resourceDeleteMock).toHaveBeenCalledWith("automation-1");
    expect(refreshEventSubscriptionsMock).toHaveBeenCalled();
  });

  it("rejects organization mutations because automations are personal today", async () => {
    await expect(
      manageAutomation.run(
        {
          operation: "update",
          name: "digest",
          scope: "organization",
          enabled: false,
        },
        { ...ctx, orgId: "org-1" },
      ),
    ).rejects.toThrow("Automations are personal today");
  });
});
