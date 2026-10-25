import { describe, expect, it } from "vitest";

import { rebaseBodyEdit } from "./rebase.js";

describe("rebaseBodyEdit", () => {
  it("applies an edit to a block nobody else changed, keeping theirs", () => {
    expect(
      rebaseBodyEdit(
        "One\nTwo\nThree",
        "One A\nTwo\nThree",
        "One\nTwo\nThree B",
      ),
    ).toBe("One A\nTwo\nThree B");
  });

  it("places an edit by its block when another writer added blocks before it", () => {
    expect(rebaseBodyEdit("One\nTwo", "One\nTwo B", "Zero\nOne\nTwo")).toBe(
      "Zero\nOne\nTwo B",
    );
  });

  it("refuses an edit to a block another writer changed", () => {
    expect(rebaseBodyEdit("One\nTwo", "One A\nTwo", "One B\nTwo")).toBeNull();
  });

  it("refuses an edit whose text another writer moved to another block", () => {
    expect(
      rebaseBodyEdit(
        "Alice: approved\nBob: pending",
        "Alice: revoked\nBob: pending",
        "Alice: denied\nBob: approved",
      ),
    ).toBeNull();
  });

  it("refuses an edit to a block that reads the same as another", () => {
    expect(
      rebaseBodyEdit(
        "Same\nMiddle\nSame",
        "Changed\nMiddle\nSame",
        "Same\nMiddle\nSame\nEnd",
      ),
    ).toBeNull();
    // Moving A after the second D, or that D before the first, reads alike,
    // and the two put the edit's B in different places.
    expect(rebaseBodyEdit("D\nA\nD\nC", "B\nA\nD\nC", "D\nD\nA\nC")).toBeNull();
  });

  it("applies an edit to a block beside one another writer changed", () => {
    expect(rebaseBodyEdit("One\nTwo", "One A\nTwo", "One\nTwo B")).toBe(
      "One A\nTwo B",
    );
  });

  it("refuses an insertion beside a block another writer changed", () => {
    expect(
      rebaseBodyEdit("One\nTwo", "One\nNew\nTwo", "One B\nTwo"),
    ).toBeNull();
    expect(
      rebaseBodyEdit("One\nTwo", "One\nNew\nTwo", "One\nOther\nTwo"),
    ).toBeNull();
  });

  it("refuses an insertion beside blocks that read the same when another writer removed one of them", () => {
    expect(
      rebaseBodyEdit("Same\nSame\nSame", "Same\nNew\nSame\nSame", "Same\nSame"),
    ).toBeNull();
    expect(
      rebaseBodyEdit(
        "<empty-block/>\n<empty-block/>\n<empty-block/>",
        "<empty-block/>\nNew\n<empty-block/>\n<empty-block/>",
        "<empty-block/>\n<empty-block/>",
      ),
    ).toBeNull();
  });

  it("refuses an edit the diff reads as keeping a block another writer changed", () => {
    // The edit replaced Alpha and Bravo; the diff reads it as removing Alpha
    // and adding a Charlie, which could go before or after Charlie.
    expect(
      rebaseBodyEdit(
        "Alpha\nBravo\nCharlie",
        "Bravo\nCharlie\nCharlie",
        "Alpha\nBravo peer\nCharlie",
      ),
    ).toBeNull();
  });

  it("refuses an edit that moves a block another writer removed", () => {
    expect(rebaseBodyEdit("A\nB\nC", "B\nA\nC", "B\nC")).toBeNull();
  });

  it("refuses an edit that removes a block another writer moved", () => {
    expect(
      rebaseBodyEdit("A\nB\nC\nD", "A agent\nB\nD", "A\nB\nD\nC"),
    ).toBeNull();
  });

  it("refuses a change both writers made where it could slide", () => {
    // Each copied B, and a copy could sit on either side of it.
    expect(rebaseBodyEdit("A\nB\nC", "A\nB\nB\nC", "A\nB\nB\nC")).toBeNull();
  });

  it("takes a change both writers made once", () => {
    expect(rebaseBodyEdit("One\nTwo", "One A\nTwo", "One A\nTwo")).toBe(
      "One A\nTwo",
    );
  });

  it("leaves the current body alone for an edit that changes no block", () => {
    expect(rebaseBodyEdit("One\n\nTwo", "One\nTwo", "One\nTwo B")).toBe(
      "One\nTwo B",
    );
  });

  describe("with the ranges of base the edit replaced", () => {
    const base = "Alpha\nBravo\nCharlie\nDelta\nEcho";
    // Replacing "Alpha\nBravo\nCharlie" with "Bravo\nCharlie\nNew", which
    // the diff reads as keeping Bravo and Charlie.
    const candidate = "Bravo\nCharlie\nNew\nDelta\nEcho";
    const replaced = [{ start: 0, end: "Alpha\nBravo\nCharlie".length }];

    it("refuses an edit whose replaced text another writer changed, though the diff reads it as kept", () => {
      const current = "Alpha\nBravo peer\nCharlie\nDelta\nEcho";
      expect(rebaseBodyEdit(base, candidate, current, replaced)).toBeNull();
      expect(rebaseBodyEdit(base, candidate, current)).toBe(
        "Bravo peer\nCharlie\nNew\nDelta\nEcho",
      );
    });

    it("applies an edit when another writer changed a block outside its replaced text", () => {
      expect(
        rebaseBodyEdit(
          base,
          candidate,
          "Alpha\nBravo\nCharlie\nDelta\nEcho peer",
          replaced,
        ),
      ).toBe("Bravo\nCharlie\nNew\nDelta\nEcho peer");
    });

    it("applies an edit whose replaced text takes a closing code fence when another writer changed a block after it", () => {
      const fenced = "```js\nold\n```\nTail\nEnd";
      const edited = "```js\nnew\n```\nTail\nEnd";
      // Replacing "old\n```" with "new\n```".
      const range = [
        { start: fenced.indexOf("old"), end: fenced.indexOf("\nTail") },
      ];

      expect(
        rebaseBodyEdit(
          fenced,
          edited,
          "```js\nold\n```\nTail\nEnd peer",
          range,
        ),
      ).toBe("```js\nnew\n```\nTail\nEnd peer");
      expect(
        rebaseBodyEdit(
          fenced,
          edited,
          "```js\nold peer\n```\nTail\nEnd",
          range,
        ),
      ).toBeNull();
    });

    it("refuses an edit whose replaced text takes a callout's closing tag when another writer changed the callout", () => {
      const base = "<callout>\n\tSaved\n</callout>\nTail";
      // Replacing "Saved\n</callout>\nTail", which the diff reads as keeping
      // the callout.
      const candidate = "<callout>\n\tSaved\n</callout>\nTail two";
      const current = "<callout>\n\tSaved peer\n</callout>\nTail";
      const range = [{ start: base.indexOf("Saved"), end: base.length }];

      expect(rebaseBodyEdit(base, candidate, current, range)).toBeNull();
      expect(rebaseBodyEdit(base, candidate, current)).not.toBeNull();
    });
  });

  it("adds a new block both writers added in different places twice", () => {
    expect(
      rebaseBodyEdit("A\nB\nC\nD", "A\nNew\nB\nC\nD", "A\nB\nC\nNew\nD"),
    ).toBe("A\nNew\nB\nC\nNew\nD");
    // An agent's blank paragraph while a tab presses Enter elsewhere.
    expect(
      rebaseBodyEdit(
        "A\nB\nC\nD",
        "A\n<empty-block/>\nB\nC\nD",
        "A\nB\nC\n<empty-block/>\nD",
      ),
    ).toBe("A\n<empty-block/>\nB\nC\n<empty-block/>\nD");
    expect(rebaseBodyEdit("A\nB\nC\nD", "A\nDone\nC\nD", "A\nB\nC\nDone")).toBe(
      "A\nDone\nC\nDone",
    );
  });
});
