import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAutomationsForOwner,
  setAutomationEnabledForOwner,
} from "./routes.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const refreshEventSubscriptionsMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../resources/store.js")>();
  return {
    ...actual,
    SHARED_OWNER: "__shared__",
    resourceListAllOwners: resourceListAllOwnersMock,
    resourceGetByPath: resourceGetByPathMock,
    resourcePut: resourcePutMock,
  };
});

vi.mock("./dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dispatcher.js")>();
  return {
    ...actual,
    refreshEventSubscriptions: refreshEventSubscriptionsMock,
  };
});

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: unknown[]) => getOrgContextMock(...args),
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => ({ execute: dbExecuteMock }),
  };
});

describe("automations route helpers", () => {
  const owner = "alice@example.com";
  const event = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    resourceListAllOwnersMock.mockResolvedValue([]);
    resourceGetByPathMock.mockResolvedValue(null);
    resourcePutMock.mockResolvedValue(undefined);
    refreshEventSubscriptionsMock.mockResolvedValue(undefined);
    getOrgContextMock.mockResolvedValue({ orgId: "org-1" });
    dbExecuteMock.mockResolvedValue({ rows: [] });
  });

  it("lists personal and shared jobs with run status fields", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "owned",
        owner,
        path: "jobs/owned.md",
        content: `---
schedule: "0 9 * * 1-5"
timezone: UTC
enabled: true
lastRun: 2026-06-18T15:00:00.000Z
lastStatus: error
lastError: "Calendar token expired"
nextRun: 2026-06-19T16:00:00.000Z
createdBy: ${owner}
---

Check the calendar.`,
      },
      {
        id: "shared",
        owner: "__shared__",
        path: "jobs/shared.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
createdBy: bob@example.com
---

Shared body.`,
      },
      {
        id: "other",
        owner: "bob@example.com",
        path: "jobs/other.md",
        content: "hidden",
      },
      {
        id: "other-org-legacy",
        owner: "__shared__",
        path: "jobs/other-org-legacy.md",
        content: `---
schedule: "0 10 * * *"
enabled: true
createdBy: bob@example.com
orgId: org-2
---

Hidden legacy organization job.`,
      },
    ]);

    const result = await listAutomationsForOwner(event, owner);

    expect(result.map((item) => item.name)).toEqual(["owned", "shared"]);
    expect(result[0]).toMatchObject({
      enabled: true,
      lastStatus: "error",
      lastError: "Calendar token expired",
      lastRun: "2026-06-18T15:00:00.000Z",
      scheduleDescription: "Every weekday at 9 AM (UTC)",
      canUpdate: true,
    });
    expect(result[0].nextRun).toBeTruthy();
    expect(result[0].nextRun).not.toBe("2026-06-19T16:00:00.000Z");
    expect(result[1]).toMatchObject({
      triggerType: "event",
      event: "test.event.fired",
      canUpdate: false,
    });
  });

  it("lists manual automations without automatic trigger fields", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "manual",
        owner,
        path: "jobs/on-demand.md",
        content: `---
schedule: "0 9 * * *"
timezone: UTC
enabled: true
triggerType: manual
event: stale.event
condition: stale condition
nextRun: 2030-01-01T09:00:00.000Z
mode: agentic
createdBy: ${owner}
---

Run on demand.`,
      },
    ]);

    const [automation] = await listAutomationsForOwner(event, owner);

    expect(automation).toMatchObject({
      triggerType: "manual",
      enabled: true,
    });
    expect(automation).not.toHaveProperty("event");
    expect(automation).not.toHaveProperty("schedule");
    expect(automation).not.toHaveProperty("timezone");
    expect(automation).not.toHaveProperty("scheduleDescription");
    expect(automation).not.toHaveProperty("condition");
    expect(automation).not.toHaveProperty("nextRun");
  });

  it("lists and updates automations for the active organization only", async () => {
    const organizationOwner = "__organization__:org-1";
    const organizationResource = {
      id: "organization",
      owner: organizationOwner,
      path: "jobs/organization.md",
      content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
createdBy: bob@example.com
orgId: "org-1"
runAs: creator
---

Organization body.`,
    };
    resourceListAllOwnersMock.mockResolvedValue([
      organizationResource,
      {
        id: "other-organization",
        owner: "__organization__:org-2",
        path: "jobs/other.md",
        content: "hidden",
      },
    ]);
    dbExecuteMock.mockResolvedValue({ rows: [{ role: "admin" }] });

    const result = await listAutomationsForOwner(event, owner);

    expect(result.map((item) => item.name)).toEqual(["organization"]);
    expect(result[0]).toMatchObject({
      owner: organizationOwner,
      canUpdate: true,
      triggerType: "event",
    });

    resourceGetByPathMock.mockResolvedValue(organizationResource);
    await setAutomationEnabledForOwner(event, owner, {
      owner: organizationOwner,
      path: "jobs/organization.md",
      enabled: false,
    });
    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      organizationOwner,
      "jobs/organization.md",
    );
    expect(resourcePutMock).toHaveBeenCalledWith(
      organizationOwner,
      "jobs/organization.md",
      expect.stringContaining("enabled: false"),
    );
  });

  it("toggles a personal automation and refreshes event subscriptions", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "owned",
      owner,
      path: "jobs/owned.md",
      content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
createdBy: ${owner}
---

Check the event.`,
    });

    const result = await setAutomationEnabledForOwner(event, owner, {
      owner,
      path: "jobs/owned.md",
      enabled: false,
    });

    expect(resourceGetByPathMock).toHaveBeenCalledWith(owner, "jobs/owned.md");
    expect(resourcePutMock).toHaveBeenCalledWith(
      owner,
      "jobs/owned.md",
      expect.stringContaining("enabled: false"),
    );
    expect(refreshEventSubscriptionsMock).toHaveBeenCalled();
    expect(result.enabled).toBe(false);
  });

  it("preserves a legacy scheduled job classification when toggled", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "legacy",
      owner,
      path: "jobs/legacy.md",
      content: `---
schedule: "0 9 * * *"
enabled: true
model: "claude-sonnet-4-5"
---

Run the legacy job.`,
    });

    await setAutomationEnabledForOwner(event, owner, {
      owner,
      path: "jobs/legacy.md",
      enabled: false,
    });

    const updatedContent = resourcePutMock.mock.calls[0][2] as string;
    expect(updatedContent).toContain("enabled: false");
    expect(updatedContent).toContain('model: "claude-sonnet-4-5"');
    expect(updatedContent).not.toContain("triggerType:");
  });

  it("rejects shared automation updates from non-creators who are not org admins", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "shared",
      owner: "__shared__",
      path: "jobs/shared.md",
      content: `---
schedule: "0 9 * * *"
enabled: true
createdBy: bob@example.com
orgId: org-1
---

Shared body.`,
    });
    dbExecuteMock.mockResolvedValue({ rows: [] });

    await expect(
      setAutomationEnabledForOwner(event, owner, {
        owner: "__shared__",
        path: "jobs/shared.md",
        enabled: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });
});
