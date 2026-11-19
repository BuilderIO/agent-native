import { describe, expect, it } from "vitest";

import { appendRecentEdit } from "./recent-edit-ring.js";
import { RECENT_EDITS_MAX, type RecentEdit } from "./types.js";

function appendOne(edit: RecentEdit): RecentEdit | undefined {
  return appendRecentEdit(undefined, edit)[0];
}

describe("appendRecentEdit", () => {
  it("appends to an empty ring", () => {
    const edit: RecentEdit = { descriptor: { kind: "doc" }, at: 1 };
    expect(appendRecentEdit(undefined, edit)).toEqual([edit]);
  });

  it("appends after the existing entries", () => {
    const first: RecentEdit = { descriptor: { kind: "doc" }, at: 1 };
    const second: RecentEdit = { descriptor: { kind: "doc" }, at: 2 };
    expect(appendRecentEdit([first], second)).toEqual([first, second]);
  });

  it("keeps only the newest RECENT_EDITS_MAX entries", () => {
    let ring: RecentEdit[] | undefined;
    for (let i = 0; i < RECENT_EDITS_MAX + 4; i++) {
      ring = appendRecentEdit(ring, {
        descriptor: { kind: "text", quote: `q${i}` },
        at: i,
      });
    }
    expect(ring?.map((entry) => entry.at)).toEqual(
      Array.from({ length: RECENT_EDITS_MAX }, (_, i) => i + 4),
    );
  });

  it("does not mutate the input array", () => {
    const original: RecentEdit[] = [{ descriptor: { kind: "doc" }, at: 1 }];
    appendRecentEdit(original, { descriptor: { kind: "doc" }, at: 2 });
    expect(original).toHaveLength(1);
  });

  it("truncates an oversized quote so a caller forgetting to trim can't blow up the awareness payload", () => {
    const entry = appendOne({
      descriptor: { kind: "text", quote: "x".repeat(50_000) },
      at: 1,
    });
    expect(entry?.descriptor).toEqual({ kind: "text", quote: "x".repeat(500) });
  });

  it("truncates an oversized selector and each oversized path entry", () => {
    const huge = "a".repeat(10_000);
    expect(
      appendOne({ descriptor: { kind: "selector", selector: huge }, at: 1 })
        ?.descriptor,
    ).toEqual({ kind: "selector", selector: "a".repeat(500) });
    expect(
      appendOne({
        descriptor: { kind: "paths", paths: [huge, "short.path"] },
        at: 1,
      })?.descriptor,
    ).toEqual({ kind: "paths", paths: ["a".repeat(500), "short.path"] });
  });

  it("returns a doc descriptor as it is", () => {
    const descriptor = { kind: "doc" } as const;
    expect(appendOne({ descriptor, at: 1 })?.descriptor).toBe(descriptor);
  });

  it("truncates the string fields of any other descriptor kind", () => {
    const entry = appendOne({
      descriptor: { kind: "range", from: "b".repeat(600), to: 12 },
      at: 1,
    });
    expect(entry?.descriptor).toEqual({
      kind: "range",
      from: "b".repeat(500),
      to: 12,
    });
  });

  it("truncates an oversized label", () => {
    const entry = appendOne({
      descriptor: { kind: "doc" },
      label: "y".repeat(2_000),
      at: 1,
    });
    expect(entry?.label).toBe("y".repeat(500));
  });

  it("leaves short descriptors and labels untouched", () => {
    const entry = appendOne({
      descriptor: { kind: "text", quote: "hello world" },
      label: "Edited",
      at: 1,
    });
    expect(entry).toEqual({
      descriptor: { kind: "text", quote: "hello world" },
      label: "Edited",
      at: 1,
    });
  });

  it("keeps an empty label and leaves out a missing one", () => {
    expect(
      appendOne({ descriptor: { kind: "doc" }, label: "", at: 1 }),
    ).toEqual({ descriptor: { kind: "doc" }, label: "", at: 1 });
    expect(
      appendOne({ descriptor: { kind: "doc" }, at: 1 }),
    ).not.toHaveProperty("label");
  });
});
