import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { meetingRowHasContent } from "./meeting-content.js";

const emptyCalendarHusk = {
  recordingId: null,
  actualStart: null,
  actualEnd: null,
  summaryMd: "",
  userNotesMd: "",
  bulletsJson: "[]",
  actionItemsJson: "[]",
};

describe("meetingRowHasContent", () => {
  it("hides a bare calendar row nobody has touched", () => {
    expect(meetingRowHasContent(emptyCalendarHusk)).toBe(false);
    expect(meetingRowHasContent({})).toBe(false);
  });

  // The regression this whole filter exists for: the Meetings list used to
  // require a linked recording, so desktop live notes disappeared from history.
  it("keeps notes and summaries that have no linked recording", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        userNotesMd: "we agreed to ship Thursday",
      }),
    ).toBe(true);
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        summaryMd: "## Key points\n- pricing",
      }),
    ).toBe(true);
  });

  it("keeps a meeting that was actually held", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        recordingId: "rec_1",
      }),
    ).toBe(true);
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        actualStart: "2026-08-11T18:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("keeps bullets and action items even when prose is empty", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        bulletsJson: '[{"text":"renewal is Q4"}]',
      }),
    ).toBe(true);
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        actionItemsJson: '[{"text":"send the deck"}]',
      }),
    ).toBe(true);
  });

  it("treats whitespace-only prose as empty", () => {
    expect(
      meetingRowHasContent({
        ...emptyCalendarHusk,
        summaryMd: "   \n  ",
        userNotesMd: "\t",
      }),
    ).toBe(false);
  });
});

describe("SQL mirror in list-meetings", () => {
  const source = readFileSync(
    resolve(process.cwd(), "actions/list-meetings.ts"),
    "utf8",
  );

  // The predicate above and meetingHasContentFilter() are a matched pair. A
  // column added to one and not the other silently changes which meetings the
  // history list returns, so pin every column the SQL side must cover.
  it("covers the same columns as the predicate", () => {
    const filter = source.slice(
      source.indexOf("function meetingHasContentFilter()"),
      source.indexOf("export default defineAction"),
    );
    expect(filter).toContain("recordingId");
    expect(filter).toContain("actualStart");
    expect(filter).toContain("actualEnd");
    expect(filter).toContain("summaryMd");
    expect(filter).toContain("userNotesMd");
    expect(filter).toContain("bulletsJson");
    expect(filter).toContain("actionItemsJson");
  });

  it("trims prose columns so blank-but-not-empty rows match the predicate", () => {
    expect(source).toContain("trim(${schema.meetings.summaryMd}) <> ''");
    expect(source).toContain("trim(${schema.meetings.userNotesMd}) <> ''");
  });
});
