import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isAgentMeetingCaller,
  meetingRowForAgent,
  meetingRowHasContent,
} from "./meeting-content.js";

const emptyCalendarHusk = {
  recordingId: null,
  actualStart: null,
  actualEnd: null,
  summaryMd: "",
  userNotesMd: "",
  bulletsJson: "[]",
  actionItemsJson: "[]",
};

describe("meetingRowForAgent", () => {
  it("cuts a long summary down to a one-line preview", () => {
    const row = meetingRowForAgent({
      ...emptyCalendarHusk,
      summaryMd: `# Summary\n\n${"a".repeat(500)}`,
    });

    expect(row.summaryPreview).toHaveLength(100);
    expect(row.summaryPreview).toMatch(/^# Summary a+$/);
  });

  it("says when there's no summary or notes", () => {
    expect(
      meetingRowForAgent({ ...emptyCalendarHusk, userNotesMd: " \n" }),
    ).toMatchObject({ summaryPreview: null, hasNotes: false });
    expect(meetingRowForAgent({})).toMatchObject({
      summaryPreview: null,
      hasNotes: false,
    });
  });
});

describe("meetingRowForAgent action items", () => {
  it("counts action items instead of returning them", () => {
    const row = meetingRowForAgent({
      ...emptyCalendarHusk,
      actionItemsJson: '[{"text":"send the deck"},{"text":"book the room"}]',
    });

    expect(row.actionItemCount).toBe(2);
    expect(row).not.toHaveProperty("actionItemsJson");
  });

  it("counts none when the stored list can't be read", () => {
    expect(
      meetingRowForAgent({ ...emptyCalendarHusk, actionItemsJson: "{" }),
    ).toMatchObject({ actionItemCount: 0 });
    expect(meetingRowForAgent({})).toMatchObject({ actionItemCount: 0 });
  });
});

describe("isAgentMeetingCaller", () => {
  it.each(["tool", "mcp", "a2a", "webmcp"])(
    "counts %s as an agent",
    (caller) => {
      expect(isAgentMeetingCaller(caller)).toBe(true);
    },
  );

  it.each(["frontend", "http", "cli", undefined])(
    "leaves %s whole",
    (caller) => {
      expect(isAgentMeetingCaller(caller)).toBe(false);
    },
  );
});

describe("meetingRowHasContent", () => {
  it("hides a bare calendar row nobody has touched", () => {
    expect(meetingRowHasContent(emptyCalendarHusk)).toBe(false);
    expect(meetingRowHasContent({})).toBe(false);
  });

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
