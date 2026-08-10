import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());
const authorizeJobMutationMock = vi.hoisted(() => vi.fn());
const listAutomationRunsMock = vi.hoisted(() => vi.fn());

vi.mock("../../resources/store.js", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceList: resourceListMock,
  resourceGetByPath: resourceGetByPathMock,
  resourcePut: resourcePutMock,
  resourceDelete: resourceDeleteMock,
}));

vi.mock("../tools.js", () => ({
  authorizeJobMutation: authorizeJobMutationMock,
  jobBelongsToApp: (meta: { appId?: string }, appId?: string) =>
    !meta.appId || meta.appId === appId?.trim(),
}));

vi.mock("../run-history.js", () => ({
  listAutomationRuns: listAutomationRunsMock,
}));

import { serverTimezone } from "../cron.js";
import listAutomationRuns from "./list-automation-runs.js";
import listRecurringJobs from "./list-recurring-jobs.js";
import manageRecurringJob from "./manage-recurring-job.js";

const ctx = { caller: "frontend" as const, userEmail: "alice@example.com" };
const jobContent = `---
schedule: "0 9 * * *"
enabled: true
createdBy: alice@example.com
nextRun: 2030-01-01T09:00:00.000Z
---

Summarize my inbox.
`;
const automationContent = `---
schedule: ""
enabled: true
triggerType: event
event: mail.received
mode: agentic
---

Notify me.
`;

describe("recurring jobs actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceListMock.mockResolvedValue([]);
    resourceGetByPathMock.mockResolvedValue(null);
    resourcePutMock.mockResolvedValue(undefined);
    resourceDeleteMock.mockResolvedValue(true);
    authorizeJobMutationMock.mockResolvedValue(null);
    listAutomationRunsMock.mockResolvedValue([]);
  });

  it("exposes a frontend-only GET list and a frontend-only mutation", () => {
    expect(listRecurringJobs.http).toEqual({ method: "GET" });
    expect(listRecurringJobs.agentTool).toBe(false);
    expect(manageRecurringJob.agentTool).toBe(false);
  });

  it("lists only recurring jobs in the requested personal scope", async () => {
    resourceListMock.mockResolvedValue([
      { path: "jobs/daily.md" },
      { path: "jobs/automation.md" },
      { path: "jobs/.keep" },
    ]);
    resourceGetByPathMock.mockImplementation(
      async (_owner: string, path: string) =>
        path.endsWith("daily.md")
          ? {
              id: "job-1",
              owner: "alice@example.com",
              path,
              content: jobContent,
            }
          : {
              id: "automation-1",
              owner: "alice@example.com",
              path,
              content: automationContent,
            },
    );

    const jobs = await listRecurringJobs.run({ scope: "personal" }, ctx);

    expect(resourceListMock).toHaveBeenCalledWith("alice@example.com", "jobs/");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: "job-1",
      name: "daily",
      scheduleDescription: `Every day at 9 AM (${serverTimezone()})`,
      instructions: "Summarize my inbox.",
      scope: "personal",
    });
  });

  it("keeps app-owned recurring jobs in their app list", async () => {
    resourceListMock.mockResolvedValue([
      { path: "jobs/mail-daily.md" },
      { path: "jobs/calendar-daily.md" },
    ]);
    resourceGetByPathMock.mockImplementation(
      async (_owner: string, path: string) => ({
        id: path,
        owner: "alice@example.com",
        path,
        content: jobContent.replace(
          "---\n\n",
          `appId: ${path.includes("mail") ? "mail" : "calendar"}\n---\n\n`,
        ),
      }),
    );

    const jobs = await listRecurringJobs.run(
      { scope: "personal" },
      { ...ctx, appId: "mail" },
    );

    expect(jobs.map((job) => job.name)).toEqual(["mail-daily"]);
  });

  it("uses the active organization owner and returns an empty result without an org", async () => {
    await expect(
      listRecurringJobs.run(
        { scope: "organization" },
        { ...ctx, orgId: "org-1" },
      ),
    ).resolves.toEqual([]);
    expect(resourceListMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/",
    );

    resourceListMock.mockClear();
    await expect(
      listRecurringJobs.run({ scope: "organization" }, ctx),
    ).resolves.toEqual([]);
    expect(resourceListMock).not.toHaveBeenCalled();
  });

  it("scopes run history to the app context and lets Dispatch inspect a selected app", async () => {
    await listAutomationRuns.run(
      { name: "daily", scope: "personal" },
      { ...ctx, appId: "mail" },
    );
    expect(listAutomationRunsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owners: ["alice@example.com"],
        automation: "daily",
        appId: "mail",
      }),
    );

    await listAutomationRuns.run(
      { name: "daily", scope: "personal", appId: "calendar" },
      { ...ctx, appId: "dispatch" },
    );
    expect(listAutomationRunsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ appId: "calendar" }),
    );
  });

  it("does not expose a stale next run for a disabled recurring job", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/paused.md" }]);
    resourceGetByPathMock.mockResolvedValue({
      id: "job-paused",
      owner: "alice@example.com",
      path: "jobs/paused.md",
      content: jobContent.replace("enabled: true", "enabled: false"),
    });

    const jobs = await listRecurringJobs.run({ scope: "personal" }, ctx);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.enabled).toBe(false);
    expect(jobs[0]?.nextRun).toBeNull();
  });

  it("optimistically supported management writes preserve the scoped owner", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "job-1",
      owner: "__organization__:org-1",
      path: "jobs/daily.md",
      content: jobContent,
    });

    await manageRecurringJob.run(
      {
        operation: "update",
        name: "daily",
        scope: "organization",
        enabled: false,
      },
      { ...ctx, orgId: "org-1" },
    );

    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/daily.md",
    );
    expect(resourcePutMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/daily.md",
      expect.stringContaining("enabled: false"),
    );
  });

  it("rejects an unauthorized mutation before writing", async () => {
    authorizeJobMutationMock.mockResolvedValue(
      "Only the job's creator (or an org admin) can update or delete it.",
    );
    resourceGetByPathMock.mockResolvedValue({
      id: "job-1",
      owner: "__organization__:org-1",
      path: "jobs/daily.md",
      content: jobContent,
    });

    await expect(
      manageRecurringJob.run(
        {
          operation: "update",
          name: "daily",
          scope: "organization",
          enabled: false,
        },
        { ...ctx, orgId: "org-1" },
      ),
    ).rejects.toThrow("Only the job's creator");
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("passes app ownership to recurring-job mutations", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "job-1",
      owner: "alice@example.com",
      path: "jobs/daily.md",
      content: jobContent,
    });

    await manageRecurringJob.run(
      {
        operation: "update",
        name: "daily",
        scope: "personal",
        enabled: false,
      },
      { ...ctx, appId: "mail" },
    );

    expect(authorizeJobMutationMock).toHaveBeenCalledWith(
      "alice@example.com",
      expect.objectContaining({ schedule: "0 9 * * *" }),
      "mail",
    );
  });
});
