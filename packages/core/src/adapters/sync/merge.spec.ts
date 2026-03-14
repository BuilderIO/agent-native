import { describe, it, expect } from "vitest";
import { threeWayMerge } from "./merge.js";

describe("threeWayMerge", () => {
  it("returns local when local === remote (no-op)", () => {
    const result = threeWayMerge("base", "same", "same");
    expect(result).toEqual({ merged: "same", success: true });
  });

  it("returns remote when local is unchanged", () => {
    const result = threeWayMerge("base", "base", "remote change");
    expect(result).toEqual({ merged: "remote change", success: true });
  });

  it("returns local when remote is unchanged", () => {
    const result = threeWayMerge("base", "local change", "base");
    expect(result).toEqual({ merged: "local change", success: true });
  });

  it("returns success when all three are identical", () => {
    const result = threeWayMerge("same", "same", "same");
    expect(result).toEqual({ merged: "same", success: true });
  });

  it("merges non-overlapping changes", () => {
    const base = "line1\nline2\nline3\nline4";
    const local = "LOCAL\nline2\nline3\nline4"; // changed line 1
    const remote = "line1\nline2\nline3\nREMOTE"; // changed line 4
    const result = threeWayMerge(base, local, remote);
    expect(result.success).toBe(true);
    expect(result.merged).toBe("LOCAL\nline2\nline3\nREMOTE");
  });

  it("returns conflict when changes overlap", () => {
    const base = "line1\nline2\nline3";
    const local = "LOCAL\nline2\nline3"; // changed line 1
    const remote = "REMOTE\nline2\nline3"; // also changed line 1
    const result = threeWayMerge(base, local, remote);
    expect(result.success).toBe(false);
    expect(result.merged).toBeNull();
  });

  it("handles empty base (both sides are insertions -> conflict)", () => {
    const result = threeWayMerge("", "local", "remote");
    expect(result.success).toBe(false);
    expect(result.merged).toBeNull();
  });

  it("merges insertion and deletion on different lines", () => {
    const base = "line1\nline2\nline3";
    const local = "line1\nline3"; // deleted line2
    const remote = "line1\nline2\nline3\nline4"; // added line4
    const result = threeWayMerge(base, local, remote);
    expect(result.success).toBe(true);
    expect(result.merged).toBe("line1\nline3\nline4");
  });

  it("handles trailing newlines consistently", () => {
    const base = "line1\nline2\n";
    const local = "line1\nline2\n"; // unchanged
    const remote = "line1\nchanged\n";
    const result = threeWayMerge(base, local, remote);
    expect(result).toEqual({ merged: "line1\nchanged\n", success: true });
  });

  it("handles files without trailing newlines", () => {
    const base = "line1\nline2";
    const local = "line1\nline2"; // unchanged
    const remote = "line1\nchanged";
    const result = threeWayMerge(base, local, remote);
    expect(result).toEqual({ merged: "line1\nchanged", success: true });
  });

  it("fails closed on LCS bailout for large files (>10M cells)", () => {
    // Create arrays where m * n > 10,000,000
    // 3163 lines each -> 3163 * 3163 ~ 10M, use 3200 to be safe
    const bigBase = Array.from({ length: 3200 }, (_, i) => `base-line-${i}`).join("\n");
    const bigLocal = Array.from({ length: 3200 }, (_, i) => `local-line-${i}`).join("\n");
    const bigRemote = Array.from({ length: 3200 }, (_, i) => `remote-line-${i}`).join("\n");
    const result = threeWayMerge(bigBase, bigLocal, bigRemote);
    // LCS returns [] -> everything becomes one hunk -> hunks overlap -> conflict
    expect(result.success).toBe(false);
    expect(result.merged).toBeNull();
  });
});
