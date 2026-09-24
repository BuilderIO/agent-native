import { beforeEach, describe, expect, it, vi } from "vitest";

const defineAutomationMock = vi.hoisted(() => vi.fn());
const updateAutomationMock = vi.hoisted(() => vi.fn());
const deleteAutomationMock = vi.hoisted(() => vi.fn());
const refreshEventSubscriptionsMock = vi.hoisted(() => vi.fn());

vi.mock("../../automations/service.js", () => ({
  defineAutomation: defineAutomationMock,
  updateAutomation: updateAutomationMock,
  deleteAutomation: deleteAutomationMock,
}));

vi.mock("../dispatcher.js", () => ({
  refreshEventSubscriptions: refreshEventSubscriptionsMock,
}));

import action from "./manage-automation.js";

const ctx = { userEmail: "alice@example.com", orgId: "org-1", appId: "mail" };

function run(args: Record<string, unknown>) {
  return action.run(args as any, ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshEventSubscriptionsMock.mockResolvedValue(undefined);
});

describe("manage-automation reasoningEffort", () => {
  it("forwards reasoningEffort on create", async () => {
    defineAutomationMock.mockResolvedValue({
      name: "notify",
      meta: {
        triggerType: "event",
        event: "mail.received",
        reasoningEffort: "high",
      },
    });

    const result = await run({
      operation: "create",
      name: "notify",
      scope: "personal",
      triggerType: "event",
      event: "mail.received",
      reasoningEffort: "high",
    });

    expect(defineAutomationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reasoningEffort: "high" }),
    );
    expect((result as any).reasoningEffort).toBe("high");
  });

  it("rejects an unrecognized reasoningEffort at the schema boundary", () => {
    expect(
      action.schema.safeParse({
        operation: "create",
        name: "notify",
        scope: "personal",
        triggerType: "event",
        reasoningEffort: "extreme",
      }).success,
    ).toBe(false);
  });

  it("accepts an effort-only update instead of rejecting it as a no-op", async () => {
    updateAutomationMock.mockResolvedValue({
      meta: { enabled: true, reasoningEffort: "low" },
    });

    const result = await run({
      operation: "update",
      name: "notify",
      scope: "personal",
      reasoningEffort: "low",
    });

    expect(updateAutomationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reasoningEffort: "low" }),
    );
    expect((result as any).reasoningEffort).toBe("low");
  });

  it("still rejects an update with no recognized field at all", async () => {
    await expect(
      run({ operation: "update", name: "notify", scope: "personal" }),
    ).rejects.toThrow(/reasoningEffort is required for update/);
    expect(updateAutomationMock).not.toHaveBeenCalled();
  });
});
