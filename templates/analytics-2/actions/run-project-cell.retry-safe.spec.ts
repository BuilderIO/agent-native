import { describe, expect, it } from "vitest";

import action from "./run-project-cell.js";

describe("run-project-cell retry safety", () => {
  it("lets the agent repeat a run or poll after an error, but not a page advance", () => {
    const retrySafe = (
      action as unknown as {
        retrySafe: (input: { operation?: string }) => boolean;
      }
    ).retrySafe;
    expect(typeof retrySafe).toBe("function");
    expect(retrySafe({})).toBe(true);
    expect(retrySafe({ operation: "run" })).toBe(true);
    expect(retrySafe({ operation: "poll" })).toBe(true);
    expect(retrySafe({ operation: "next-page" })).toBe(false);
  });
});
