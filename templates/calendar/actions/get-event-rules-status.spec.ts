import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getJevContextCredentials: vi.fn(async () => ({})),
  isJevEnabled: vi.fn(async () => true),
  hasRecurringSweepHandler: vi.fn(() => true),
  scheduledTriggerAvailability: vi.fn(() => ({
    available: true,
    reason: null,
  })),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  getRequestUserEmail: mocks.getRequestUserEmail,
  hasRecurringSweepHandler: mocks.hasRecurringSweepHandler,
  isJevEnabled: mocks.isJevEnabled,
  scheduledTriggerAvailability: mocks.scheduledTriggerAvailability,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

import action from "./get-event-rules-status.js";

describe("get-event-rules-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isJevEnabled.mockResolvedValue(true);
  });

  it("returns per-account token refresh errors for settings", async () => {
    mocks.getUserSetting.mockResolvedValue({
      lastError: "Calendar event rules failed for 1 owner(s).",
      accountRefreshErrors: [
        { email: "calendar@example.com", error: "connection expired" },
      ],
    });

    const result = await action.run({}, { caller: "frontend" } as never);

    expect(result).toMatchObject({
      jevConfigured: true,
      lastError: "Calendar event rules failed for 1 owner(s).",
      accountRefreshErrors: [
        { email: "calendar@example.com", error: "connection expired" },
      ],
    });
  });

  it("reports Jev availability for gating invitation-rule editing", async () => {
    mocks.isJevEnabled.mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue(null);

    const result = await action.run({}, { caller: "frontend" } as never);

    expect(mocks.getJevContextCredentials).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(result).toMatchObject({ jevConfigured: false });
  });
});
