import { describe, expect, it } from "vitest";

import { invalidZoomMeetingIds, zoomFilterLines } from "./zoom-meeting-filter";

describe("Zoom meeting filter form helpers", () => {
  it("splits on lines only, so titles may contain commas", () => {
    expect(zoomFilterLines(" Sales, Weekly \n\nMarketing Standup\n")).toEqual([
      "Sales, Weekly",
      "Marketing Standup",
    ]);
  });

  it("flags entries that are not Zoom meeting IDs", () => {
    expect(
      invalidZoomMeetingIds("123 4567 8901\n98765432101\nWeekly Sync\n123"),
    ).toEqual(["Weekly Sync", "123"]);
  });
});
