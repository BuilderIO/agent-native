import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "BIGINT",
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(),
  ensureIndexExists: vi.fn(),
  ensureColumnExists: vi.fn(),
}));

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: getUserSettingMock,
}));

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceDelete: resourceDeleteMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceList: resourceListMock,
  resourcePut: resourcePutMock,
}));

import {
  automationMatchesEventOwner,
  canQueueAutomationRunNow,
  canUpdateAutomationResource,
  defineAutomation,
  deleteAutomation,
  listAutomationDefinitions,
  resolveAutomationExecutionIdentity,
  updateAutomation,
} from "./service.js";

const actor = { userEmail: "Alice@Example.com", orgId: "org-1", appId: "mail" };
const orgOwner = "__organization__:org-1";

function resource(content: string, owner = orgOwner) {
  return {
    id: "automation-1",
    owner,
    path: "jobs/notify.md",
    content,
    mimeType: "text/markdown",
    size: content.length,
    createdAt: 1,
    updatedAt: 1,
    createdBy: "agent" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

const eventAutomation = `---
schedule: ""
enabled: true
triggerType: event
event: mail.received
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
model: "claude-sonnet"
mcpTools: ["mcp__mail__read"]
deliveryPlatform: "slack"
deliveryDestination: "channel-1"
---

Send the notification.`;

const factoryAutomation = `---
schedule: "*/5 * * * *"
enabled: true
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: factory
domain: factory
runAs: creator
---

Observe Slack.`;

describe("automation domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    resourceDeleteMock.mockResolvedValue(true);
    resourceGetByPathMock.mockResolvedValue(null);
    resourceListMock.mockResolvedValue([]);
    resourcePutMock.mockResolvedValue(undefined);
    getUserSettingMock.mockResolvedValue(null);
  });

  it("schedules a new automation in the timezone the creator saved", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "America/New_York" });
    resourceGetByPathMock
      .mockResolvedValueOnce(null)
      .mockImplementation(async (owner: string) =>
        resource(resourcePutMock.mock.calls.at(-1)?.[2] as string, owner),
      );

    const definition = await defineAutomation(actor, {
      name: "digest",
      scope: "organization",
      triggerType: "schedule",
      schedule: "0 8 * * *",
      body: "Send the digest.",
    });

    expect(definition.meta.timezone).toBe("America/New_York");
    // 8am Eastern is 12:00 or 13:00 UTC depending on DST, never 08:00 UTC.
    expect(definition.meta.nextRun).toBeTruthy();
    expect(new Date(definition.meta.nextRun as string).getUTCHours()).not.toBe(
      8,
    );
  });

  it("defaults a new scheduled automation to an hourly cadence", async () => {
    resourceGetByPathMock
      .mockResolvedValueOnce(null)
      .mockImplementation(async (owner: string) =>
        resource(resourcePutMock.mock.calls.at(-1)?.[2] as string, owner),
      );

    const definition = await defineAutomation(actor, {
      name: "hourly-check",
      scope: "organization",
      triggerType: "schedule",
      body: "Check for changed work.",
    });

    expect(definition.meta.schedule).toBe("0 * * * *");
    expect(resourcePutMock).toHaveBeenCalledWith(
      orgOwner,
      "jobs/hourly-check.md",
      expect.stringContaining('schedule: "0 * * * *"'),
    );
  });

  it("creates an organization event automation owned by the org but run as its creator", async () => {
    resourceGetByPathMock
      .mockResolvedValueOnce(null)
      .mockImplementation(async (owner: string, path: string) =>
        resource(resourcePutMock.mock.calls.at(-1)?.[2] as string, owner),
      );

    const definition = await defineAutomation(actor, {
      name: "notify",
      scope: "organization",
      triggerType: "event",
      event: "mail.received",
      body: "Send the notification.",
      model: "claude-sonnet",
      mcpTools: ["mcp__mail__read"],
      delivery: { platform: "slack", destination: "channel-1" },
    });

    expect(resourcePutMock).toHaveBeenCalledWith(
      orgOwner,
      "jobs/notify.md",
      expect.stringMatching(
        /appId: "mail"[\s\S]*createdBy: alice@example\.com[\s\S]*orgId: "org-1"[\s\S]*runAs: creator/,
      ),
    );
    expect(definition.meta).toMatchObject({
      triggerType: "event",
      createdBy: "alice@example.com",
      orgId: "org-1",
      appId: "mail",
      runAs: "creator",
      model: "claude-sonnet",
      mcpTools: ["mcp__mail__read"],
      deliveryPlatform: "slack",
      deliveryDestination: "channel-1",
    });
  });

  it("fails closed when the caller is not a current organization member", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await expect(
      defineAutomation(actor, {
        name: "notify",
        scope: "organization",
        triggerType: "event",
        event: "mail.received",
        body: "Send the notification.",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("lists org automations for members and computes creator/admin mutation rights", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/notify.md" }]);
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    const creatorItems = await listAutomationDefinitions(actor, "organization");
    expect(creatorItems).toHaveLength(1);
    expect(creatorItems[0]).toMatchObject({
      name: "notify",
      scope: "organization",
      canUpdate: true,
    });

    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const adminItems = await listAutomationDefinitions(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      "organization",
    );
    expect(adminItems[0]?.canUpdate).toBe(true);

    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const memberItems = await listAutomationDefinitions(
      { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
      "organization",
    );
    expect(memberItems[0]?.canUpdate).toBe(false);
  });

  it("lets a Factory org member queue Run now without canUpdate", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const factoryResource = resource(factoryAutomation);

    expect(
      await canUpdateAutomationResource(
        { userEmail: "member@example.com", orgId: "org-1", appId: "factory" },
        factoryResource,
      ),
    ).toBe(false);
    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "factory" },
        factoryResource,
        "organization",
      ),
    ).toBe(true);
  });

  it("lets a Factory org member queue a recovered folder job that lost domain", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const recovered = resource(`---
enabled: true
createdBy: alice@example.com
orgId: "org-1"
---

Observe Slack.`);
    recovered.path = "jobs/factories/demo-factory/factory-slack-feedback.md";

    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "factory" },
        recovered,
        "organization",
      ),
    ).toBe(true);
    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
        recovered,
        "organization",
      ),
    ).toBe(false);
  });

  it("refuses a personal job on a Factory-looking path", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const personal = resource(
      `---
enabled: true
createdBy: alice@example.com
orgId: "org-1"
---

Observe Slack.`,
      "alice@example.com",
    );
    personal.path = "jobs/factories/demo-factory/factory-slack-feedback.md";

    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "factory" },
        personal,
        "organization",
      ),
    ).toBe(false);
  });

  it("refuses a Factory-path job whose orgId does not match its owner", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const mismatched = resource(`---
enabled: true
createdBy: alice@example.com
orgId: "org-2"
---

Observe Slack.`);
    mismatched.path = "jobs/factories/demo-factory/factory-slack-feedback.md";

    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "factory" },
        mismatched,
        "organization",
      ),
    ).toBe(false);
  });

  it("refuses a recovered Factory-folder job owned by another app", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const calendarJob = resource(`---
enabled: true
createdBy: alice@example.com
orgId: "org-1"
appId: calendar
---

Send the digest.`);
    calendarJob.path = "jobs/factories/demo-factory/calendar-digest.md";

    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "factory" },
        calendarJob,
        "organization",
      ),
    ).toBe(false);
  });

  it("still refuses a Mail org member who is not the creator or admin", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });

    expect(
      await canQueueAutomationRunNow(
        { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
        resource(eventAutomation),
        "organization",
      ),
    ).toBe(false);
  });

  it("lets an org admin update or delete without retargeting the creator", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      {
        name: "notify",
        scope: "organization",
        enabled: false,
        model: "claude-opus",
        mcpTools: ["mcp__mail__read", "mcp__mail__send"],
      },
    );
    expect(updated.meta).toMatchObject({
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
      enabled: false,
      model: "claude-opus",
      mcpTools: ["mcp__mail__read", "mcp__mail__send"],
    });
    expect(resourcePutMock).toHaveBeenCalledWith(
      orgOwner,
      "jobs/notify.md",
      expect.stringContaining("createdBy: alice@example.com"),
    );

    await deleteAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      "organization",
      "notify",
    );
    expect(resourceDeleteMock).toHaveBeenCalledWith("automation-1");
  });

  it("rejects an ordinary org member mutating another creator's automation", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    await expect(
      updateAutomation(
        { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
        {
          name: "notify",
          scope: "organization",
          enabled: false,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("revalidates creator existence and membership for execution and scopes events to the creator", async () => {
    executeMock.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes('FROM "user"')
        ? { rows: [{ exists: 1 }] }
        : { rows: [{ role: "member" }] },
    );
    const result = await resolveAutomationExecutionIdentity(orgOwner, {
      schedule: "",
      enabled: true,
      triggerType: "event",
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
    });

    expect(result).toEqual({
      ok: true,
      identity: {
        userEmail: "alice@example.com",
        orgId: "org-1",
        eventOwner: "alice@example.com",
      },
    });
    if (result.ok) {
      expect(
        automationMatchesEventOwner(result.identity, "Alice@Example.com"),
      ).toBe(true);
      expect(
        automationMatchesEventOwner(result.identity, "bob@example.com"),
      ).toBe(false);
      expect(automationMatchesEventOwner(result.identity, undefined)).toBe(
        false,
      );
    }

    executeMock
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      resolveAutomationExecutionIdentity(orgOwner, {
        schedule: "",
        enabled: true,
        triggerType: "event",
        createdBy: "alice@example.com",
        orgId: "org-1",
        runAs: "creator",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("no longer a member"),
    });
  });

  it("rejects organization execution that is not explicitly creator-run", async () => {
    await expect(
      resolveAutomationExecutionIdentity(orgOwner, {
        schedule: "",
        enabled: true,
        triggerType: "event",
        createdBy: "alice@example.com",
        orgId: "org-1",
        runAs: "shared",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "Organization automations must run as their creator.",
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
