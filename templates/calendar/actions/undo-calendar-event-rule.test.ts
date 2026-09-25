import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
  getEvent: vi.fn(),
  resolveOwnedAccountEmail: vi.fn(),
  rsvpEvent: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
}));
vi.mock("../server/lib/google-calendar.js", () => ({
  getEvent: mocks.getEvent,
  rsvpEvent: mocks.rsvpEvent,
}));
vi.mock("./event-action-helpers.js", () => ({
  resolveOwnedAccountEmail: mocks.resolveOwnedAccountEmail,
}));

import action from "./undo-calendar-event-rule.js";

const hiddenActivity = {
  id: "activity-hidden",
  eventId: "event-hidden",
  accountEmail: "owner@example.com",
  title: "Focus block",
  action: "hidden",
  occurredAt: "2026-09-25T12:00:00.000Z",
  hiddenEventKey: "google:owner@example.com:primary:event-hidden",
};
const acceptedActivity = {
  id: "activity-accepted",
  eventId: "event-accepted",
  accountEmail: "owner@example.com",
  title: "Planning review",
  action: "accepted",
  occurredAt: "2026-09-25T12:00:00.000Z",
};

describe("undo-calendar-event-rule", () => {
  let settings: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {
      hiddenEventKeys: [
        hiddenActivity.hiddenEventKey,
        "google:owner@example.com:primary:other-event",
      ],
      eventRuleActivity: [hiddenActivity, acceptedActivity],
    };
    mocks.getUserSetting.mockResolvedValue(settings);
    mocks.mutateUserSetting.mockImplementation(
      async (_owner: string, _key: string, update: any) => {
        settings = update(settings);
      },
    );
    mocks.resolveOwnedAccountEmail.mockResolvedValue("owner@example.com");
    mocks.getEvent.mockResolvedValue({ responseStatus: "accepted" });
  });

  it("unhides the recorded event and removes its activity", async () => {
    const result = await action.run({ activityId: hiddenActivity.id });

    expect(result).toEqual({ success: true, activityId: hiddenActivity.id });
    expect(settings.hiddenEventKeys).toEqual([
      "google:owner@example.com:primary:other-event",
    ]);
    expect(settings.eventRuleActivity).toEqual([acceptedActivity]);
    expect(mocks.rsvpEvent).not.toHaveBeenCalled();
  });

  it("restores an automatic RSVP to needsAction for its owned account", async () => {
    const result = await action.run({ activityId: acceptedActivity.id });

    expect(result.success).toBe(true);
    expect(mocks.resolveOwnedAccountEmail).toHaveBeenCalledWith(
      "owner@example.com",
      "owner@example.com",
    );
    expect(mocks.getEvent).toHaveBeenCalledWith("event-accepted", {
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
    });
    expect(mocks.rsvpEvent).toHaveBeenCalledWith(
      "event-accepted",
      "needsAction",
      { ownerEmail: "owner@example.com", accountEmail: "owner@example.com" },
      "single",
      undefined,
      "none",
    );
    expect(settings.eventRuleActivity).toEqual([hiddenActivity]);
  });

  it("preserves activity when the RSVP no longer matches the recorded action", async () => {
    mocks.getEvent.mockResolvedValue({ responseStatus: "declined" });

    await expect(
      action.run({ activityId: acceptedActivity.id }),
    ).rejects.toThrow("Could not undo this action.");

    expect(mocks.rsvpEvent).not.toHaveBeenCalled();
    expect(settings.eventRuleActivity).toEqual([
      hiddenActivity,
      acceptedActivity,
    ]);
  });
});
