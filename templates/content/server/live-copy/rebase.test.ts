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
});
