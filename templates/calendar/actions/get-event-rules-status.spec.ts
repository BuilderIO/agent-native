import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDecisionsStatus: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  hasRecurringSweepHandler: vi.fn(() => true),
  scheduledTriggerAvailability: vi.fn(() => ({
    available: true,
    reason: null,
  })),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({
  getDecisionsStatus: mocks.getDecisionsStatus,
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

const unavailable = {
  providers: [
    { provider: "jev", status: "not_configured" },
    { provider: "openai", status: "not_configured" },
  ],
};

describe("get-event-rules-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDecisionsStatus.mockResolvedValue({
      providers: [
        { provider: "jev", status: "ready" },
        { provider: "openai", status: "not_configured" },
      ],
    });
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
      decisionProviderConfigured: true,
      jevConfigured: true,
      lastError: "Calendar event rules failed for 1 owner(s).",
      accountRefreshErrors: [
        { email: "calendar@example.com", error: "connection expired" },
      ],
    });
  });

  it("reports OpenAI availability for invitation-rule editing", async () => {
    mocks.getDecisionsStatus.mockResolvedValue({
      providers: [
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "ready" },
      ],
    });
    mocks.getUserSetting.mockResolvedValue(null);

    const result = await action.run({}, { caller: "frontend" } as never);

    expect(mocks.getDecisionsStatus).toHaveBeenCalledWith("owner@example.com");
    expect(result).toMatchObject({
      decisionProviderConfigured: true,
      jevConfigured: true,
    });
  });

  it("reports false when no provider is configured", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(unavailable);
    mocks.getUserSetting.mockResolvedValue(null);

    const result = await action.run({}, { caller: "frontend" } as never);

    expect(result).toMatchObject({
      decisionProviderConfigured: false,
      jevConfigured: false,
    });
  });

  it("does not turn an unknown provider status into unavailable", async () => {
    mocks.getDecisionsStatus.mockResolvedValue({
      providers: [
        { provider: "jev", status: "unknown" },
        { provider: "openai", status: "not_configured" },
      ],
    });

    await expect(
      action.run({}, { caller: "frontend" } as never),
    ).rejects.toThrow("Decision provider availability could not be checked.");
  });
});
