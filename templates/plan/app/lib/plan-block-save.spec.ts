import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it } from "vitest";

import {
  documentHoldsTheirChanges,
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

describe("documentHoldsTheirChanges", () => {
  const callout = {
    id: "c",
    type: "callout",
    data: { tone: "info", body: "Note." },
  } as PlanBlock;
  const overlap = (
    base: string,
    theirs: string,
    fields = ["a.data.markdown"],
  ) => ({
    fields,
    base: [prose("a", base), callout],
    mine: [],
    theirs: [prose("a", theirs), callout],
    keepMine: [],
    useTheirs: [],
  });
  const holds = (base: string, live: string, theirs: string) =>
    documentHoldsTheirChanges(overlap(base, theirs), [
      prose("a", live),
      callout,
    ]);

  it("finds a collaborator's text merged next to this tab's", () => {
    expect(holds("Seed.", "Seed. mine theirs", "Seed. theirs")).toBe(true);
    expect(holds("Seed.", "Seed. theirs mine", "Seed. theirs")).toBe(true);
  });

  it("finds it when their copy held part of what this tab typed", () => {
    expect(holds("Seed.", "Seed. mine theirs", "Seed. mi theirs")).toBe(true);
  });

  it("finds their edits on either side of one of this tab's", () => {
    expect(
      holds(
        "Alpha.\n\nBeta.\n\nGamma.",
        "Alpha. x\n\nB.\n\nGamma. y",
        "Alpha. x\n\nBeta.\n\nGamma. y",
      ),
    ).toBe(true);
  });

  it("finds a collaborator's deletion", () => {
    expect(holds("Alpha beta.", "Alpha. mine", "Alpha.")).toBe(true);
  });

  it("doesn't find an agent's text, which never went through the document", () => {
    expect(holds("Seed.", "Seed. mine", "Seed. theirs")).toBe(false);
  });

  it("doesn't find a deletion when the text is still there", () => {
    expect(holds("Alpha beta.", "Alpha beta. mine", "Alpha.")).toBe(false);
    expect(holds("Alpha beta.", "mine Alpha beta.", "Alpha.")).toBe(false);
  });

  it("doesn't find a deletion when the text survives edits on both sides", () => {
    expect(
      holds("Alpha beta gamma.", "ALPHA beta gamma. mine", "Alpha gamma."),
    ).toBe(false);
    expect(
      holds(
        "One.\n\nTwo.\n\nThree.",
        "One. mine\n\nTwo.\n\nThree. mine",
        "One.\n\nThree.",
      ),
    ).toBe(false);
  });

  it("doesn't take unchanged text for their insertion", () => {
    expect(
      holds("Alpha. Beta.", "Alpha. Beta. mine", "Beta. Alpha. Beta."),
    ).toBe(false);
  });

  it("treats anything but prose as a real overlap", () => {
    const live = [prose("a", "Seed. theirs"), callout];
    for (const fields of [["order"], ["a"], ["c.data.body"]]) {
      expect(
        documentHoldsTheirChanges(
          overlap("Seed.", "Seed. theirs", fields),
          live,
        ),
      ).toBe(false);
    }
  });

  it("needs every overlapping field to be held", () => {
    expect(
      documentHoldsTheirChanges(
        overlap("Seed.", "Seed. theirs", ["a.data.markdown", "c.data.body"]),
        [prose("a", "Seed. theirs"), callout],
      ),
    ).toBe(false);
  });
});

describe("startBlockSave", () => {
  it("starts from what the document was brought up to before any save", () => {
    const blocks = [prose("a", "Alpha. mine"), prose("b", "Bravo.")];
    expect(startBlockSave(null, loaded, null, blocks)).toEqual({
      base: loaded,
      mine: blocks,
    });
  });

  it("refuses to save with no revision to save against", () => {
    expect(() => startBlockSave(null, null, null, loaded.value)).toThrow(
      "A plan revision is required",
    );
  });

  it("keeps what a merged save brought in when the document doesn't have it yet", () => {
    const start = startBlockSave(own(), loaded, null, [
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
    const start = startBlockSave(own(), loaded, null, [
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
    expect(startBlockSave(own(), newer, null, blocks)).toEqual({
      base: newer,
      mine: blocks,
    });
  });

  it("lets someone delete what a merged save brought in once the document has it", () => {
    const blocks = [prose("a", "Alpha. mine"), prose("b", "Bravo.")];
    expect(startBlockSave(own(), own().saved, null, blocks)).toEqual({
      base: own().saved,
      mine: blocks,
    });
  });

  it("keeps what a merged save brought in when only the loaded plan has it", () => {
    const start = startBlockSave(own(), null, own().saved, [
      prose("a", "Alpha. mine, and more"),
      prose("b", "Bravo."),
    ]);
    expect(start.mine[1]).toEqual(prose("b", "Bravo. theirs"));
  });
});
