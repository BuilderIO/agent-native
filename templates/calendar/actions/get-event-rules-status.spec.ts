import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  hasRecurringSweepHandler: vi.fn(() => true),
  scheduledTriggerAvailability: vi.fn(() => ({
    available: true,
    reason: null,
  })),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  hasRecurringSweepHandler: mocks.hasRecurringSweepHandler,
  scheduledTriggerAvailability: mocks.scheduledTriggerAvailability,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

import action from "./get-event-rules-status.js";

describe("get-event-rules-status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns per-account token refresh errors for settings", async () => {
    mocks.getUserSetting.mockResolvedValue({
      lastError: "Calendar event rules failed for 1 owner(s).",
      accountRefreshErrors: [
        { email: "calendar@example.com", error: "connection expired" },
      ],
    });

    const result = await action.run({}, { caller: "frontend" } as never);

    expect(result).toMatchObject({
      lastError: "Calendar event rules failed for 1 owner(s).",
      accountRefreshErrors: [
        { email: "calendar@example.com", error: "connection expired" },
      ],
    });
  });
});
