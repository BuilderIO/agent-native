import { describe, expect, it, vi } from "vitest";

import { dismissMeetingNotification } from "./meeting-notification-dismissal";

describe("meeting notification dismissal", () => {
  it("sends the current meeting context to the native watcher", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await dismissMeetingNotification(
      {
        type: "adhoc",
        meetingId: "meeting-1",
        platform: "zoom",
        scheduledStart: "2026-07-22T19:10:00.000Z",
        scheduledEnd: null,
      },
      invoke,
    );

    expect(invoke).toHaveBeenCalledWith("dismiss_meeting_notification", {
      meetingId: "meeting-1",
      joinUrl: null,
      notificationType: "adhoc",
      platform: "zoom",
      scheduledStart: "2026-07-22T19:10:00.000Z",
      scheduledEnd: null,
    });
  });

  it("does not reject when native dismissal synchronization fails", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("native unavailable"));

    await expect(
      dismissMeetingNotification(
        { type: "calendar", meetingId: "meeting-2" },
        invoke,
      ),
    ).resolves.toBeUndefined();
  });
});
