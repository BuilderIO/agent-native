import { filterStateKey } from "@agent-native/toolkit/app/filters/url";
import { describe, expect, it } from "vitest";

import {
  evaluateLibraryFilter,
  LIBRARY_FILTER_LABELS_EN,
  libraryFilterCounts,
  libraryFilterFields,
  libraryFilterQuery,
  libraryLength,
  readLibraryFilter,
  unreadLibraryFilterParts,
  withLibrarySource,
  type LibraryFilterRow,
} from "./library-filters";

const rows: LibraryFilterRow[] = [
  {
    id: "recorded",
    source: "clips",
    madeBy: "person",
    createdAt: "2026-11-20T15:00:00.000Z",
    visibility: "private",
    shared: false,
    durationMs: 30_000,
    tags: ["demo"],
    hasTranscript: true,
  },
  {
    id: "agent",
    source: "clips",
    madeBy: "agent",
    createdAt: "2026-11-10T12:00:00.000Z",
    visibility: "org",
    shared: true,
    durationMs: 180_000,
    tags: ["demo", "bug"],
    hasTranscript: false,
  },
  {
    id: "uploaded",
    source: "content",
    madeBy: "person",
    createdAt: "2026-11-20T03:30:00.000Z",
    visibility: "public",
    shared: false,
    durationMs: 1_500_000,
    tags: [],
    hasTranscript: true,
  },
  {
    id: "older",
    source: "clips",
    madeBy: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    visibility: "public",
    shared: true,
    durationMs: 600_000,
    tags: ["bug"],
    hasTranscript: false,
  },
];

const utc = { today: "2026-11-20", timeZone: "UTC" };

const fields = libraryFilterFields(LIBRARY_FILTER_LABELS_EN);

function run(search: string, context = utc) {
  return evaluateLibraryFilter(rows, readLibraryFilter(search), context);
}

describe("Library filter", () => {
  it("leaves Content uploads out by default and counts them as hidden", () => {
    const result = run("");
    expect(result.ids).toEqual(["recorded", "agent", "older"]);
    expect(result.counts.matching).toBe(3);
    expect(result.counts.hiddenByPinned).toBe(1);
    expect(result.counts.options.source).toEqual({ clips: 3, content: 1 });
  });

  it("shows Content uploads when the source asks for them", () => {
    expect(run("source=content").ids).toEqual(["uploaded"]);
    const all = run("source=all");
    expect(all.ids).toEqual(["recorded", "agent", "uploaded", "older"]);
    expect(all.counts.hiddenByPinned).toBe(0);
  });

  it("matches who made it, sharing, length, tags and transcripts", () => {
    expect(run("r=madeBy:equals:agent").ids).toEqual(["agent"]);
    expect(run("r=sharing:equals:shared").ids).toEqual(["agent", "older"]);
    expect(run("source=all&r=sharing:equals:public").ids).toEqual([
      "uploaded",
      "older",
    ]);
    expect(run("r=length:equals:5_to_20m").ids).toEqual(["older"]);
    expect(run("r=tag:contains:bug").ids).toEqual(["agent", "older"]);
    expect(run("r=transcript:is_checked").ids).toEqual(["recorded"]);
    expect(
      run("match=any&r=madeBy:equals:agent&r=transcript:is_checked").ids,
    ).toEqual(["recorded", "agent"]);
  });

  it("reads dates in the user's time zone", () => {
    const newYork = { today: "2026-11-20", timeZone: "America/New_York" };
    expect(run("source=content&r=created:equals:today").ids).toEqual([
      "uploaded",
    ]);
    expect(run("source=content&r=created:equals:today", newYork).ids).toEqual(
      [],
    );
    expect(
      run("source=content&r=created:equals:yesterday", newYork).ids,
    ).toEqual(["uploaded"]);
  });

  it("counts each option beside the other rules", () => {
    const result = run("r=madeBy:equals:agent");
    expect(result.counts.matching).toBe(1);
    expect(result.counts.options.madeBy).toEqual({ person: 1, agent: 1 });
    expect(result.counts.options.source).toEqual({ clips: 1, content: 0 });
    expect(result.counts.options.tag).toEqual({ bug: 1, demo: 1 });
    expect(result.tags).toEqual(["bug", "demo"]);

    const counts = libraryFilterCounts(result.counts);
    expect(counts.option("madeBy", "agent")).toBe(1);
    expect(counts.option("tag", "missing")).toBe(0);
    expect(counts.option("unknown", "x")).toBeUndefined();
  });

  it("lists only the listed rows but offers choices from every row", () => {
    const outsideFolders = new Set(["recorded", "uploaded"]);
    const result = evaluateLibraryFilter(
      rows,
      readLibraryFilter(""),
      utc,
      (row) => outsideFolders.has(row.id),
    );
    expect(result.ids).toEqual(["recorded"]);
    expect(result.counts.matching).toBe(1);
    expect(result.counts.options.source).toEqual({ clips: 3, content: 1 });
    expect(result.counts.hiddenByPinned).toBe(1);
    expect(result.tags).toEqual(["bug", "demo"]);
  });

  it("names the parts of a filter it can't read", () => {
    expect(
      unreadLibraryFilterParts(
        "source=all&match=any&r=madeBy:equals:agent&g=1:any&r=1/tag:contains:bug",
      ),
    ).toEqual([]);
    expect(
      unreadLibraryFilterParts(
        "source=elsewhere&match=or&r=transcript:is_chekced&r=madeBy:equals:&r=2/tag:contains:bug",
      ),
    ).toEqual([
      "source=elsewhere",
      "match=or",
      "r=transcript:is_chekced",
      "r=madeBy:equals:",
      "r=2/tag:contains:bug",
    ]);
  });

  it("buckets lengths at 1, 5 and 20 minutes", () => {
    expect(libraryLength(59_999)).toBe("under_1m");
    expect(libraryLength(60_000)).toBe("1_to_5m");
    expect(libraryLength(300_000)).toBe("5_to_20m");
    expect(libraryLength(1_200_000)).toBe("over_20m");
  });

  it("writes the filter part of a Library link and nothing at the default", () => {
    expect(libraryFilterQuery("?q=demo&source=clips")).toBe("");
    expect(
      libraryFilterQuery(
        "q=demo&r=typo:equals:x&r=madeBy:equals:agent&source=all",
      ),
    ).toBe("source=all&r=madeBy:equals:agent");
  });

  it("sets the source and keeps the rules", () => {
    const state = readLibraryFilter("r=madeBy:equals:agent");
    expect(filterStateKey(withLibrarySource(state, "all"), fields)).toBe(
      "?source=all&r=madeBy:equals:agent",
    );
    expect(filterStateKey(withLibrarySource(state, "content"), fields)).toBe(
      "?source=content&r=madeBy:equals:agent",
    );
    expect(filterStateKey(withLibrarySource(state, "clips"), fields)).toBe(
      "?r=madeBy:equals:agent",
    );
  });
});
