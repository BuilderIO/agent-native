import { describe, expect, it } from "vitest";

import { describeOverlappingBlock, mergePlanBlocks } from "./plan-blocks-merge";
import type { PlanBlock } from "./plan-content";

const prose = (id: string, markdown: string) =>
  ({ id, type: "rich-text", data: { markdown } }) as PlanBlock;
const callout = (id: string, body: string) =>
  ({ id, type: "callout", data: { tone: "info", body } }) as PlanBlock;

// What merged cleanly, or null when the writers overlap.
function cleanMerge(...args: Parameters<typeof mergePlanBlocks>) {
  const merge = mergePlanBlocks(...args);
  return merge.ok ? merge.merged : null;
}

describe("mergePlanBlocks", () => {
  const base = [
    prose("a", "Alpha."),
    callout("c", "Note."),
    prose("b", "Bravo."),
  ];

  it("keeps edits two writers made to different blocks", () => {
    const merged = cleanMerge(
      base,
      [prose("a", "Alpha. mine"), base[1], base[2]],
      [base[0], base[1], prose("b", "Bravo. theirs")],
    );
    expect(merged).toEqual([
      prose("a", "Alpha. mine"),
      callout("c", "Note."),
      prose("b", "Bravo. theirs"),
    ]);
  });

  it("refuses conflicting prose when both writers changed one block", () => {
    expect(
      cleanMerge(
        [prose("a", "Seed.")],
        [prose("a", "Seed. mine theirs")],
        [prose("a", "Seed. theirs")],
      ),
    ).toBeNull();
  });

  it("takes prose another writer saved when the local copy never changed it", () => {
    const merged = cleanMerge(
      [prose("a", "Seed."), prose("b", "Other.")],
      [prose("a", "Seed."), prose("b", "Other. mine")],
      [prose("a", "Seed. saved elsewhere"), prose("b", "Other.")],
    );
    expect(merged).toEqual([
      prose("a", "Seed. saved elsewhere"),
      prose("b", "Other. mine"),
    ]);
  });

  it("treats prose as untouched when only a field the editor does not write differs", () => {
    // Saved blocks carry `editable`; the blocks the editor sends back do not.
    const saved = { ...prose("b", "Bravo."), editable: true } as PlanBlock;
    const merged = cleanMerge(
      [saved],
      [prose("b", "Bravo.")],
      [{ ...saved, data: { markdown: "Bravo. theirs" } } as PlanBlock],
    );
    expect(merged).toEqual([{ ...saved, data: { markdown: "Bravo. theirs" } }]);
  });

  it("keeps a field the editor does not write on prose it changed", () => {
    const saved = { ...prose("b", "Bravo."), editable: true } as PlanBlock;
    const merged = cleanMerge(
      [saved],
      [prose("b", "Bravo. mine")],
      [{ ...saved, title: "Theirs" } as PlanBlock],
    );
    expect(merged).toEqual([
      { ...saved, title: "Theirs", data: { markdown: "Bravo. mine" } },
    ]);
  });

  it("offers both versions when the writers overlap", () => {
    const merge = mergePlanBlocks(
      [prose("a", "Seed."), prose("b", "Other.")],
      [prose("a", "Seed. mine"), prose("b", "Other. mine")],
      [prose("a", "Seed. theirs"), prose("b", "Other.")],
    );
    expect(merge).toEqual({
      ok: false,
      fields: ["a.data.markdown"],
      keepMine: [prose("a", "Seed. mine"), prose("b", "Other. mine")],
      useTheirs: [prose("a", "Seed. theirs"), prose("b", "Other. mine")],
    });
  });

  it("keeps a block one writer added and a block the other removed", () => {
    const merged = cleanMerge(
      base,
      [...base, prose("d", "Delta.")],
      [base[0], base[2]],
    );
    expect(merged?.map((block) => block.id)).toEqual(["a", "b", "d"]);
  });

  it("treats key order and absent keys as no change", () => {
    const reordered = {
      data: { markdown: "Alpha." },
      type: "rich-text",
      id: "a",
      title: undefined,
    } as unknown as PlanBlock;
    const merged = cleanMerge(
      base,
      [reordered, base[1], base[2]],
      [base[0], base[1], prose("b", "Bravo. theirs")],
    );
    expect(merged?.map((block) => block.id)).toEqual(["a", "c", "b"]);
    expect(merged?.[2]).toEqual(prose("b", "Bravo. theirs"));
  });

  it("merges edits to an id-keyed list nested in a block", () => {
    const tabs = (first: string, second: string) =>
      ({
        id: "t",
        type: "tabs",
        data: {
          tabs: [
            { id: "x", label: "X", blocks: [prose("x1", first)] },
            { id: "y", label: "Y", blocks: [prose("y1", second)] },
          ],
        },
      }) as unknown as PlanBlock;
    const merged = cleanMerge(
      [tabs("one", "two")],
      [tabs("one edited", "two")],
      [tabs("one", "two edited")],
    );
    expect(merged).toEqual([tabs("one edited", "two edited")]);
  });

  it("refuses when both writers changed the same structured value", () => {
    expect(
      cleanMerge(
        base,
        [base[0], callout("c", "Mine."), base[2]],
        [base[0], callout("c", "Theirs."), base[2]],
      ),
    ).toBeNull();
  });

  it("refuses to drop a block the other writer edited", () => {
    expect(
      cleanMerge(
        base,
        [base[0], base[1]],
        [base[0], base[1], prose("b", "Bravo. theirs")],
      ),
    ).toBeNull();
  });

  it("refuses when both writers reordered the blocks", () => {
    expect(
      cleanMerge(
        base,
        [base[1], base[0], base[2]],
        [base[0], base[2], base[1]],
      ),
    ).toBeNull();
  });
});

describe("describeOverlappingBlock", () => {
  const blocks = (markdown: string) => ({
    mine: [prose("a", markdown)],
    theirs: [
      callout("c", "Note."),
      { ...callout("d", "Note."), title: "Risks" },
    ],
  });

  it("names prose by its first line, without its markup", () => {
    expect(
      describeOverlappingBlock(
        "a.data.markdown",
        blocks("\n## Launch plan\nBody."),
      ),
    ).toBe("Launch plan");
  });

  it("shortens a long first line", () => {
    expect(
      describeOverlappingBlock("a.data.markdown", blocks("x".repeat(80))),
    ).toBe(`${"x".repeat(60)}…`);
  });

  it("names a structured block by its title, if it has one", () => {
    expect(describeOverlappingBlock("d.data.body", blocks("Text."))).toBe(
      "Risks",
    );
    expect(describeOverlappingBlock("c.data.body", blocks("Text."))).toBeNull();
  });

  it("names nothing for a path that isn't a block, like the order", () => {
    expect(describeOverlappingBlock("order", blocks("Text."))).toBeNull();
  });
});
