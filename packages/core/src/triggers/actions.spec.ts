import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAutomationToolEntries } from "./actions.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());
const refreshEventSubscriptionsMock = vi.hoisted(() => vi.fn());
const emitMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceListAllOwners: resourceListAllOwnersMock,
  resourceList: resourceListAllOwnersMock,
  resourceGetByPath: resourceGetByPathMock,
  resourcePut: resourcePutMock,
  resourceDelete: resourceDeleteMock,
}));

vi.mock("./dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dispatcher.js")>();
  return {
    ...actual,
    refreshEventSubscriptions: refreshEventSubscriptionsMock,
  };
});

vi.mock("../event-bus/index.js", () => ({
  listEvents: vi.fn(() => []),
  emit: emitMock,
}));

describe("manage-automations tool", () => {
  const owner = "alice+qa@agent-native.test";

  beforeEach(() => {
    vi.clearAllMocks();
    resourceListAllOwnersMock.mockResolvedValue([]);
    resourceGetByPathMock.mockResolvedValue(null);
    resourcePutMock.mockResolvedValue(undefined);
    resourceDeleteMock.mockResolvedValue(undefined);
    refreshEventSubscriptionsMock.mockResolvedValue(undefined);
  });

  function tool() {
    return createAutomationToolEntries(() => owner)["manage-automations"];
  }

  it("allows only list operations in Plan mode", () => {
    const entry = tool();
    const effect = entry.planMode?.effect;
    expect(typeof effect).toBe("function");
    if (typeof effect !== "function") throw new Error("Missing classifier");

    expect(effect({ action: "list-events" })).toBe("read");
    expect(effect({ action: "list" })).toBe("read");
    expect(effect({ action: "define" })).toBe("write");
    expect(effect({ action: "fire-test" })).toBe("write");
  });

  it("lists only the selected personal scope", async () => {
    const resources = [
      {
        id: "owned",
        owner,
        path: "jobs/owned.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
domain: qa
---

Owned body`,
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
domain: qa
---

Shared body`,
      },
      {
        id: "other",
        owner: "bob+qa@agent-native.test",
        path: "jobs/other.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
domain: qa
---

Other body`,
      },
    ];
    resourceListAllOwnersMock.mockResolvedValue(
      resources.filter((resource) => resource.owner === owner),
    );
    resourceGetByPathMock.mockImplementation(
      async (_owner: string, path: string) =>
        resources.find((resource) => resource.path === path) ?? null,
    );

    const result = await tool().run({ action: "list" });

    expect(result).toContain("owned");
    expect(result).not.toContain("shared");
    expect(result).not.toContain("other");
  });

  it("creates, updates, and deletes automations under the current user", async () => {
    await tool().run({
      action: "define",
      name: "qa-alert",
      trigger_type: "event",
      event: "test.event.fired",
      body: "Record the QA signal.",
    });

    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      owner,
      "jobs/qa-alert.md",
    );
    expect(resourcePutMock).toHaveBeenCalledWith(
      owner,
      "jobs/qa-alert.md",
      expect.stringContaining("createdBy: alice+qa@agent-native.test"),
    );
    expect(refreshEventSubscriptionsMock).toHaveBeenCalled();

    resourceGetByPathMock.mockResolvedValueOnce({
      id: "resource-1",
      owner,
      path: "jobs/qa-alert.md",
      content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
createdBy: ${owner}
---

Record the QA signal.`,
    });

    await tool().run({
      action: "update",
      name: "qa-alert",
      enabled: "false",
      body: "Updated body.",
    });

    expect(resourcePutMock).toHaveBeenLastCalledWith(
      owner,
      "jobs/qa-alert.md",
      expect.stringContaining("enabled: false"),
    );

    resourceGetByPathMock.mockResolvedValueOnce({
      id: "resource-1",
      owner,
      path: "jobs/qa-alert.md",
      content: `---
schedule: ""
enabled: false
triggerType: event
event: test.event.fired
mode: agentic
createdBy: ${owner}
---

Updated body.`,
    });

    await tool().run({ action: "delete", name: "qa-alert" });

    expect(resourceDeleteMock).toHaveBeenCalledWith("resource-1");
  });

  it("rejects define with mode: deterministic and persists nothing", async () => {
    const result = await tool().run({
      action: "define",
      name: "qa-deterministic",
      trigger_type: "event",
      event: "test.event.fired",
      body: "Record the QA signal.",
      mode: "deterministic",
    });

    expect(result).toContain("Deterministic mode was removed");
    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(refreshEventSubscriptionsMock).not.toHaveBeenCalled();
  });

  it("persists mode: agentic when mode is explicit or omitted", async () => {
    await tool().run({
      action: "define",
      name: "qa-explicit-agentic",
      trigger_type: "event",
      event: "test.event.fired",
      body: "Record the QA signal.",
      mode: "agentic",
    });

    expect(resourcePutMock).toHaveBeenCalledWith(
      owner,
      "jobs/qa-explicit-agentic.md",
      expect.stringContaining("mode: agentic"),
    );

    await tool().run({
      action: "define",
      name: "qa-omitted-mode",
      trigger_type: "event",
      event: "test.event.fired",
      body: "Record the QA signal.",
    });

    expect(resourcePutMock).toHaveBeenLastCalledWith(
      owner,
      "jobs/qa-omitted-mode.md",
      expect.stringContaining("mode: agentic"),
    );
  });

  it("validates trigger-specific fields before defining an automation", async () => {
    await expect(
      tool().run({
        action: "define",
        name: "missing-event",
        trigger_type: "event",
        body: "Record the signal.",
      }),
    ).resolves.toContain("event is required");

    await expect(
      tool().run({
        action: "define",
        name: "invalid-schedule",
        trigger_type: "schedule",
        schedule: "tomorrow",
        body: "Record the signal.",
      }),
    ).resolves.toContain("invalid cron expression");

    await expect(
      tool().run({
        action: "define",
        name: "missing-body",
        trigger_type: "schedule",
        schedule: "0 9 * * *",
      }),
    ).resolves.toContain("body is required");

    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("defines a manual automation with no automatic trigger fields", async () => {
    const result = await tool().run({
      action: "define",
      name: "on-demand-report",
      trigger_type: "manual",
      body: "Build the report.",
      schedule: "0 9 * * *",
      event: "test.event.fired",
      condition: "only when urgent",
    });

    expect(JSON.parse(result)).toMatchObject({
      created: true,
      triggerType: "manual",
      event: null,
      schedule: null,
      timezone: null,
      nextRun: null,
    });
    const content = resourcePutMock.mock.calls[0]?.[2] as string;
    expect(content).toContain("triggerType: manual");
    expect(content).not.toMatch(/^(event|condition|nextRun|timezone):/m);
  });

  it("seeds the next run for scheduled automations", async () => {
    await tool().run({
      action: "define",
      name: "daily-digest",
      trigger_type: "schedule",
      schedule: "0 9 * * *",
      body: "Summarize the inbox.",
    });

    const content = resourcePutMock.mock.calls[0]?.[2] as string;
    expect(content).toContain("triggerType: schedule");
    expect(content).toMatch(/nextRun: "/);
  });

  it("accepts manual as a canonical trigger type in the tool schema", () => {
    expect(tool().tool.parameters.properties.trigger_type.enum).toContain(
      "manual",
    );
  });

  it("leaves legacy scheduled jobs on the compatibility tool", async () => {
    resourceGetByPathMock.mockResolvedValueOnce({
      id: "legacy-job",
      owner,
      path: "jobs/daily-digest.md",
      content: `---
schedule: "0 9 * * *"
enabled: true
createdBy: ${owner}
model: custom-model
mcpTools: ["mcp__mail__list_messages"]
deliveryPlatform: slack
deliveryDestination: C123
---

Summarize the inbox.`,
    });

    const result = await tool().run({
      action: "update",
      name: "daily-digest",
      enabled: "false",
    });

    expect(result).toContain("legacy scheduled job");
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("refreshes event subscriptions after deletion", async () => {
    resourceGetByPathMock.mockResolvedValueOnce({
      id: "resource-1",
      owner,
      path: "jobs/qa-alert.md",
      content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
---

Record the signal.`,
    });

    await tool().run({ action: "delete", name: "qa-alert" });

    expect(resourceDeleteMock).toHaveBeenCalledWith("resource-1");
    expect(refreshEventSubscriptionsMock).toHaveBeenCalledOnce();
  });

  it("scopes fire-test events to the current user", async () => {
    await tool().run({
      action: "fire-test",
      data: '{"subject":"qa"}',
    });

    expect(emitMock).toHaveBeenCalledWith(
      "test.event.fired",
      { data: { subject: "qa" } },
      { owner },
    );
  });

  it("does not allow an automation to recursively queue another automation", async () => {
    const result = await tool().run(
      { action: "run-now", name: "another-automation" },
      { caller: "automation" },
    );

    expect(result).toBe("Error: an automation cannot run another automation.");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
  });
});
