import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
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
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

import { nextOccurrence } from "../jobs/cron.js";
import { parseJobResource } from "../jobs/frontmatter.js";
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
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => ({
        id: "automation-1",
        owner: input.owner,
        path: input.path,
        content: input.content,
      }),
    );
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
        reasoningEffort: "high",
        mcpTools: ["mcp__mail__read", "mcp__mail__send"],
      },
    );
    expect(updated.meta).toMatchObject({
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
      enabled: false,
      model: "claude-opus",
      reasoningEffort: "high",
      mcpTools: ["mcp__mail__read", "mcp__mail__send"],
    });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: orgOwner,
        path: "jobs/notify.md",
        content: expect.stringContaining("createdBy: alice@example.com"),
      }),
    );

    const updatedContent = resourcePutIfCurrentMock.mock.calls[0][0]
      .content as string;
    expect(updatedContent).toContain('deliveryPlatform: "slack"');
    expect(updatedContent).toContain('deliveryDestination: "channel-1"');
    expect(updatedContent).toContain("mcp__mail__send");
    expect(updatedContent.indexOf("deliveryPlatform:")).toBeGreaterThan(
      updatedContent.indexOf("mcpTools:"),
    );

    await deleteAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      "organization",
      "notify",
    );
    expect(resourceDeleteMock).toHaveBeenCalledWith("automation-1");
  });

  it("lifts a framework pause when the owner enables the automation again", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const pausedAutomation = eventAutomation
      .replace("enabled: true", "enabled: false")
      .replace(
        "runAs: creator",
        [
          "runAs: creator",
          "lastStatus: paused",
          'lastError: "Paused after 3 consecutive missing_tools failures: gone."',
          'lastErrorCode: "missing_tools"',
          "consecutiveFailures: 3",
          'pausedReason: "missing_tools"',
          'pausedAt: "2026-10-01T12:00:00.000Z"',
        ].join("\n"),
      );
    resourceGetByPathMock.mockResolvedValue(resource(pausedAutomation));

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: true },
    );

    const content = resourcePutIfCurrentMock.mock.calls[0][0].content as string;
    expect(content).toContain("enabled: true");
    for (const field of [
      "lastStatus",
      "lastError",
      "lastErrorCode",
      "consecutiveFailures",
      "pausedReason",
      "pausedAt",
    ]) {
      expect(content).not.toContain(`${field}:`);
    }
    expect(updated.meta.pausedReason).toBeUndefined();
    expect(updated.meta.enabled).toBe(true);
  });

  it("keeps a healthy automation's last status when it is enabled while already enabled", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(
      resource(
        eventAutomation.replace(
          "runAs: creator",
          "runAs: creator\nlastStatus: success",
        ),
      ),
    );

    await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: true },
    );

    expect(resourcePutIfCurrentMock.mock.calls[0][0].content).toContain(
      "lastStatus: success",
    );
  });

  it("re-applies an update over run state written while it was read", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const withRun = (status: string, runAt: string) =>
      resource(
        eventAutomation.replace(
          "runAs: creator",
          `runAs: creator\nlastStatus: ${status}\nlastRun: "${runAt}"`,
        ),
      );
    const before = withRun("success", "2026-10-01T00:00:00.000Z");
    const concurrentRun = {
      ...withRun("running", "2026-10-07T09:00:00.000Z"),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(concurrentRun);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentRun,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: false },
    );

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(2);
    const written = resourcePutIfCurrentMock.mock.calls[1][0].content as string;
    expect(written).toContain("enabled: false");
    expect(written).toContain("lastStatus: running");
    expect(written).toContain("2026-10-07T09:00:00.000Z");
    // The caller reports what landed, not the pre-conflict snapshot.
    expect(updated.meta.enabled).toBe(false);
    expect(updated.meta.lastStatus).toBe("running");
    expect(updated.resource.content).toBe(written);
  });

  it("re-derives nextRun over a schedule another writer changed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    try {
      executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
      const scheduled = (schedule: string) =>
        resource(`---
schedule: "${schedule}"
timezone: UTC
enabled: true
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
---

Send the digest.`);
      const before = scheduled("0 9 * * *");
      const concurrentSchedule = { ...scheduled("0 21 * * *"), updatedAt: 2 };
      resourceGetByPathMock
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(concurrentSchedule);
      resourcePutIfCurrentMock
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(
          async (input: { owner: string; path: string; content: string }) => ({
            ...concurrentSchedule,
            content: input.content,
          }),
        );

      await updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        { name: "notify", scope: "organization", timezone: "Asia/Tokyo" },
      );

      const written = resourcePutIfCurrentMock.mock.calls[1][0]
        .content as string;
      const { meta } = parseJobResource(written);
      expect(meta.schedule).toBe("0 21 * * *");
      expect(meta.timezone).toBe("Asia/Tokyo");
      expect(meta.nextRun).toBe(
        nextOccurrence("0 21 * * *", undefined, "Asia/Tokyo").toISOString(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a failure recorded after the update was read alone", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const scheduled = (failure: string) =>
      resource(`---
schedule: "0 9 * * *"
timezone: UTC
enabled: false
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
${failure}
---

Send the digest.`);
    const before = scheduled(
      [
        "lastStatus: paused",
        'lastErrorCode: "missing_credentials"',
        "consecutiveFailures: 3",
        'pausedReason: "missing_credentials"',
        'pausedAt: "2026-10-01T00:00:00.000Z"',
      ].join("\n"),
    );
    const concurrentFailure = {
      ...scheduled(
        [
          "lastStatus: error",
          'lastErrorCode: "http_502"',
          "consecutiveFailures: 1",
          'pausedReason: "http_502"',
          'pausedAt: "2026-10-10T00:00:00.000Z"',
        ].join("\n"),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(concurrentFailure);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentFailure,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: true },
    );

    expect(updated.meta.enabled).toBe(true);
    const written = resourcePutIfCurrentMock.mock.calls[1][0].content as string;
    expect(written).toContain('lastErrorCode: "http_502"');
    expect(written).toContain("consecutiveFailures: 1");
    expect(written).not.toContain("missing_credentials");
  });

  it("does not report a change another writer already applied", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const requestedBody = "Updated digest.";
    const concurrent = {
      ...resource(
        eventAutomation.replace("Send the notification.", requestedBody),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrent);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrent,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", body: requestedBody },
    );

    expect(updated.changed).toBe(false);
    expect(updated.body).toBe(requestedBody);
  });

  it("reports a change when the edit restores a value another writer changed", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const requestedBody = "Send the notification.";
    const concurrent = {
      ...resource(
        eventAutomation.replace(requestedBody, "Changed by another writer."),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrent);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrent,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", body: requestedBody },
    );

    expect(updated.changed).toBe(true);
    expect(updated.body).toBe(requestedBody);
  });

  it("does not attribute a concurrent pause to a no-op update", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const concurrentPaused = {
      ...resource(
        eventAutomation.replace(
          "enabled: true",
          'enabled: false\nlastStatus: paused\npausedReason: "http_502"',
        ),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrentPaused);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentPaused,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      {
        name: "notify",
        scope: "organization",
        body: "Send the notification.",
      },
    );

    expect(updated.changed).toBe(false);
    expect(updated.meta.enabled).toBe(false);
  });

  it("rejects the retry when the automation is no longer an automation", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const legacyJob = `---
schedule: "0 9 * * *"
enabled: true
createdBy: alice@example.com
orgId: "org-1"
appId: mail
---

Run this as a recurring job.`;
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce({ ...resource(legacyJob), updatedAt: 2 });
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(1);
  });

  it("denies the retry when the automation no longer belongs to the app", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const concurrentOtherApp = {
      ...resource(eventAutomation.replace("appId: mail", "appId: calendar")),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrentOtherApp);
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with a conflict when the automation keeps changing", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));
    resourcePutIfCurrentMock.mockResolvedValue(null);

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized reasoningEffort value", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        {
          name: "notify",
          scope: "organization",
          reasoningEffort: "extreme" as never,
        },
      ),
    ).rejects.toThrow(/Invalid reasoning effort/);
  });

  it("patches Factory extras in place instead of rebuilding the job document", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(
      resource(`---
enabled: true
slackChannelId: C0BUK2293SA
displayName: Slack feedback
triggerType: schedule
schedule: "*/5 * * * *"
createdBy: alice@example.com
orgId: "org-1"
appId: factory
runAs: creator
---

Observe Slack.`),
    );

    await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "factory" },
      {
        name: "notify",
        scope: "organization",
        enabled: false,
      },
    );

    const updatedContent = resourcePutIfCurrentMock.mock.calls[0][0]
      .content as string;
    expect(updatedContent).toContain("enabled: false");
    expect(updatedContent).toContain("slackChannelId: C0BUK2293SA");
    expect(updatedContent).toContain("displayName: Slack feedback");
    expect(updatedContent.indexOf("slackChannelId: C0BUK2293SA")).toBeLessThan(
      updatedContent.indexOf("triggerType: schedule"),
    );
  });

  it("rejects an invalid delegatedPolicyId on update without rewriting the job", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        {
          name: "notify",
          scope: "organization",
          delegatedPolicyId: "crm-safe\nenabled: false",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/Delegated automation policy IDs/),
    });
    expect(resourcePutMock).not.toHaveBeenCalled();
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
      code: "owner_missing",
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
      code: "config_invalid",
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
