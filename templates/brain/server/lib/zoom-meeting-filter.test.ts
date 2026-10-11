import { describe, expect, it } from "vitest";

import {
  isApprovedZoomMeeting,
  zoomApprovedMeetingIds,
  zoomApprovedMeetingsKey,
} from "./zoom.js";

describe("Zoom approved meeting series", () => {
  it("approves nothing when no series are listed", () => {
    const approved = zoomApprovedMeetingIds({});
    expect(approved.size).toBe(0);
    expect(isApprovedZoomMeeting(12345678901, approved)).toBe(false);
    expect(
      zoomApprovedMeetingIds({ meetingIds: [], meetingTopics: ["Sync"] }).size,
    ).toBe(0);
  });

  it("matches meeting IDs as Zoom displays them", () => {
    const approved = zoomApprovedMeetingIds({
      meetingIds: ["123 4567 8901", 98765432101],
    });
    expect(isApprovedZoomMeeting(12345678901, approved)).toBe(true);
    expect(isApprovedZoomMeeting("98765432101", approved)).toBe(true);
    expect(isApprovedZoomMeeting(11111111111, approved)).toBe(false);
    expect(isApprovedZoomMeeting(undefined, approved)).toBe(false);
  });

  it("ignores titles, even ones matching an approved meeting", () => {
    const approved = zoomApprovedMeetingIds({
      meetingIds: ["123 4567 8901"],
      meetingTopics: ["Marketing Standup"],
    });
    expect([...approved]).toEqual(["12345678901"]);
    expect(isApprovedZoomMeeting("Marketing Standup", approved)).toBe(false);
  });

  it("keys the allowlist independent of order and formatting", () => {
    const a = zoomApprovedMeetingIds({ meetingIds: ["222 222 2222", 111111] });
    const b = zoomApprovedMeetingIds({ meetingIds: ["111111", "2222222222"] });
    expect(zoomApprovedMeetingsKey(a)).toBe(zoomApprovedMeetingsKey(b));
  });
});
