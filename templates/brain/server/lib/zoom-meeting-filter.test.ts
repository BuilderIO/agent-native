import { describe, expect, it } from "vitest";

import {
  zoomMeetingFilterFromConfig,
  zoomMeetingFilterKey,
  zoomMeetingMatchesFilter,
  type ZoomMeeting,
} from "./zoom.js";

const meeting = (id: ZoomMeeting["id"], topic?: string) => ({ id, topic });

describe("Zoom meeting filter", () => {
  it("keeps every meeting when no filter is configured", () => {
    expect(zoomMeetingFilterFromConfig({})).toBeNull();
    expect(
      zoomMeetingFilterFromConfig({ meetingIds: [], meetingTopics: [" "] }),
    ).toBeNull();
    expect(zoomMeetingMatchesFilter(meeting(1, "Anything"), null)).toBe(true);
  });

  it("matches meeting IDs as Zoom displays them", () => {
    const filter = zoomMeetingFilterFromConfig({
      meetingIds: ["123 4567 8901", 98765432101],
    });
    expect(zoomMeetingMatchesFilter(meeting(12345678901), filter)).toBe(true);
    expect(zoomMeetingMatchesFilter(meeting("98765432101"), filter)).toBe(true);
    expect(zoomMeetingMatchesFilter(meeting(11111111111), filter)).toBe(false);
  });

  it("matches exact titles case-insensitively, not substrings", () => {
    const filter = zoomMeetingFilterFromConfig({
      meetingTopics: ["GTM Weekly  Sync"],
    });
    expect(
      zoomMeetingMatchesFilter(meeting(1, " gtm weekly sync "), filter),
    ).toBe(true);
    expect(
      zoomMeetingMatchesFilter(meeting(1, "GTM Weekly Sync prep"), filter),
    ).toBe(false);
    expect(zoomMeetingMatchesFilter(meeting(1), filter)).toBe(false);
  });

  it("keeps a meeting that matches either its ID or its title", () => {
    const filter = zoomMeetingFilterFromConfig({
      meetingIds: ["12345678901"],
      meetingTopics: ["Marketing Standup"],
    });
    expect(zoomMeetingMatchesFilter(meeting(12345678901, "x"), filter)).toBe(
      true,
    );
    expect(
      zoomMeetingMatchesFilter(meeting(2, "Marketing Standup"), filter),
    ).toBe(true);
    expect(zoomMeetingMatchesFilter(meeting(2, "Other"), filter)).toBe(false);
  });

  it("builds the same filter key regardless of entry order or spacing", () => {
    const a = zoomMeetingFilterFromConfig({
      meetingIds: ["123 4567 8901", "222222222"],
      meetingTopics: ["B", "a"],
    });
    const b = zoomMeetingFilterFromConfig({
      meetingIds: ["222222222", "12345678901"],
      meetingTopics: ["A", " b "],
    });
    expect(zoomMeetingFilterKey(a)).toBe(zoomMeetingFilterKey(b));
    expect(zoomMeetingFilterKey(null)).toBeNull();
  });
});
