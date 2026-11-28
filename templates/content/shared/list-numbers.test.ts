import { describe, expect, it } from "vitest";

import {
  maskedOffset,
  maskListNumbers,
  unmaskedOffset,
  withListNumbersInOrder,
} from "./list-numbers.js";
import { canonicalizeNfm } from "./nfm.js";
import { applyMarkdownSuggestionOperation } from "./suggestion-apply.js";
import {
  markdownSuggestionOperations,
  markdownSuggestionOperationsForEditorRevision,
} from "./suggestion-diff.js";

const list = (...items: string[]) =>
  canonicalizeNfm(
    [
      "Packing list:",
      "",
      ...items.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n"),
  );

describe("withListNumbersInOrder", () => {
  it("numbers a list's items in order after its first", () => {
    expect(
      withListNumbersInOrder(
        "Packing list:\n\n1. Tent\n2. Bug spray\n2. Stove\n3. Water filter\n",
      ),
    ).toBe(
      "Packing list:\n\n1. Tent\n2. Bug spray\n3. Stove\n4. Water filter\n",
    );
    expect(withListNumbersInOrder("3. Tent\n3. Stove\n4. Map")).toBe(
      "3. Tent\n4. Stove\n5. Map",
    );
  });

  it("leaves numbers in order and numbered lines in a code fence alone", () => {
    const page = list("Tent", "Stove");
    expect(withListNumbersInOrder(page)).toBe(page);
    const fenced = "```\n1. Tent\n1. Stove\n```";
    expect(withListNumbersInOrder(fenced)).toBe(fenced);
  });

  it("leaves a page alone when the editor would rewrite a numbered item", () => {
    const page = "Packing list:\n\n1. Tent\n1. _Stove_";
    expect(canonicalizeNfm(page)).not.toContain("_Stove_");
    expect(withListNumbersInOrder(page)).toBe(page);
  });

  it("ends a code fence only where the editor does", () => {
    expect(withListNumbersInOrder("1. A\n\t```\n```\n1. B\n\t```\n7. B")).toBe(
      "1. A\n\t```\n```\n1. B\n\t```\n2. B",
    );
  });

  it("leaves a page alone when a longer number would move a nested line out of its item", () => {
    const page = "9. A\n9. B\n   - nested";
    expect(canonicalizeNfm(page)).toContain("\t- nested");
    expect(withListNumbersInOrder(page)).toBe(page);
  });
});

describe("maskListNumbers", () => {
  it("maps offsets around each number and refuses one inside it", () => {
    const masked = maskListNumbers("1. Tent\n10. Stove");
    expect(masked.text).toBe("0. Tent\n0. Stove");
    expect(maskedOffset(masked, 9)).toBeNull();
    expect(maskedOffset(masked, 10)).toBe(9);
    expect(unmaskedOffset(masked, 9)).toBe(10);
    expect(unmaskedOffset(masked, 8)).toBe(8);
  });
});

describe("placing a suggestion on a list that was renumbered", () => {
  const before = list("Tent", "Stove", "Water filter", "Map", "Headlamp");

  it("places an edit further down after items were added above it", () => {
    const current = list(
      "Tent",
      "Bug spray",
      "Stove",
      "Water filter",
      "Sunscreen",
      "Map",
      "Headlamp",
    );
    expect(
      markdownSuggestionOperations(before, before.replace("Map", "Maps")).map(
        (edit) => applyMarkdownSuggestionOperation(current, edit),
      ),
    ).toEqual([current.replace("Map", "Maps")]);
  });

  it("refuses an edit to a removed item when another item has the same text", () => {
    expect(
      markdownSuggestionOperations(
        "1. Same\n2. Same",
        "1. Same\n2. Changed",
      ).map((edit) => applyMarkdownSuggestionOperation("1. Same", edit)),
    ).toEqual([null]);
  });

  it("places an added item after another added item was accepted", () => {
    const current = list(
      "Tent",
      "Bug spray",
      "Stove",
      "Water filter",
      "Map",
      "Headlamp",
    );
    expect(
      markdownSuggestionOperationsForEditorRevision({
        before,
        after: list(
          "Tent",
          "Stove",
          "Water filter",
          "Sunscreen",
          "Map",
          "Headlamp",
        ),
        replacements: [],
      }).map((added) => {
        const placed = applyMarkdownSuggestionOperation(current, added);
        return placed === null ? null : withListNumbersInOrder(placed);
      }),
    ).toEqual([
      list(
        "Tent",
        "Bug spray",
        "Stove",
        "Water filter",
        "Sunscreen",
        "Map",
        "Headlamp",
      ),
    ]);
  });
});
