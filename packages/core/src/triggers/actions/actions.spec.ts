import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());
const refreshEventSubscriptionsMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: executeMock }),
}));

vi.mock("../../resources/store.js", () => ({
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceList: resourceListMock,
  resourceGetByPath: resourceGetByPathMock,
  resourcePut: resourcePutMock,
  resourceDelete: resourceDeleteMock,
}));

vi.mock("../dispatcher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dispatcher.js")>()),
  refreshEventSubscriptions: refreshEventSubscriptionsMock,
}));

import { serverTimezone } from "../../jobs/cron.js";
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
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
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
      scheduleDescription: `Every day at 9 AM (${serverTimezone()})`,
      scope: "personal",
    });
  });

  it("keeps app-owned automations in their app list", async () => {
    resourceListMock.mockResolvedValue([
      { path: "jobs/mail-digest.md" },
      { path: "jobs/calendar-digest.md" },
    ]);
    resourceGetByPathMock.mockImplementation(
      async (_owner: string, path: string) => ({
        id: path,
        owner: "alice@example.com",
        path,
        content: automationContent.replace(
          "---\n\n",
          `appId: ${path.includes("mail") ? "mail" : "calendar"}\n---\n\n`,
        ),
      }),
    );

    const automations = await listAutomations.run(
      { scope: "personal" },
      { ...ctx, appId: "mail" },
    );

    expect(automations.map((automation) => automation.name)).toEqual([
      "mail-digest",
    ]);
  });

  it("lists organization automations for a current member", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/digest.md" }]);
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "__organization__:org-1",
      path: "jobs/digest.md",
      content: automationContent.replace(
        "createdBy: alice@example.com",
        'appId: "mail"\ncreatedBy: alice@example.com\norgId: "org-1"\nrunAs: creator',
      ),
    });

    const automations = await listAutomations.run(
      { scope: "organization" },
      { ...ctx, orgId: "org-1", appId: "mail" },
    );

    expect(resourceListMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/",
    );
    expect(automations).toHaveLength(1);
    expect(automations[0]).toMatchObject({
      name: "digest",
      scope: "organization",
      canUpdate: true,
    });
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

  it("rejects canonical automation mutations from another app", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "alice@example.com",
      path: "jobs/digest.md",
      content: automationContent.replace("---\n\n", "appId: calendar\n---\n\n"),
    });

    await expect(
      manageAutomation.run(
        {
          operation: "update",
          name: "digest",
          scope: "personal",
          enabled: false,
        },
        { ...ctx, appId: "mail" },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("updates organization automations as their current creator", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "__organization__:org-1",
      path: "jobs/digest.md",
      content: automationContent.replace(
        "createdBy: alice@example.com",
        'appId: "mail"\ncreatedBy: alice@example.com\norgId: "org-1"\nrunAs: creator',
      ),
    });

    await manageAutomation.run(
      {
        operation: "update",
        name: "digest",
        scope: "organization",
        enabled: false,
      },
      { ...ctx, orgId: "org-1", appId: "mail" },
    );

    expect(resourcePutMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/digest.md",
      expect.stringContaining("runAs: creator"),
    );
  });
});
