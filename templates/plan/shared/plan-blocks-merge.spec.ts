import { describe, expect, it } from "vitest";

import { mergePlanBlocks } from "./plan-blocks-merge";
import type { PlanBlock } from "./plan-content";

const prose = (id: string, markdown: string) =>
  ({ id, type: "rich-text", data: { markdown } }) as PlanBlock;
const callout = (id: string, body: string) =>
  ({ id, type: "callout", data: { tone: "info", body } }) as PlanBlock;

describe("mergePlanBlocks", () => {
  const base = [
    prose("a", "Alpha."),
    callout("c", "Note."),
    prose("b", "Bravo."),
  ];

  it("keeps edits two writers made to different blocks", () => {
    const merged = mergePlanBlocks(
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
      mergePlanBlocks(
        [prose("a", "Seed.")],
        [prose("a", "Seed. mine theirs")],
        [prose("a", "Seed. theirs")],
      ),
    ).toBeNull();
  });

  it("takes prose another writer saved when the local copy never changed it", () => {
    const merged = mergePlanBlocks(
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
    const merged = mergePlanBlocks(
      [saved],
      [prose("b", "Bravo.")],
      [{ ...saved, data: { markdown: "Bravo. theirs" } } as PlanBlock],
    );
    expect(merged).toEqual([{ ...saved, data: { markdown: "Bravo. theirs" } }]);
  });

  it("keeps a block one writer added and a block the other removed", () => {
    const merged = mergePlanBlocks(
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
    const merged = mergePlanBlocks(
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
    const merged = mergePlanBlocks(
      [tabs("one", "two")],
      [tabs("one edited", "two")],
      [tabs("one", "two edited")],
    );
    expect(merged).toEqual([tabs("one edited", "two edited")]);
  });

  it("refuses when both writers changed the same structured value", () => {
    expect(
      mergePlanBlocks(
        base,
        [base[0], callout("c", "Mine."), base[2]],
        [base[0], callout("c", "Theirs."), base[2]],
      ),
    ).toBeNull();
  });

  it("refuses to drop a block the other writer edited", () => {
    expect(
      mergePlanBlocks(
        base,
        [base[0], base[1]],
        [base[0], base[1], prose("b", "Bravo. theirs")],
      ),
    ).toBeNull();
  });

  it("refuses when both writers reordered the blocks", () => {
    expect(
      mergePlanBlocks(
        base,
        [base[1], base[0], base[2]],
        [base[0], base[2], base[1]],
      ),
    ).toBeNull();
  });
});
