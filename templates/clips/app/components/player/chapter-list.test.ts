import { describe, expect, it } from "vitest";

import { DEFAULT_EDITS, type EditsJson } from "@/lib/timestamp-mapping";

import {
  chaptersToSave,
  parseChapterLines,
  parseTimestamp,
} from "./chapter-list";

// The first 45 seconds cut out.
const trimmed: EditsJson = {
  ...DEFAULT_EDITS,
  trims: [{ startMs: 0, endMs: 45_000, excluded: true }],
};

describe("parseTimestamp", () => {
  it("reads m:ss and h:mm:ss", () => {
    expect(parseTimestamp("0:48")).toBe(48_000);
    expect(parseTimestamp("00:48")).toBe(48_000);
    expect(parseTimestamp("1:02:03")).toBe(3_723_000);
  });

  it("reads the full-width digits and colon CJK input methods type", () => {
    expect(parseTimestamp("０：４８")).toBe(48_000);
    expect(parseTimestamp("１：０２：０３")).toBe(3_723_000);
  });

  it("reads Arabic-Indic, Persian and Devanagari digits", () => {
    expect(parseTimestamp("٠:٤٨")).toBe(48_000);
    expect(parseTimestamp("۱:۰۲")).toBe(62_000);
    expect(parseTimestamp("१:०५")).toBe(65_000);
  });

  it("refuses a bare number, so a numbered list isn't read as times", () => {
    expect(parseTimestamp("1")).toBeNull();
    expect(parseChapterLines("1 Introduction\n2 Setup")).toEqual({
      error: { kind: "badTime", line: 1, value: "1" },
    });
  });

  it("refuses minutes or seconds past 59 after the first part", () => {
    expect(parseTimestamp("1:75")).toBeNull();
    expect(parseTimestamp("0:4800")).toBeNull();
    expect(parseTimestamp("1:60:00")).toBeNull();
    expect(parseTimestamp("75:00")).toBe(4_500_000);
  });

  it("refuses absurdly large times rather than saving them somewhere", () => {
    expect(parseTimestamp(`${"9".repeat(400)}:00`)).toBeNull();
    expect(parseTimestamp("1234567:00")).toBeNull();
    expect(parseTimestamp("100:00:00")).toBeNull();
  });

  it("rejects anything that isn't a time", () => {
    expect(parseTimestamp("abc")).toBeNull();
    expect(parseTimestamp("1:")).toBeNull();
    expect(parseTimestamp("1:2:3:4")).toBeNull();
    expect(parseTimestamp("-1")).toBeNull();
  });
});

describe("parseChapterLines", () => {
  it("parses the text block into sorted chapters", () => {
    expect(
      parseChapterLines(
        "0:48 Saved note dates stay unchanged\n0:00 Need date updates on notes",
      ),
    ).toEqual({
      chapters: [
        { startMs: 0, title: "Need date updates on notes" },
        { startMs: 48_000, title: "Saved note dates stay unchanged" },
      ],
    });
  });

  it("ignores blank lines, and an empty box clears all chapters", () => {
    expect(parseChapterLines("\n0:00 Intro\n\n1:30 Next\n")).toEqual({
      chapters: [
        { startMs: 0, title: "Intro" },
        { startMs: 90_000, title: "Next" },
      ],
    });
    expect(parseChapterLines("   \n  ")).toEqual({ chapters: [] });
  });

  it("refuses a new time past the end of the clip", () => {
    expect(
      parseChapterLines("0:10 Fine\n2:00 Too late", { maxMs: 90_000 }),
    ).toEqual({ error: { kind: "pastEnd", line: 2, value: "2:00" } });
  });

  it("accepts a time already in the list even past the stored end", () => {
    // The stored duration can be shorter than the media the player plays.
    expect(
      parseChapterLines("1:05 Already there", {
        maxMs: 60_000,
        existingMs: new Map([[65_000, 1]]),
      }),
    ).toEqual({ chapters: [{ startMs: 65_000, title: "Already there" }] });
  });

  it("refuses a new chapter on a moment that already has one", () => {
    expect(parseChapterLines("0:48 A\n0:48 B")).toEqual({
      error: { kind: "duplicate", line: 2, value: "0:48" },
    });
  });

  it("keeps repeats the list already had (chapters under a second apart)", () => {
    expect(
      parseChapterLines("0:48 A\n0:48 B", {
        existingMs: new Map([[48_000, 2]]),
      }),
    ).toEqual({
      chapters: [
        { startMs: 48_000, title: "A" },
        { startMs: 48_000, title: "B" },
      ],
    });
  });

  it("reports the first bad line instead of saving it", () => {
    expect(parseChapterLines("0:00 Intro\nnotatime here")).toEqual({
      error: { kind: "badTime", line: 2, value: "notatime" },
    });
    expect(parseChapterLines("0:00")).toEqual({
      error: { kind: "shape", line: 1 },
    });
    expect(parseChapterLines("0:00 ")).toEqual({
      error: { kind: "shape", line: 1 },
    });
  });
});

describe("chaptersToSave", () => {
  it("keeps a chapter's exact stored time when its line's time wasn't changed", () => {
    const before = [
      { startMs: 48_734, title: "Old title" },
      { startMs: 90_250, title: "Next" },
    ];
    // The box shows whole seconds; only the first title was edited.
    const parsed = [
      { startMs: 48_000, title: "New title" },
      { startMs: 90_000, title: "Next" },
    ];

    expect(chaptersToSave(parsed, before, DEFAULT_EDITS)).toEqual([
      { startMs: 48_734, title: "New title" },
      { startMs: 90_250, title: "Next" },
    ]);
  });

  it("keeps line breaks in a title that wasn't edited", () => {
    const before = [
      { startMs: 0, title: "Intro" },
      { startMs: 48_000, title: "Demo\npart two" },
    ];
    const parsed = [
      { startMs: 0, title: "Opening" },
      { startMs: 48_000, title: "Demo part two" },
    ];

    expect(chaptersToSave(parsed, before, DEFAULT_EDITS)).toEqual([
      { startMs: 0, title: "Opening" },
      { startMs: 48_000, title: "Demo\npart two" },
    ]);
  });

  it("maps typed times, which match the trimmed player, back to the original media", () => {
    // 0:30 on the trimmed player is 1:15 in the original recording.
    expect(
      chaptersToSave([{ startMs: 30_000, title: "Typed" }], [], trimmed),
    ).toEqual([{ startMs: 75_000, title: "Typed" }]);
  });

  it("keeps an unchanged chapter after a trim at its stored time", () => {
    const before = [{ startMs: 90_000, title: "Shown at 0:45" }];
    expect(
      chaptersToSave(
        [{ startMs: 45_000, title: "Shown at 0:45" }],
        before,
        trimmed,
      ),
    ).toEqual(before);
  });

  it("a line moved onto another chapter's second doesn't take its exact time", () => {
    const before = [
      { startMs: 48_000, title: "A" },
      { startMs: 90_400, title: "B" },
    ];
    // A moved from 0:48 to 1:30, B untouched at 1:30.
    expect(
      chaptersToSave(
        [
          { startMs: 90_000, title: "A" },
          { startMs: 90_000, title: "B" },
        ],
        before,
        DEFAULT_EDITS,
      ),
    ).toEqual([
      { startMs: 90_000, title: "A" },
      { startMs: 90_400, title: "B" },
    ]);
  });

  it("only ever sends whole, non-negative milliseconds", () => {
    const before = [{ startMs: 48_734.5, title: "Odd" }];
    expect(
      chaptersToSave(
        [{ startMs: 48_000, title: "Odd" }],
        before,
        DEFAULT_EDITS,
      ),
    ).toEqual([{ startMs: 48_735, title: "Odd" }]);
  });

  it("keeps chapters hidden inside a cut, which the box doesn't show", () => {
    const before = [
      { startMs: 10_000, title: "Inside the cut" },
      { startMs: 90_000, title: "Visible" },
    ];
    expect(
      chaptersToSave([{ startMs: 45_000, title: "Visible" }], before, trimmed),
    ).toEqual(before);
  });
});
