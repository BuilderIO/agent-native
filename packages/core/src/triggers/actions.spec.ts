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
  resourceListAllOwners: resourceListAllOwnersMock,
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

  it("lists only the current user's and shared automations", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
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
    ]);

    const result = await tool().run({ action: "list" });

    expect(result).toContain("owned");
    expect(result).toContain("shared");
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
      content: "",
    });

    await tool().run({ action: "delete", name: "qa-alert" });

    expect(resourceDeleteMock).toHaveBeenCalledWith("resource-1");
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
});
