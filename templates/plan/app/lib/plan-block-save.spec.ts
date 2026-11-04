import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it } from "vitest";

import {
  liveDocumentSettledOverlap,
  startBlockSave,
  type OwnBlockSave,
} from "./plan-block-save";

const prose = (id: string, markdown: string) =>
  ({ id, type: "rich-text", data: { markdown } }) as PlanBlock;

const loaded = {
  value: [prose("a", "Alpha."), prose("b", "Bravo.")],
  revision: "2026-10-01T00:00:01.000Z",
};

const own = (): OwnBlockSave => ({
  planId: "plan_1",
  sent: [prose("a", "Alpha. mine"), prose("b", "Bravo.")],
  saved: {
    value: [prose("a", "Alpha. mine"), prose("b", "Bravo. theirs")],
    revision: "2026-10-01T00:00:05.000Z",
  },
});

describe("liveDocumentSettledOverlap", () => {
  const callout = {
    id: "c",
    type: "callout",
    data: { tone: "info", body: "Note." },
  } as PlanBlock;
  const overlap = (fields: string[]) => ({
    fields,
    base: [],
    mine: [prose("a", "Alpha. mine"), callout],
    theirs: [prose("a", "Alpha. theirs"), callout],
    keepMine: [],
    useTheirs: [],
  });

  it("settles overlapping prose while someone else is in the document", () => {
    expect(liveDocumentSettledOverlap(overlap(["a.data.markdown"]), true)).toBe(
      true,
    );
  });

  it("settles overlapping block order the same way", () => {
    expect(liveDocumentSettledOverlap(overlap(["order"]), true)).toBe(true);
  });

  it("asks when nobody else is in the document, as with an agent's write", () => {
    expect(
      liveDocumentSettledOverlap(overlap(["a.data.markdown"]), false),
    ).toBe(false);
  });

  it("asks about structured data, which the document doesn't hold", () => {
    expect(
      liveDocumentSettledOverlap(
        overlap(["a.data.markdown", "c.data.body"]),
        true,
      ),
    ).toBe(false);
  });
});

describe("startBlockSave", () => {
  it("starts from what the document was brought up to before any save", () => {
    const blocks = [prose("a", "Alpha. mine"), prose("b", "Bravo.")];
    expect(startBlockSave(null, loaded, blocks)).toEqual({
      base: loaded,
      mine: blocks,
    });
  });

  it("refuses to save with no revision to save against", () => {
    expect(() => startBlockSave(null, null, loaded.value)).toThrow(
      "A plan revision is required",
    );
  });

  it("keeps what a merged save brought in when the document doesn't have it yet", () => {
    const start = startBlockSave(own(), loaded, [
      prose("a", "Alpha. mine, and more"),
      prose("b", "Bravo."),
    ]);
    expect(start.base).toEqual(own().saved);
    expect(start.mine).toEqual([
      prose("a", "Alpha. mine, and more"),
      prose("b", "Bravo. theirs"),
    ]);
  });

  it("keeps what the document changed since, over what the save brought in", () => {
    const start = startBlockSave(own(), loaded, [
      prose("a", "Alpha. mine"),
      prose("b", "Bravo. newer local"),
    ]);
    expect(start.mine[1]).toEqual(prose("b", "Bravo. newer local"));
  });

  it("starts from the document when another writer's save is newer than this tab's", () => {
    const newer = {
      value: loaded.value,
      revision: "2026-10-01T00:00:09.000Z",
    };
    const blocks = [prose("a", "Alpha. edited"), prose("b", "Bravo.")];
    expect(startBlockSave(own(), newer, blocks)).toEqual({
      base: newer,
      mine: blocks,
    });
  });
});
