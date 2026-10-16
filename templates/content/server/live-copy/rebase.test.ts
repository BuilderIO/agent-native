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
  });

  it("refuses an insertion beside a block another writer changed", () => {
    expect(
      rebaseBodyEdit("One\nTwo", "One\nNew\nTwo", "One B\nTwo"),
    ).toBeNull();
    expect(
      rebaseBodyEdit("One\nTwo", "One\nNew\nTwo", "One\nOther\nTwo"),
    ).toBeNull();
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
