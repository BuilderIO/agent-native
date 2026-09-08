import { describe, expect, it } from "vitest";

import {
  detectMeetingJoinProvider,
  formatMeetingTimeRange,
  isMeetingNotificationWindowOpen,
  joinProviderLabel,
  MEETING_NOTIFY_HOLD_AFTER_START_MS,
  MEETING_NOTIFY_LEAD_MS,
  meetingNotificationAutoHideMs,
} from "./meeting-notification-timing";

describe("meeting notification timing", () => {
  const start = Date.parse("2026-07-08T16:00:00.000Z");

  it("opens 1 minute before start and holds until 5 minutes after", () => {
    expect(
      isMeetingNotificationWindowOpen(start, start - MEETING_NOTIFY_LEAD_MS),
    ).toBe(true);
    expect(
      isMeetingNotificationWindowOpen(
        start,
        start - MEETING_NOTIFY_LEAD_MS - 1,
      ),
    ).toBe(false);
    expect(isMeetingNotificationWindowOpen(start, start)).toBe(true);
    expect(
      isMeetingNotificationWindowOpen(
        start,
        start + MEETING_NOTIFY_HOLD_AFTER_START_MS,
      ),
    ).toBe(true);
    expect(
      isMeetingNotificationWindowOpen(
        start,
        start + MEETING_NOTIFY_HOLD_AFTER_START_MS + 1,
      ),
    ).toBe(false);
  });

  it("computes auto-hide remaining from hold-after-start", () => {
    expect(
      meetingNotificationAutoHideMs(start, start - MEETING_NOTIFY_LEAD_MS),
    ).toBe(MEETING_NOTIFY_LEAD_MS + MEETING_NOTIFY_HOLD_AFTER_START_MS);
    expect(meetingNotificationAutoHideMs(start, start)).toBe(
      MEETING_NOTIFY_HOLD_AFTER_START_MS,
    );
    expect(
      meetingNotificationAutoHideMs(
        start,
        start + MEETING_NOTIFY_HOLD_AFTER_START_MS + 5_000,
      ),
    ).toBe(0);
  });

  it("detects join providers from url/platform", () => {
    expect(detectMeetingJoinProvider("https://zoom.us/j/123", null)).toBe(
      "zoom",
    );
    expect(
      detectMeetingJoinProvider("https://meet.google.com/abc-defg-hij", null),
    ).toBe("meet");
    expect(detectMeetingJoinProvider(null, "teams")).toBe("teams");
    expect(joinProviderLabel("zoom")).toBe("Zoom");
    expect(joinProviderLabel("other")).toBe("meeting");
  });

  it("formats a local time range subtitle", () => {
    const label = formatMeetingTimeRange(
      "2026-07-08T16:00:00.000Z",
      "2026-07-08T16:30:00.000Z",
      "en-US",
    );
    // en-US either "9:00 AM - 9:30 AM" or with narrow spaces depending on ICU;
    // just assert both sides exist and a dash separates them.
    expect(label).toMatch(/\d/);
    expect(label).toMatch(/-/);
  });
});
