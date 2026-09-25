import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
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
  let mutationQueue: Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mutationQueue = Promise.resolve();
    settings = {
      hiddenEventKeys: [
        hiddenActivity.hiddenEventKey,
        "google:owner@example.com:primary:other-event",
      ],
      eventRuleActivity: [hiddenActivity, acceptedActivity],
    };
    mocks.rsvpEvent.mockResolvedValue(undefined);
    mocks.mutateUserSetting.mockImplementation(
      async (_owner: string, _key: string, update: any) => {
        const operation = mutationQueue.then(async () => {
          settings = await update(settings);
          return settings;
        });
        mutationQueue = operation.then(
          () => undefined,
          () => undefined,
        );
        return operation;
      },
    );
    mocks.resolveOwnedAccountEmail.mockResolvedValue("owner@example.com");
    mocks.getEvent.mockResolvedValue({ responseStatus: "accepted" });
  });

  it("unhides the recorded event and removes its activity", async () => {
    mocks.resolveOwnedAccountEmail.mockRejectedValue(
      new Error("Google account is no longer connected"),
    );
    const result = await action.run({ activityId: hiddenActivity.id });

    expect(result).toEqual({ success: true, activityId: hiddenActivity.id });
    expect(mocks.resolveOwnedAccountEmail).not.toHaveBeenCalled();
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
    expect(settings.__calendarEventRuleUndoClaims).toEqual({});
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
    expect(settings.__calendarEventRuleUndoClaims).toEqual({});
  });

  it("claims the activity before a concurrent undo can send a second RSVP", async () => {
    let finishRsvp!: () => void;
    mocks.rsvpEvent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRsvp = resolve;
        }),
    );

    const first = action.run({ activityId: acceptedActivity.id });
    await vi.waitFor(() => expect(mocks.rsvpEvent).toHaveBeenCalledTimes(1));

    await expect(
      action.run({ activityId: acceptedActivity.id }),
    ).rejects.toThrow("already being undone");
    expect(mocks.rsvpEvent).toHaveBeenCalledTimes(1);

    finishRsvp();
    await expect(first).resolves.toEqual({
      success: true,
      activityId: acceptedActivity.id,
    });
  });

  it("recovers an ambiguous RSVP failure after the claim lease without resending", async () => {
    mocks.rsvpEvent.mockRejectedValueOnce(
      new Error("temporary provider error"),
    );
    const initialTime = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(initialTime);

    try {
      await expect(
        action.run({ activityId: acceptedActivity.id }),
      ).rejects.toThrow("temporary provider error");
      expect(settings.eventRuleActivity).toContainEqual(acceptedActivity);
      expect(settings.__calendarEventRuleUndoClaims).toHaveProperty(
        acceptedActivity.id,
      );

      await expect(
        action.run({ activityId: acceptedActivity.id }),
      ).rejects.toThrow("already being undone");

      now.mockReturnValue(initialTime + 5 * 60 * 1000 + 1);
      mocks.getEvent.mockResolvedValue({ responseStatus: "needsAction" });
      await expect(
        action.run({ activityId: acceptedActivity.id }),
      ).resolves.toEqual({ success: true, activityId: acceptedActivity.id });
      expect(mocks.rsvpEvent).toHaveBeenCalledTimes(1);
      expect(settings.eventRuleActivity).toEqual([hiddenActivity]);
    } finally {
      now.mockRestore();
    }
  });

  it("finishes an expired claim without repeating an already completed RSVP", async () => {
    settings.__calendarEventRuleUndoClaims = {
      [acceptedActivity.id]: { token: "expired", expiresAt: 0 },
    };
    mocks.getEvent.mockResolvedValue({ responseStatus: "needsAction" });

    await expect(
      action.run({ activityId: acceptedActivity.id }),
    ).resolves.toEqual({ success: true, activityId: acceptedActivity.id });

    expect(mocks.rsvpEvent).not.toHaveBeenCalled();
    expect(settings.eventRuleActivity).toEqual([hiddenActivity]);
    expect(settings.__calendarEventRuleUndoClaims).toEqual({});
  });
});
