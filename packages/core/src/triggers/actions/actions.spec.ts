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

import { z } from "zod";

import {
  __resetEventRegistry,
  registerEvent,
} from "../../event-bus/registry.js";
import listAutomationEvents from "./list-automation-events.js";
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
    __resetEventRegistry();
  });

  it("exposes a frontend-only GET list and a frontend-only mutation", () => {
    expect(listAutomations.http).toEqual({ method: "GET" });
    expect(listAutomations.agentTool).toBe(false);
    expect(listAutomationEvents.http).toEqual({ method: "GET" });
    expect(listAutomationEvents.agentTool).toBe(false);
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
      scheduleDescription: "Every day at 9 AM (UTC)",
      scope: "personal",
    });
  });

  it("lists manual automations without automatic trigger fields", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/on-demand.md" }]);
    resourceGetByPathMock.mockResolvedValue({
      id: "manual-automation",
      owner: "alice@example.com",
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
createdBy: alice@example.com
---

Run on demand.`,
    });

    const [automation] = await listAutomations.run({ scope: "personal" }, ctx);

    expect(automation).toMatchObject({
      triggerType: "manual",
      event: null,
      schedule: null,
      timezone: null,
      scheduleDescription: null,
      condition: null,
      nextRun: null,
    });
  });

  it("lists organization automations for a current member", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/digest.md" }]);
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "__organization__:org-1",
      path: "jobs/digest.md",
      content: automationContent.replace(
        "createdBy: alice@example.com",
        'createdBy: alice@example.com\norgId: "org-1"\nrunAs: creator',
      ),
    });

    const automations = await listAutomations.run(
      { scope: "organization" },
      { ...ctx, orgId: "org-1" },
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

  it("lists registered events with structured payload schemas", async () => {
    registerEvent({
      name: "mail.message.received",
      description: "A message arrived.",
      payloadSchema: z.object({
        messageId: z.string(),
        unread: z.boolean().optional(),
      }),
      example: { messageId: "message-example", unread: true },
    });

    const events = await listAutomationEvents.run({}, ctx);

    expect(events).toContainEqual({
      name: "mail.message.received",
      description: "A message arrived.",
      payloadSchema: expect.objectContaining({
        type: "object",
        properties: expect.objectContaining({
          messageId: expect.objectContaining({ type: "string" }),
        }),
      }),
      example: { messageId: "message-example", unread: true },
    });
  });

  it("creates personal and organization automations with creator ownership", async () => {
    await manageAutomation.run(
      {
        operation: "create",
        name: "personal-notify",
        scope: "personal",
        triggerType: "event",
        event: "mail.message.received",
        condition: "only unread messages",
        body: "Send me a notification.",
      },
      ctx,
    );
    expect(resourcePutMock).toHaveBeenCalledWith(
      "alice@example.com",
      "jobs/personal-notify.md",
      expect.stringMatching(
        /triggerType: event[\s\S]*event: "mail\.message\.received"[\s\S]*createdBy: alice@example\.com/,
      ),
    );

    await manageAutomation.run(
      {
        operation: "create",
        name: "org-notify",
        scope: "organization",
        triggerType: "manual",
        body: "Build the organization report.",
      },
      { ...ctx, orgId: "org-1" },
    );
    expect(resourcePutMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/org-notify.md",
      expect.stringMatching(
        /createdBy: alice@example\.com[\s\S]*orgId: "org-1"[\s\S]*runAs: creator/,
      ),
    );
    expect(refreshEventSubscriptionsMock).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate names and invalid trigger settings", async () => {
    resourceGetByPathMock.mockResolvedValueOnce({
      id: "existing",
      owner: "alice@example.com",
      path: "jobs/notify.md",
      content: automationContent,
    });
    await expect(
      manageAutomation.run(
        {
          operation: "create",
          name: "notify",
          scope: "personal",
          triggerType: "manual",
          body: "Run the notification.",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    resourceGetByPathMock.mockResolvedValue(null);
    await expect(
      manageAutomation.run(
        {
          operation: "create",
          name: "missing-event",
          scope: "personal",
          triggerType: "event",
          body: "Run the notification.",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      manageAutomation.run(
        {
          operation: "create",
          name: "bad-schedule",
          scope: "personal",
          triggerType: "schedule",
          schedule: "not a cron",
          body: "Run the notification.",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(resourcePutMock).not.toHaveBeenCalled();
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

  it("updates all editable event fields", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "alice@example.com",
      path: "jobs/digest.md",
      content: automationContent,
    });

    const result = await manageAutomation.run(
      {
        operation: "update",
        name: "digest",
        scope: "personal",
        triggerType: "event",
        event: "mail.message.received",
        condition: "only unread messages",
        body: "Send the updated notification.",
        model: "model-example",
        mcpTools: ["mcp__mail__read"],
      },
      ctx,
    );

    expect(result).toMatchObject({
      updated: true,
      triggerType: "event",
      event: "mail.message.received",
      schedule: null,
      condition: "only unread messages",
      body: "Send the updated notification.",
      model: "model-example",
      mcpTools: ["mcp__mail__read"],
    });
    expect(resourcePutMock).toHaveBeenCalledWith(
      "alice@example.com",
      "jobs/digest.md",
      expect.stringMatching(
        /triggerType: event[\s\S]*event: "mail\.message\.received"[\s\S]*condition: "only unread messages"/,
      ),
    );
  });

  it("updates organization automations as their current creator", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "__organization__:org-1",
      path: "jobs/digest.md",
      content: automationContent.replace(
        "createdBy: alice@example.com",
        'createdBy: alice@example.com\norgId: "org-1"\nrunAs: creator',
      ),
    });

    await manageAutomation.run(
      {
        operation: "update",
        name: "digest",
        scope: "organization",
        enabled: false,
      },
      { ...ctx, orgId: "org-1" },
    );

    expect(resourcePutMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/digest.md",
      expect.stringContaining("runAs: creator"),
    );
  });

  it("rejects a scoped organization update from a non-creator member", async () => {
    resourceGetByPathMock.mockResolvedValue({
      id: "automation-1",
      owner: "__organization__:org-1",
      path: "jobs/digest.md",
      content: automationContent.replace(
        "createdBy: alice@example.com",
        'createdBy: creator@example.com\norgId: "org-1"\nrunAs: creator',
      ),
    });

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
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });
});
