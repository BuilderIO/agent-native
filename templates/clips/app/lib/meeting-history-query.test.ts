import { describe, expect, it } from "vitest";

import {
  buildMeetingHistoryQuery,
  MEETING_HISTORY_PAGE_SIZE,
} from "./meeting-history-query";

describe("buildMeetingHistoryQuery", () => {
  it("requests content-bearing past meetings without requiring recordings", () => {
    expect(buildMeetingHistoryQuery(0)).toEqual({
      view: "past",
      hasContent: true,
      includeLiveCalendar: false,
      limit: MEETING_HISTORY_PAGE_SIZE,
      offset: 0,
    });
    expect(buildMeetingHistoryQuery(50).offset).toBe(50);
  });
});
