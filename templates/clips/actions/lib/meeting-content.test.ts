import { describe, expect, it } from "vitest";

import { meetingRowHasContent } from "./meeting-content.js";

const emptyCalendarMeeting = {
  recordingId: null,
  actualStart: null,
  actualEnd: null,
  summaryMd: "",
  userNotesMd: "",
  bulletsJson: "[]",
  actionItemsJson: "[]",
};

describe("meetingRowHasContent", () => {
  it("excludes an untouched calendar row", () => {
    expect(meetingRowHasContent(emptyCalendarMeeting)).toBe(false);
    expect(meetingRowHasContent({})).toBe(false);
  });

  it("keeps notes and summaries without a linked recording", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarMeeting,
        userNotesMd: "Discussed the launch plan",
      }),
    ).toBe(true);
    expect(
      meetingRowHasContent({
        ...emptyCalendarMeeting,
        summaryMd: "## Decisions\n- Ship Thursday",
      }),
    ).toBe(true);
  });

  it("keeps completed meetings and structured notes", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarMeeting,
        actualEnd: "2026-08-14T18:30:00.000Z",
      }),
    ).toBe(true);
    expect(
      meetingRowHasContent({
        ...emptyCalendarMeeting,
        bulletsJson: '[{"text":"Ship Thursday"}]',
      }),
    ).toBe(true);
    expect(
      meetingRowHasContent({
        ...emptyCalendarMeeting,
        actionItemsJson: '[{"text":"Send the deck"}]',
      }),
    ).toBe(true);
  });

  it("treats whitespace-only prose as empty", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarMeeting,
        summaryMd: "  \n\t",
        userNotesMd: " ",
      }),
    ).toBe(false);
  });
});
